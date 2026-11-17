import { useEffect, useState, type FormEvent } from 'react';
import { Mail, PackagePlus, Plus, Truck, X } from 'lucide-react';
import { apiFetch, formatDateTime, formatINR } from '../lib/format';
import type { GrnRecord, Medicine, PurchaseOrder, ReorderItem, Supplier, UserSession } from '../types';

interface ProcurementViewProps {
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  grnRecords: GrnRecord[];
  medicines: Medicine[];
  user: UserSession;
  prefillReorder: ReorderItem | null;
  clearPrefillReorder: () => void;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function ProcurementView({
  suppliers,
  purchaseOrders,
  grnRecords,
  medicines,
  user,
  prefillReorder,
  clearPrefillReorder,
  onRefresh,
  onNotify,
}: ProcurementViewProps) {
  const [subTab, setSubTab] = useState<'po' | 'grn' | 'suppliers'>('po');

  // Supplier modal state
  const [showSupModal, setShowSupModal] = useState(false);
  const [editingSup, setEditingSup] = useState<Supplier | null>(null);
  const [supName, setSupName] = useState('');
  const [supContact, setSupContact] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supEmail, setSupEmail] = useState('');
  const [supGstin, setSupGstin] = useState('');
  const [supCity, setSupCity] = useState('');
  const [supLead, setSupLead] = useState('2');

  // Create PO form
  const [poSupplierId, setPoSupplierId] = useState<number>(suppliers[0]?.id ?? 1);
  const [poNotes, setPoNotes] = useState('');
  const [poMedId, setPoMedId] = useState<number>(medicines[0]?.id ?? 1);
  const [poQty, setPoQty] = useState('100');
  const [poCost, setPoCost] = useState('12.00');
  const [poDraftItems, setPoDraftItems] = useState<
    Array<{ medicine_id: number; qty_ordered: number; unit_cost: number }>
  >([]);
  const [emailPreviewPo, setEmailPreviewPo] = useState<PurchaseOrder | null>(null);

  // GRN Intake form
  const [grnPoId, setGrnPoId] = useState<string>('');
  const [grnSupplierId, setGrnSupplierId] = useState<number>(suppliers[0]?.id ?? 1);
  const [grnInvoiceRef, setGrnInvoiceRef] = useState('');
  const [grnMedId, setGrnMedId] = useState<number>(medicines[0]?.id ?? 1);
  const [grnBatchNo, setGrnBatchNo] = useState('');
  const [grnMfg, setGrnMfg] = useState(new Date().toISOString().slice(0, 10));
  const [grnExp, setGrnExp] = useState('2028-06-30');
  const [grnQty, setGrnQty] = useState('100');
  const [grnCost, setGrnCost] = useState('12.00');
  const [grnMrp, setGrnMrp] = useState('18.50');
  const [saving, setSaving] = useState(false);

  // Prefill PO directly when user clicks "Draft PO" from Dashboard Reorder List
  useEffect(() => {
    if (prefillReorder) {
      setSubTab('po');
      setPoSupplierId(prefillReorder.supplier_id);
      setPoNotes(`Replenishment order for low-stock item ${prefillReorder.brand_name}`);
      setPoDraftItems([
        {
          medicine_id: prefillReorder.medicine_id,
          qty_ordered: prefillReorder.suggested_order_qty,
          unit_cost: prefillReorder.est_unit_cost,
        },
      ]);
      clearPrefillReorder();
    }
  }, [prefillReorder, clearPrefillReorder]);

  function openNewSupplier() {
    setEditingSup(null);
    setSupName('');
    setSupContact('');
    setSupPhone('');
    setSupEmail('');
    setSupGstin('');
    setSupCity('');
    setSupLead('2');
    setShowSupModal(true);
  }

  function openEditSupplier(s: Supplier) {
    setEditingSup(s);
    setSupName(s.name);
    setSupContact(s.contact_person);
    setSupPhone(s.phone);
    setSupEmail(s.email);
    setSupGstin(s.gstin);
    setSupCity(s.city);
    setSupLead(String(s.lead_time_days));
    setShowSupModal(true);
  }

