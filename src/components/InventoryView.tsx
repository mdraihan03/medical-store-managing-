import { useState, type FormEvent } from 'react';
import { Download, Plus, Search, Upload } from 'lucide-react';
import { apiFetch, formatINR, formatShortDate } from '../lib/format';
import type { Batch, Medicine, Supplier, UserSession } from '../types';

interface InventoryViewProps {
  medicines: Medicine[];
  batches: Batch[];
  suppliers: Supplier[];
  user: UserSession;
  initialSubTab?: 'catalog' | 'expiry' | 'add' | 'import';
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function InventoryView({
  medicines,
  batches,
  suppliers,
  user,
  initialSubTab = 'catalog',
  onRefresh,
  onNotify,
}: InventoryViewProps) {
  const [subTab, setSubTab] = useState<'catalog' | 'expiry' | 'add' | 'import'>(initialSubTab);
  const [expiryFilter, setExpiryFilter] = useState<'all' | 'near_expiry' | 'expired' | 'active'>('all');
  const [search, setSearch] = useState('');

  // Add batch form
  const [selectedMedId, setSelectedMedId] = useState<number>(medicines[0]?.id ?? 1);
  const [batchNo, setBatchNo] = useState('');
  const [mfgDate, setMfgDate] = useState(new Date().toISOString().slice(0, 10));
  const [expiryDate, setExpiryDate] = useState('');
  const [qty, setQty] = useState('100');
  const [costPrice, setCostPrice] = useState('10.00');
  const [mrp, setMrp] = useState('16.00');

  // New medicine SKU form
  const [newBrand, setNewBrand] = useState('');
  const [newGeneric, setNewGeneric] = useState('');
  const [newStrength, setNewStrength] = useState('500 mg');
  const [newCategory, setNewCategory] = useState('General');
  const [newHsn, setNewHsn] = useState('30049099');
  const [newGst, setNewGst] = useState('12');
  const [newReorder, setNewReorder] = useState('50');
  const [newSupplierId, setNewSupplierId] = useState<number>(suppliers[0]?.id ?? 1);

  // CSV Bulk Import state
  const [csvText, setCsvText] = useState(
    'brand_name,generic_name,batch_no,expiry_date,qty,cost_price,mrp\nAugmentin 625 Duo,Amoxicillin + Clavulanic Acid,AUG-2691,2027-09-30,120,16.50,25.40\nLoprin-75,Aspirin,LOP-7720,2027-08-15,150,0.42,0.80'
  );
  const [saving, setSaving] = useState(false);

  const filteredMeds = medicines.filter((m) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      m.brand_name.toLowerCase().includes(q) ||
      m.generic_name.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q)
    );
  });

  const filteredBatches = batches.filter((b) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      b.brand_name.toLowerCase().includes(q) ||
      b.generic_name.toLowerCase().includes(q) ||
      b.batch_no.toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (expiryFilter === 'near_expiry') {
      return b.qty_available > 0 && b.risk_tier !== 'expired' && b.days_to_expiry <= 90;
    }
    if (expiryFilter === 'expired') {
      return b.qty_available > 0 && b.risk_tier === 'expired';
    }
    if (expiryFilter === 'active') {
      return b.qty_available > 0 && b.risk_tier !== 'expired';
    }
    return b.qty_available > 0;
  });

  async function handleAddBatch(e: FormEvent) {
    e.preventDefault();
    if (!batchNo.trim() || !expiryDate) {
      onNotify('Batch number and expiry date are required.', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/batches', {
        method: 'POST',
        body: JSON.stringify({
          medicine_id: selectedMedId,
          batch_no: batchNo.trim(),
          mfg_date: mfgDate,
          expiry_date: expiryDate,
          qty_available: Number(qty),
          cost_price: Number(costPrice),
          mrp: Number(mrp),
          actor_name: user.name,
          actor_role: user.role,
        }),
      });
      await onRefresh();
      setBatchNo('');
      onNotify(`Batch ${batchNo.trim()} added to active inventory`);
      setSubTab('expiry');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to add batch', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateMedicine(e: FormEvent) {
    e.preventDefault();
    if (!newBrand.trim() || !newGeneric.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/api/medicines', {
        method: 'POST',
        body: JSON.stringify({
          brand_name: newBrand.trim(),
          generic_name: newGeneric.trim(),
          strength: newStrength,
          category: newCategory,
          hsn_code: newHsn,
          gst_rate: Number(newGst),
          reorder_level: Number(newReorder),
          target_stock: Number(newReorder) * 3,
          preferred_supplier_id: newSupplierId,
          actor_name: user.name,
          actor_role: user.role,
        }),
      });
      await onRefresh();
      setNewBrand('');
      setNewGeneric('');
      onNotify(`Medicine ${newBrand.trim()} added to catalog`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to create medicine', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleBatchAction(batchId: number, action: 'adjust' | 'quarantine' | 'remove', delta = 0) {
    try {
      await apiFetch(`/api/batches/${batchId}/adjust`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          delta_qty: delta,
          reason:
            action === 'quarantine'
              ? 'Quarantined from expiry tracking desk'
              : action === 'remove'
              ? 'Removed batch from active shelf'
              : `Stock count adjustment (${delta > 0 ? '+' : ''}${delta})`,
          actor_name: user.name,
          actor_role: user.role,
        }),
      });
      await onRefresh();
      onNotify('Inventory batch updated');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to adjust batch', 'error');
    }
  }

  async function handleCsvImport(e: FormEvent) {
    e.preventDefault();
    const lines = csvText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      onNotify('Provide a CSV header row plus at least one batch row.', 'error');
      return;
    }
    const rows = lines.slice(1).map((line) => {
      const [brand_name, generic_name, batch_no, expiry_date, qtyStr, costStr, mrpStr] = line
        .split(',')
        .map((c) => c.trim());
      return {
        brand_name,
        generic_name,
        batch_no,
        expiry_date,
        qty: Number(qtyStr),
        cost_price: Number(costStr),
        mrp: Number(mrpStr),
      };
    });

    setSaving(true);
    try {
      const res = await apiFetch<{ imported: number }>('/api/batches/import', {
        method: 'POST',
        body: JSON.stringify({ rows, actor_name: user.name, actor_role: user.role }),
      });
      await onRefresh();
      onNotify(`Imported ${res.imported} batches into live SQLite inventory`);
      setSubTab('expiry');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'CSV import failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Sub-navigation & Search */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
          {(
            [
              { id: 'catalog', label: `All Stock (${medicines.length})` },
              { id: 'expiry', label: 'Expiry Tracking & Batches' },
              { id: 'add', label: 'Add Stock / New SKU' },
              { id: 'import', label: 'Import CSV' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {(subTab === 'catalog' || subTab === 'expiry') && (
          <div className="relative w-full lg:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter brand, generic, batch..."
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
            />
          </div>
        )}
      </div>

      {subTab === 'catalog' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Real-Time Medicine Stock Catalog</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Aggregated active non-expired stock vs. low-stock reorder thresholds.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 pr-3">Medicine & Salt</th>
                  <th className="py-2.5 px-3">Category · Rack</th>
                  <th className="py-2.5 px-3 text-right">GST · HSN</th>
                  <th className="py-2.5 px-3 text-right">Active Stock</th>
                  <th className="py-2.5 px-3 text-right">Reorder At</th>
                  <th className="py-2.5 px-3">Earliest Expiry</th>
                  <th className="py-2.5 pl-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredMeds.map((med) => {
                  const isOut = med.total_active_stock === 0;
                  const isLow = med.total_active_stock > 0 && med.total_active_stock <= med.reorder_level;
                  return (
                    <tr key={med.id} className="hover:bg-slate-50">
                      <td className="py-3 pr-3">
                        <div className="font-semibold text-slate-900 text-sm">
                          {med.brand_name}{' '}
                          <span className="text-xs font-normal text-slate-500">{med.strength}</span>
                        </div>
                        <div className="text-slate-500">{med.generic_name}</div>
                      </td>
                      <td className="py-3 px-3 text-slate-600">
                        {med.category} · <span className="font-mono">{med.rack_location}</span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                        {med.gst_rate}% · {med.hsn_code}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                        {med.total_active_stock}
                        {med.total_expired_stock > 0 && (
                          <div className="text-[11px] font-normal text-red-600">
                            +{med.total_expired_stock} expired
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-500">
                        {med.reorder_level}
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-700">
                        {formatShortDate(med.earliest_expiry)}
                      </td>
                      <td className="py-3 pl-3 text-right font-semibold">
                        {isOut ? (
                          <span className="text-red-600">Out of Stock</span>
                        ) : isLow ? (
                          <span className="text-amber-700">Low Stock Alert</span>
                        ) : (
                          <span className="text-emerald-700">Healthy</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'expiry' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">Batch & Expiry Tracking Page</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Filter near-expiry or expired batches, adjust shelf counts, or quarantine unsafe stock.
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
              {(
                [
                  { id: 'all', label: 'All Batches' },
                  { id: 'near_expiry', label: 'Near Expiry (≤90d)' },
                  { id: 'expired', label: 'Expired / Quarantined' },
                  { id: 'active', label: 'Active Only' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setExpiryFilter(f.id)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    expiryFilter === f.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 pr-3">Batch & Medicine</th>
                  <th className="py-2.5 px-3">Expiry & Window</th>
                  <th className="py-2.5 px-3 text-right">Qty</th>
                  <th className="py-2.5 px-3 text-right">Cost / MRP</th>
                  <th className="py-2.5 px-3 text-right">Cost Value</th>
                  <th className="py-2.5 pl-3 text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredBatches.map((b) => {
                  const tierText =
                    b.risk_tier === 'expired'
                      ? 'Expired (Blocked)'
                      : b.risk_tier === 'critical'
                      ? 'Red (<30d)'
                      : b.risk_tier === 'amber'
                      ? 'Amber (30-60d)'
                      : b.risk_tier === 'green'
                      ? 'Green (61-90d)'
                      : 'Safe (>90d)';
                  const tierColor =
                    b.risk_tier === 'expired' || b.risk_tier === 'critical'
                      ? 'text-red-700'
                      : b.risk_tier === 'amber'
                      ? 'text-amber-700'
                      : 'text-emerald-700';

                  return (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="py-3 pr-3">
                        <div className="font-semibold text-slate-900">
                          {b.brand_name}{' '}
                          <span className="font-mono text-slate-500">· {b.batch_no}</span>
                        </div>
                        <div className="text-slate-500">
                          {b.generic_name} · Rack {b.rack_location}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-mono text-slate-900">{formatShortDate(b.expiry_date)}</div>
                        <div className={`font-semibold ${tierColor}`}>
                          {tierText} ({b.days_to_expiry}d)
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                        {b.qty_available}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                        ₹{b.cost_price.toFixed(2)} / ₹{b.mrp.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {formatINR(b.cost_value_at_risk)}
                      </td>
                      <td className="py-3 pl-3 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleBatchAction(b.id, 'adjust', 10)}
                          className="px-2 py-1 text-[11px] font-mono font-semibold border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
                        >
                          +10
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBatchAction(b.id, 'adjust', -5)}
                          className="px-2 py-1 text-[11px] font-mono font-semibold border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
                        >
                          -5
                        </button>
                        {b.status === 'active' ? (
                          <button
                            type="button"
                            onClick={() => handleBatchAction(b.id, 'quarantine')}
                            className="px-2 py-1 text-[11px] font-semibold text-amber-800 border border-amber-200 bg-amber-50 rounded hover:bg-amber-100 cursor-pointer"
                          >
                            Quarantine
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleBatchAction(b.id, 'remove')}
                            className="px-2 py-1 text-[11px] font-semibold text-red-700 border border-red-200 bg-red-50 rounded hover:bg-red-100 cursor-pointer"
                          >
                            Clear
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'add' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form onSubmit={handleAddBatch} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-600" /> Add Stock Batch to Existing Medicine
            </h3>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Medicine</label>
              <select
                value={selectedMedId}
                onChange={(e) => setSelectedMedId(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              >
                {medicines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.brand_name} ({m.generic_name} · {m.strength})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Batch Number</label>
                <input
                  required
                  value={batchNo}
                  onChange={(e) => setBatchNo(e.target.value)}
                  placeholder="e.g. MXK-2026B"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Quantity (Units)</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Mfg Date</label>
                <input
                  type="date"
                  value={mfgDate}
                  onChange={(e) => setMfgDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Expiry Date</label>
                <input
                  type="date"
                  required
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Purchase Cost (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">MRP (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={mrp}
                  onChange={(e) => setMrp(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg cursor-pointer"
            >
              Add Batch to Inventory
            </button>
          </form>

          <form onSubmit={handleCreateMedicine} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Register New Medicine SKU</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Brand Name</label>
                <input
                  required
                  value={newBrand}
                  onChange={(e) => setNewBrand(e.target.value)}
                  placeholder="e.g. Allegra 120"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Generic Salt</label>
                <input
                  required
                  value={newGeneric}
                  onChange={(e) => setNewGeneric(e.target.value)}
                  placeholder="e.g. Fexofenadine"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Strength</label>
                <input
                  value={newStrength}
                  onChange={(e) => setNewStrength(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                <input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">HSN Code</label>
                <input
                  value={newHsn}
                  onChange={(e) => setNewHsn(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">GST Slab (%)</label>
                <select
                  value={newGst}
                  onChange={(e) => setNewGst(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                >
                  <option value="0">0%</option>
                  <option value="5">5%</option>
                  <option value="12">12%</option>
                  <option value="18">18%</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Reorder Level</label>
                <input
                  type="number"
                  value={newReorder}
                  onChange={(e) => setNewReorder(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Preferred Supplier</label>
                <select
                  value={newSupplierId}
                  onChange={(e) => setNewSupplierId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg cursor-pointer"
            >
              Register Medicine SKU
            </button>
          </form>
        </div>
      )}

      {subTab === 'import' && (
        <form onSubmit={handleCsvImport} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Upload className="w-4 h-4 text-teal-600" /> Bulk Stock Batch Import (CSV)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Paste CSV rows or load a local CSV file to import batch quantities, expiry dates, and pricing.
              </p>
            </div>
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
              <Download className="w-3.5 h-3.5" /> Load .CSV File
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  file.text().then((txt) => setCsvText(txt));
                }}
              />
            </label>
          </div>

          <textarea
            rows={7}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            className="w-full p-3 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
          />

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              {saving ? 'Importing...' : 'Import Batches into SQLite'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