  async function handleSaveSupplier(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: supName,
        contact_person: supContact,
        phone: supPhone,
        email: supEmail,
        gstin: supGstin,
        city: supCity,
        lead_time_days: Number(supLead),
        actor_name: user.name,
        actor_role: user.role,
      };
      if (editingSup) {
        await apiFetch(`/api/suppliers/${editingSup.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        onNotify(`Supplier ${supName} updated`);
      } else {
        await apiFetch('/api/suppliers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onNotify(`Supplier ${supName} added`);
      }
      await onRefresh();
      setShowSupModal(false);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save supplier', 'error');
    } finally {
      setSaving(false);
    }
  }

  function addPoLine() {
    setPoDraftItems((prev) => [
      ...prev,
      {
        medicine_id: poMedId,
        qty_ordered: Math.max(1, Number(poQty) || 50),
        unit_cost: Math.max(0.1, Number(poCost) || 10),
      },
    ]);
  }

  async function handleCreatePo(e: FormEvent) {
    e.preventDefault();
    if (poDraftItems.length === 0) {
      onNotify('Add at least one medicine line to create a Purchase Order.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch<{ po_number: string }>('/api/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({
          supplier_id: poSupplierId,
          notes: poNotes,
          items: poDraftItems,
          actor_name: user.name,
          actor_role: user.role,
        }),
      });
      await onRefresh();
      setPoDraftItems([]);
      setPoNotes('');
      onNotify(`Created Purchase Order ${res.po_number}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to create PO', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDispatchEmail(po: PurchaseOrder) {
    setSaving(true);
    try {
      const res = await apiFetch<{ emailed_to: string }>(`/api/purchase-orders/${po.id}/email`, {
        method: 'POST',
        body: JSON.stringify({ actor_name: user.name, actor_role: user.role }),
      });
      await onRefresh();
      setEmailPreviewPo(null);
      onNotify(`Purchase Order ${po.po_number} emailed to ${res.emailed_to}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to dispatch PO email', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateGrn(e: FormEvent) {
    e.preventDefault();
    if (!grnInvoiceRef.trim() || !grnBatchNo.trim() || !grnExp) {
      onNotify('Vendor invoice reference, batch number, and expiry date are required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch<{ grn_number: string }>('/api/grn', {
        method: 'POST',
        body: JSON.stringify({
          po_id: grnPoId ? Number(grnPoId) : null,
          supplier_id: grnSupplierId,
          invoice_ref: grnInvoiceRef.trim(),
          items: [
            {
              medicine_id: grnMedId,
              batch_no: grnBatchNo.trim(),
              mfg_date: grnMfg,
              expiry_date: grnExp,
              qty: Number(grnQty),
              cost_price: Number(grnCost),
              mrp: Number(grnMrp),
            },
          ],
          actor_name: user.name,
          actor_role: user.role,
        }),
      });
      await onRefresh();
      setGrnInvoiceRef('');
      setGrnBatchNo('');
      setGrnPoId('');
      onNotify(`GRN ${res.grn_number} recorded — batch stock added to inventory`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'GRN intake failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
          {(
            [
              { id: 'po', label: `Purchase Orders (${purchaseOrders.length})` },
              { id: 'grn', label: `Goods Received Note (${grnRecords.length})` },
              { id: 'suppliers', label: `Suppliers (${suppliers.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {subTab === 'suppliers' && (
          <button
            type="button"
            onClick={openNewSupplier}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add Supplier
          </button>
        )}
      </div>

      {subTab === 'po' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Create PO Form */}
          <form
            onSubmit={handleCreatePo}
            className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-slate-900">Create Purchase Order (PO)</h3>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Supplier</label>
              <select
                value={poSupplierId}
                onChange={(e) => setPoSupplierId(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.city})
                  </option>
                ))}
              </select>
            </div>

            <div className="border-t border-slate-100 pt-3 space-y-2">
              <label className="block text-xs font-semibold text-slate-700">Add Order Line</label>
              <div className="grid grid-cols-12 gap-2">
                <select
                  value={poMedId}
                  onChange={(e) => setPoMedId(Number(e.target.value))}
                  className="col-span-6 px-2.5 py-2 text-xs border border-slate-200 rounded-lg"
                >
                  {medicines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.brand_name} ({m.total_active_stock} on hand)
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={poQty}
                  onChange={(e) => setPoQty(e.target.value)}
                  placeholder="Qty"
                  className="col-span-2 px-2 py-2 text-xs border border-slate-200 rounded-lg font-mono"
                />
                <input
                  type="number"
                  step="0.01"
                  value={poCost}
                  onChange={(e) => setPoCost(e.target.value)}
                  placeholder="Cost ₹"
                  className="col-span-3 px-2 py-2 text-xs border border-slate-200 rounded-lg font-mono"
                />
                <button
                  type="button"
                  onClick={addPoLine}
                  className="col-span-1 bg-slate-900 text-white text-xs font-bold rounded-lg cursor-pointer"
                >
                  +
                </button>
              </div>
            </div>

            {poDraftItems.length > 0 && (
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg text-xs">
                {poDraftItems.map((it, idx) => {
                  const med = medicines.find((m) => m.id === it.medicine_id);
                  return (
                    <li key={idx} className="px-3 py-2 flex items-center justify-between">
                      <span>
                        <strong>{med?.brand_name}</strong> ·{' '}
                        <span className="font-mono">
                          {it.qty_ordered} × ₹{it.unit_cost.toFixed(2)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setPoDraftItems((p) => p.filter((_, i) => i !== idx))}
                        className="text-red-600 hover:underline cursor-pointer"
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">PO Instructions</label>
              <input
                value={poNotes}
                onChange={(e) => setPoNotes(e.target.value)}
                placeholder="Delivery window or cold-chain handling note"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg cursor-pointer"
            >
              Create Purchase Order
            </button>
          </form>

          {/* PO List */}
          <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Active & Historical Purchase Orders</h3>
            <div className="divide-y divide-slate-100">
              {purchaseOrders.map((po) => (
                <div key={po.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono font-bold text-slate-900">{po.po_number}</span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="font-semibold text-slate-800">{po.supplier_name}</span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span
                        className={`text-xs font-semibold ${
                          po.status === 'Received'
                            ? 'text-emerald-700'
                            : po.status === 'Sent'
                            ? 'text-teal-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {po.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {po.items.map((it) => `${it.brand_name} (${it.qty_ordered})`).join(', ')} ·{' '}
                      {formatDateTime(po.created_at)}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right font-mono tabular-nums font-bold text-sm text-slate-900">
                      {formatINR(po.total_amount)}
                    </div>
                    {po.status === 'Draft' ? (
                      <button
                        type="button"
                        onClick={() => setEmailPreviewPo(po)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg cursor-pointer"
                      >
                        <Mail className="w-3.5 h-3.5" /> Email PO
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEmailPreviewPo(po)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                      >
                        View PO
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {subTab === 'grn' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleCreateGrn}
            className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <PackagePlus className="w-4 h-4 text-emerald-600" /> Record Goods Received Note (GRN)
            </h3>
            <p className="text-xs text-slate-500">
              Intake supplier shipments with batch number and expiry date to immediately update shelf stock.
            </p>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Link Purchase Order (Optional)
              </label>
              <select
                value={grnPoId}
                onChange={(e) => {
                  const val = e.target.value;
                  setGrnPoId(val);
                  const found = purchaseOrders.find((p) => String(p.id) === val);
                  if (found) {
                    setGrnSupplierId(found.supplier_id);
                    if (found.items[0]) {
                      setGrnMedId(found.items[0].medicine_id);
                      setGrnQty(String(found.items[0].qty_ordered));
                      setGrnCost(String(found.items[0].unit_cost));
                    }
                  }
                }}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
              >
                <option value="">Direct Delivery (No PO)</option>
                {purchaseOrders
                  .filter((p) => p.status !== 'Received')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.po_number} · {p.supplier_name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Supplier</label>
                <select
                  value={grnSupplierId}
                  onChange={(e) => setGrnSupplierId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Supplier Invoice Ref
                </label>
                <input
                  required
                  value={grnInvoiceRef}
                  onChange={(e) => setGrnInvoiceRef(e.target.value)}
                  placeholder="e.g. SUP-GST-4012"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Medicine Received</label>
              <select
                value={grnMedId}
                onChange={(e) => setGrnMedId(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
              >
                {medicines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.brand_name} ({m.strength})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Batch No</label>
                <input
                  required
                  value={grnBatchNo}
                  onChange={(e) => setGrnBatchNo(e.target.value)}
                  placeholder="BATCH-2026X"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Qty Received</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={grnQty}
                  onChange={(e) => setGrnQty(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Mfg Date</label>
                <input
                  type="date"
                  value={grnMfg}
                  onChange={(e) => setGrnMfg(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Expiry Date</label>
                <input
                  type="date"
                  required
                  value={grnExp}
                  onChange={(e) => setGrnExp(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Cost Price (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={grnCost}
                  onChange={(e) => setGrnCost(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">MRP (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={grnMrp}
                  onChange={(e) => setGrnMrp(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg cursor-pointer"
            >
              Record GRN & Update Inventory
            </button>
          </form>

          <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-base font-bold text-slate-900 mb-4">Goods Received History</h3>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 pr-3">GRN No</th>
                  <th className="py-2.5 px-3">Supplier · PO</th>
                  <th className="py-2.5 px-3">Vendor Ref</th>
                  <th className="py-2.5 px-3 text-right">Intake Cost</th>
                  <th className="py-2.5 pl-3 text-right">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {grnRecords.map((g) => (
                  <tr key={g.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-3 font-mono font-bold text-slate-900">{g.grn_number}</td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900">{g.supplier_name}</div>
                      <div className="text-slate-500 font-mono">{g.po_number || 'Direct Intake'}</div>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-700">{g.invoice_ref}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatINR(g.total_cost)}
                    </td>
                    <td className="py-3 pl-3 text-right text-slate-500">
                      <div>{g.received_by}</div>
                      <div>{formatDateTime(g.created_at)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'suppliers' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Truck className="w-4 h-4 text-teal-600" /> Approved Pharmaceutical Suppliers
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 pr-3">Distributor</th>
                  <th className="py-2.5 px-3">Contact Person</th>
                  <th className="py-2.5 px-3">Phone & Email</th>
                  <th className="py-2.5 px-3">GSTIN · City</th>
                  <th className="py-2.5 px-3 text-right">Lead Time</th>
                  <th className="py-2.5 pl-3 text-right">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppliers.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-3 font-semibold text-slate-900 text-sm">{s.name}</td>
                    <td className="py-3 px-3 text-slate-700">{s.contact_person}</td>
                    <td className="py-3 px-3">
                      <div className="font-mono text-slate-800">{s.phone}</div>
                      <div className="text-slate-500">{s.email}</div>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-600">
                      {s.gstin} · {s.city}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                      {s.lead_time_days} days
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEditSupplier(s)}
                        className="px-2.5 py-1 text-xs font-semibold border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Email PO Modal */}
      {emailPreviewPo && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Purchase Order Dispatch · {emailPreviewPo.po_number}
              </h3>
              <button
                type="button"
                onClick={() => setEmailPreviewPo(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div>
                <strong>To:</strong> {emailPreviewPo.supplier_name} ({emailPreviewPo.supplier_email})
              </div>
              <div>
                <strong>Subject:</strong> Medoryx Pharmacy Purchase Order {emailPreviewPo.po_number}
              </div>
              <div className="border-t border-slate-200 pt-2">
                {emailPreviewPo.items.map((it) => (
                  <div key={it.id} className="flex justify-between py-1 font-mono">
                    <span>
                      {it.brand_name} ({it.qty_ordered} units)
                    </span>
                    <span>{formatINR(it.line_total)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 border-t border-slate-200 font-bold font-mono">
                  <span>Order Total</span>
                  <span>{formatINR(emailPreviewPo.total_amount)}</span>
                </div>
              </div>
              {emailPreviewPo.notes && (
                <div className="text-slate-600 pt-1">Note: {emailPreviewPo.notes}</div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEmailPreviewPo(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 cursor-pointer"
              >
                Close
              </button>
              {emailPreviewPo.status === 'Draft' && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleDispatchEmail(emailPreviewPo)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
                >
                  <Mail className="w-3.5 h-3.5" /> Send Email to Supplier
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Supplier Modal */}
      {showSupModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">
                {editingSup ? 'Edit Supplier' : 'Add Supplier'}
              </h3>
              <button
                type="button"
                onClick={() => setShowSupModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveSupplier} className="space-y-3 mt-4">
              <input
                required
                value={supName}
                onChange={(e) => setSupName(e.target.value)}
                placeholder="Distributor Name"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <input
                value={supContact}
                onChange={(e) => setSupContact(e.target.value)}
                placeholder="Contact Person"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={supPhone}
                  onChange={(e) => setSupPhone(e.target.value)}
                  placeholder="Phone"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
                <input
                  required
                  type="email"
                  value={supEmail}
                  onChange={(e) => setSupEmail(e.target.value)}
                  placeholder="Email"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  value={supGstin}
                  onChange={(e) => setSupGstin(e.target.value)}
                  placeholder="GSTIN"
                  className="col-span-2 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
                <input
                  type="number"
                  value={supLead}
                  onChange={(e) => setSupLead(e.target.value)}
                  placeholder="Lead d"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <input
                value={supCity}
                onChange={(e) => setSupCity(e.target.value)}
                placeholder="City"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSupModal(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
                >
                  Save Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
