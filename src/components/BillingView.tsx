import { useEffect, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  FileText,
  Info,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch, formatDateTime, formatINR, formatShortDate } from '../lib/format';
import type {
  BillingPreviewResponse,
  EmrPrescription,
  InvoiceRecord,
  Medicine,
  UserSession,
} from '../types';

export interface CartEntry {
  medicine_id: number;
  qty: number;
}

interface BillingViewProps {
  medicines: Medicine[];
  invoices: InvoiceRecord[];
  user: UserSession;
  cart: CartEntry[];
  setCart: React.Dispatch<React.SetStateAction<CartEntry[]>>;
  linkedRx: EmrPrescription | null;
  setLinkedRx: (rx: EmrPrescription | null) => void;
  onRefreshAll: () => Promise<void>;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function BillingView({
  medicines,
  invoices,
  user,
  cart,
  setCart,
  linkedRx,
  setLinkedRx,
  onRefreshAll,
  onNotify,
}: BillingViewProps) {
  const [subTab, setSubTab] = useState<'pos' | 'history'>('pos');
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<BillingPreviewResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [customerName, setCustomerName] = useState('Walk-in Patient');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'UPI' | 'Card' | 'Insurance'>('UPI');
  const [paymentRef, setPaymentRef] = useState('');
  const [severeAckChecked, setSevereAckChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receiptInvoice, setReceiptInvoice] = useState<InvoiceRecord | null>(null);

  // Sync customer details if linked from EMR Prescription
  useEffect(() => {
    if (linkedRx) {
      setCustomerName(linkedRx.patient_name);
      setCustomerPhone(linkedRx.patient_phone);
    }
  }, [linkedRx]);

  // Live FEFO + Drug Interaction + Brand-Swap preview from SQLite backend
  useEffect(() => {
    let cancelled = false;
    async function runPreview() {
      if (cart.length === 0) {
        setPreview(null);
        return;
      }
      setLoadingPreview(true);
      try {
        const res = await apiFetch<BillingPreviewResponse>('/api/billing/preview', {
          method: 'POST',
          body: JSON.stringify({ items: cart }),
        });
        if (!cancelled) {
          setPreview(res);
          setSevereAckChecked(false);
        }
      } catch {
        // Silent preview fallback
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }
    runPreview();
    return () => {
      cancelled = true;
    };
  }, [cart]);

  function addMedicineToCart(medId: number) {
    setCart((prev) => {
      const existing = prev.find((i) => i.medicine_id === medId);
      if (existing) {
        return prev.map((i) => (i.medicine_id === medId ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { medicine_id: medId, qty: 1 }];
    });
  }

  function updateQty(medId: number, nextQty: number) {
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((i) => i.medicine_id !== medId));
    } else {
      setCart((prev) => prev.map((i) => (i.medicine_id === medId ? { ...i, qty: nextQty } : i)));
    }
  }

  function swapBrandInCart(oldMedicineId: number, newMedicineId: number, newBrandName: string) {
    setCart((prev) => {
      const oldLine = prev.find((i) => i.medicine_id === oldMedicineId);
      const qtyToKeep = oldLine ? oldLine.qty : 1;
      const withoutOld = prev.filter((i) => i.medicine_id !== oldMedicineId);
      const alreadyHasNew = withoutOld.find((i) => i.medicine_id === newMedicineId);
      if (alreadyHasNew) {
        return withoutOld.map((i) =>
          i.medicine_id === newMedicineId ? { ...i, qty: i.qty + qtyToKeep } : i
        );
      }
      return [...withoutOld, { medicine_id: newMedicineId, qty: qtyToKeep }];
    });
    onNotify(`Swapped to ${newBrandName} (same generic ingredient)`);
  }

  async function handleCheckout() {
    if (!preview || preview.lines.length === 0) return;
    if (preview.has_shortfall) {
      onNotify('Resolve out-of-stock items using Brand-Swap or adjust quantities first.', 'error');
      return;
    }
    if (preview.has_severe_interaction && !severeAckChecked) {
      onNotify('Pharmacist clinical acknowledgement is required for Severe drug interactions.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const created = await apiFetch<InvoiceRecord>('/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: customerName.trim() || 'Walk-in Patient',
          customer_phone: customerPhone.trim(),
          rx_id: linkedRx?.id ?? null,
          payment_method: paymentMethod,
          payment_ref:
            paymentRef.trim() ||
            (paymentMethod === 'Cash' ? 'CASH-COUNTER' : `${paymentMethod.toUpperCase()}-${Date.now().toString().slice(-6)}`),
          items: cart,
          interaction_ack_by: preview.has_severe_interaction ? `${user.name} (${user.license_no})` : null,
          actor_name: user.name,
          actor_role: user.role,
        }),
      });
      setCart([]);
      setLinkedRx(null);
      setPaymentRef('');
      setReceiptInvoice(created);
      await onRefreshAll();
      onNotify(`Tax Invoice ${created.invoice_no} generated & FEFO batches updated`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Checkout failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const filteredMeds = medicines.filter((m) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      m.brand_name.toLowerCase().includes(q) ||
      m.generic_name.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      m.hsn_code.includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Top POS / History Switcher */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setSubTab('pos')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              subTab === 'pos' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            POS FEFO Counter
          </button>
          <button
            type="button"
            onClick={() => setSubTab('history')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              subTab === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Issued GST Invoices ({invoices.length})
          </button>
        </div>

        {linkedRx && (
          <div className="flex items-center gap-3 text-xs bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-1.5 rounded-lg">
            <span>
              Linked EMR Rx: <strong className="font-mono">{linkedRx.rx_code}</strong> ({linkedRx.patient_name})
            </span>
            <button
              type="button"
              onClick={() => setLinkedRx(null)}
              className="text-emerald-700 hover:text-emerald-950 font-semibold cursor-pointer"
            >
              Unlink
            </button>
          </div>
        )}
      </div>

      {subTab === 'history' ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-base font-bold text-slate-900 mb-4">Tax-Compliant Invoices & Receipts</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 pr-3">Invoice No</th>
                  <th className="py-2.5 px-3">Customer / Rx</th>
                  <th className="py-2.5 px-3">Payment</th>
                  <th className="py-2.5 px-3 text-right">Taxable</th>
                  <th className="py-2.5 px-3 text-right">CGST + SGST</th>
                  <th className="py-2.5 px-3 text-right">Grand Total</th>
                  <th className="py-2.5 pl-3 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-3">
                      <div className="font-mono font-bold text-slate-900">{inv.invoice_no}</div>
                      <div className="text-[11px] text-slate-500">{formatDateTime(inv.created_at)}</div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900">{inv.customer_name}</div>
                      <div className="text-slate-500">
                        {inv.rx_code ? `EMR ${inv.rx_code}` : 'OTC Counter Sale'} · {inv.items.length} batch lines
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-800">{inv.payment_method}</div>
                      <div className="font-mono text-[11px] text-slate-500">{inv.payment_ref || '—'}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {formatINR(inv.subtotal)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                      {formatINR(inv.cgst_total + inv.sgst_total)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {formatINR(inv.grand_total)}
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => setReceiptInvoice(inv)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-teal-700 border border-slate-200 hover:bg-slate-100 rounded-md cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" /> View Receipt
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left Medicine Picker */}
          <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Medicine Search & Quick Add</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                FEFO auto-selects earliest non-expired batch. Expired batches are blocked.
              </p>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search brand, generic salt (e.g. Aspirin, Warfarin)..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>

            <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto pr-1">
              {filteredMeds.map((med) => {
                const outOfStock = med.total_active_stock === 0;
                return (
                  <div
                    key={med.id}
                    className="py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 truncate">
                          {med.brand_name}
                        </span>
                        <span className="text-xs text-slate-500">{med.strength}</span>
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {med.generic_name} · GST {med.gst_rate}% ·{' '}
                        {outOfStock ? (
                          <span className="font-semibold text-red-600">Out of stock</span>
                        ) : (
                          <span className="font-mono tabular-nums text-emerald-700">
                            {med.total_active_stock} avail (Exp {formatShortDate(med.earliest_expiry)})
                          </span>
                        )}
                      </div>
                      {med.total_expired_stock > 0 && (
                        <div className="text-[11px] text-red-600 font-medium">
                          {med.total_expired_stock} expired units blocked from sale
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => addMedicineToCart(med.id)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        outOfStock
                          ? 'bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100'
                          : 'bg-slate-900 text-white hover:bg-emerald-700'
                      }`}
                    >
                      {outOfStock ? 'Check Swap' : '+ Add'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Live Counter Bill, FEFO Allocator, Drug Interactions & Payment */}
          <div className="xl:col-span-7 space-y-5">
            {/* Live Drug Interaction Alerts */}
            {preview && preview.interactions.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-red-600" />
                    Live Drug-Interaction Screening ({preview.interactions.length} alert
                    {preview.interactions.length > 1 ? 's' : ''})
                  </h3>
                  <span className="text-xs text-slate-500">Checked against clinical matrix</span>
                </div>

                <div className="space-y-2.5">
                  {preview.interactions.map((alert) => {
                    const isSevere = alert.severity === 'Severe';
                    const isMod = alert.severity === 'Moderate';
                    const boxStyle = isSevere
                      ? 'bg-red-50 border-red-200 text-red-950'
                      : isMod
                      ? 'bg-amber-50 border-amber-200 text-amber-950'
                      : 'bg-slate-50 border-slate-200 text-slate-900';

                    return (
                      <div key={`${alert.id}-${alert.medicine_a}`} className={`p-3.5 rounded-lg border text-xs ${boxStyle}`}>
                        <div className="flex items-center justify-between gap-2 font-bold">
                          <span className="flex items-center gap-1.5">
                            {isSevere ? (
                              <AlertOctagon className="w-4 h-4 text-red-600 shrink-0" />
                            ) : isMod ? (
                              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                            ) : (
                              <Info className="w-4 h-4 text-slate-600 shrink-0" />
                            )}
                            {alert.severity} Interaction: {alert.medicine_a} ({alert.generic_a}) + {alert.medicine_b} ({alert.generic_b})
                          </span>
                        </div>
                        <p className="mt-1 opacity-90">{alert.clinical_effect}</p>
                        <p className="mt-1 font-semibold">Clinical Action: {alert.recommendation}</p>
                      </div>
                    );
                  })}
                </div>

                {preview.has_severe_interaction && (
                  <label className="flex items-start gap-2.5 p-3 rounded-lg bg-red-50/50 border border-red-200 text-xs text-red-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={severeAckChecked}
                      onChange={(e) => setSevereAckChecked(e.target.checked)}
                      className="mt-0.5 accent-red-600"
                    />
                    <span>
                      <strong>Pharmacist Override Acknowledgement:</strong> I ({user.name}) have verified prescriber
                      intent, informed the patient of bleeding/toxicity precautions, and authorize dispensing.
                    </span>
                  </label>
                )}
              </div>
            )}

            {/* Active Cart & FEFO Batch Allocation */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Live Bill & FEFO Batch Allocation
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Batches are allocated First-Expired, First-Out automatically.
                  </p>
                </div>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCart([])}
                    className="text-xs font-semibold text-slate-500 hover:text-red-600 cursor-pointer"
                  >
                    Clear Bill
                  </button>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  Add medicines from the catalog on the left, or load an EMR prescription to begin billing.
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {(preview?.lines || []).map((line) => (
                    <div key={line.medicine_id} className="py-4 space-y-2.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-slate-900">
                            {line.brand_name}{' '}
                            <span className="text-xs font-normal text-slate-500">{line.strength}</span>
                          </div>
                          <div className="text-xs text-slate-500">
                            {line.generic_name} · HSN {line.hsn_code} · GST {line.gst_rate}%
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="flex items-center border border-slate-200 rounded-lg">
                            <button
                              type="button"
                              onClick={() => updateQty(line.medicine_id, line.requested_qty - 1)}
                              className="px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min={1}
                              value={line.requested_qty}
                              onChange={(e) => updateQty(line.medicine_id, Number(e.target.value) || 1)}
                              className="w-12 text-center text-xs font-mono font-bold py-1 focus:outline-none tabular-nums"
                            />
                            <button
                              type="button"
                              onClick={() => updateQty(line.medicine_id, line.requested_qty + 1)}
                              className="px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                            >
                              +
                            </button>
                          </div>

                          <div className="w-24 text-right font-mono tabular-nums text-sm font-bold text-slate-900">
                            {formatINR(line.line_total)}
                          </div>

                          <button
                            type="button"
                            onClick={() => updateQty(line.medicine_id, 0)}
                            className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                            aria-label={`Remove ${line.brand_name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* FEFO Batch Allocations */}
                      {line.allocations.length > 0 && (
                        <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                          {line.allocations.map((alloc) => (
                            <span
                              key={alloc.batch_id}
                              className="px-2 py-1 rounded bg-slate-50 border border-slate-200 text-slate-700"
                            >
                              FEFO Batch <strong>{alloc.batch_no}</strong> · Exp{' '}
                              {formatShortDate(alloc.expiry_date)} ({alloc.days_to_expiry}d) ·{' '}
                              {alloc.qty_allocated} × ₹{alloc.mrp.toFixed(2)}
                            </span>
                          ))}
                        </div>
                      )}

                      {line.expired_blocked_qty > 0 && (
                        <div className="text-[11px] text-red-700 font-medium">
                          Notice: {line.expired_blocked_qty} expired units of {line.brand_name} were automatically excluded from FEFO allocation.
                        </div>
                      )}

                      {/* Brand-Swap Suggestion Box when Shortfall or Out of Stock */}
                      {line.shortfall_qty > 0 && (
                        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs">
                          <div className="font-bold text-amber-900 flex items-center gap-1.5">
                            <RefreshCw className="w-3.5 h-3.5" />
                            {line.available_qty === 0
                              ? `${line.brand_name} is out of stock.`
                              : `Shortfall of ${line.shortfall_qty} units (only ${line.available_qty} active units available).`}{' '}
                            In-stock generic equivalents ({line.generic_name}):
                          </div>
                          {line.brand_swaps.length === 0 ? (
                            <p className="text-amber-800 mt-1">
                              No alternative brands currently in stock. Reduce quantity or create a Purchase Order.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {line.brand_swaps.map((swap) => (
                                <button
                                  key={swap.medicine_id}
                                  type="button"
                                  onClick={() =>
                                    swapBrandInCart(line.medicine_id, swap.medicine_id, swap.brand_name)
                                  }
                                  className="px-3 py-1.5 bg-white border border-amber-300 hover:border-emerald-600 hover:bg-emerald-50 rounded-md font-medium text-slate-900 transition-colors cursor-pointer"
                                >
                                  Swap to <strong>{swap.brand_name}</strong> ·{' '}
                                  <span className="font-mono">{swap.total_active_stock} avail</span> · MRP ₹
                                  {swap.mrp.toFixed(2)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Customer, Payment Method & GST Checkout */}
              {preview && preview.lines.length > 0 && (
                <div className="pt-4 border-t border-slate-200 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Customer / Patient Name
                      </label>
                      <input
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Mobile Number
                      </label>
                      <input
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="+91 98..."
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Payment Capture Method
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(['UPI', 'Cash', 'Card', 'Insurance'] as const).map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setPaymentMethod(method)}
                          className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                            paymentMethod === method
                              ? 'bg-emerald-50 border-emerald-600 text-emerald-800'
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {method}
                        </button>
                      ))}
                    </div>
                    <input
                      value={paymentRef}
                      onChange={(e) => setPaymentRef(e.target.value)}
                      placeholder={
                        paymentMethod === 'UPI'
                          ? 'UPI Ref / VPA (optional, auto-generated if blank)'
                          : paymentMethod === 'Insurance'
                          ? 'Insurance Policy / TPA Claim ID'
                          : paymentMethod === 'Card'
                          ? 'Card Auth Code / Last 4 digits'
                          : 'Cash tender note'
                      }
                      className="mt-2 w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                    />
                  </div>

                  {/* GST Summary */}
                  <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Taxable Subtotal</span>
                      <span className="font-mono tabular-nums">{formatINR(preview.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>CGST (Central GST)</span>
                      <span className="font-mono tabular-nums">{formatINR(preview.cgst_total)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>SGST (State GST)</span>
                      <span className="font-mono tabular-nums">{formatINR(preview.sgst_total)}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-slate-900 pt-2 border-t border-slate-200">
                      <span>Grand Total (INR)</span>
                      <span className="font-mono tabular-nums text-emerald-700">
                        {formatINR(preview.grand_total)}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={
                      submitting ||
                      loadingPreview ||
                      preview.has_shortfall ||
                      (preview.has_severe_interaction && !severeAckChecked)
                    }
                    onClick={handleCheckout}
                    className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CreditCard className="w-4 h-4" />
                    {submitting
                      ? 'Committing FEFO Batches...'
                      : `Complete Sale & Issue GST Receipt (${formatINR(preview.grand_total)})`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Printable Tax-Compliant GST Receipt Modal */}
      {receiptInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 no-print">
              <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm">
                <CheckCircle2 className="w-4 h-4" /> Tax-Compliant GST Invoice Issued
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" /> Print Receipt
                </button>
                <button
                  type="button"
                  onClick={() => setReceiptInvoice(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                  aria-label="Close receipt"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="mt-5 space-y-4 text-xs">
              <div className="flex justify-between items-start border-b border-slate-200 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">MEDORYX PHARMACY & CLINICAL STORE</h2>
                  <p className="text-slate-600">GSTIN: 27AABCM9081K1Z4 · Drug Lic: MH-MZ4-201944</p>
                  <p className="text-slate-500">Tax Invoice (Rule 46 CGST Rules, 2017)</p>
                </div>
                <div className="text-right font-mono">
                  <div className="font-bold text-sm text-slate-900">{receiptInvoice.invoice_no}</div>
                  <div className="text-slate-600">{formatDateTime(receiptInvoice.created_at)}</div>
                  <div className="text-slate-600">Dispensed by: {receiptInvoice.created_by}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg">
                <div>
                  <div className="text-slate-500">Billed To</div>
                  <div className="font-bold text-slate-900 text-sm">{receiptInvoice.customer_name}</div>
                  {receiptInvoice.customer_phone && (
                    <div className="font-mono text-slate-600">{receiptInvoice.customer_phone}</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-slate-500">Payment Mode</div>
                  <div className="font-bold text-slate-900">
                    {receiptInvoice.payment_method} ({receiptInvoice.payment_ref || 'Settled'})
                  </div>
                  {receiptInvoice.interaction_ack_by && (
                    <div className="text-red-700 font-semibold mt-0.5">
                      Clinical Override: {receiptInvoice.interaction_ack_by}
                    </div>
                  )}
                </div>
              </div>

              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-300 text-[11px] font-bold text-slate-700">
                    <th className="py-2">Medicine & HSN</th>
                    <th className="py-2">Batch / Exp</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">MRP</th>
                    <th className="py-2 text-right">GST%</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {receiptInvoice.items.map((it) => (
                    <tr key={it.id}>
                      <td className="py-2">
                        <div className="font-semibold text-slate-900">{it.brand_name}</div>
                        <div className="text-slate-500 font-mono">HSN {it.hsn_code}</div>
                      </td>
                      <td className="py-2 font-mono">
                        <div>{it.batch_no}</div>
                        <div className="text-slate-500">{formatShortDate(it.expiry_date)}</div>
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">{it.qty}</td>
                      <td className="py-2 text-right font-mono tabular-nums">₹{it.mrp.toFixed(2)}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{it.gst_rate}%</td>
                      <td className="py-2 text-right font-mono tabular-nums font-semibold">
                        {formatINR(it.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="border-t border-slate-300 pt-3 flex flex-col items-end space-y-1 font-mono tabular-nums">
                <div>Taxable Value: {formatINR(receiptInvoice.subtotal)}</div>
                <div>CGST: {formatINR(receiptInvoice.cgst_total)}</div>
                <div>SGST: {formatINR(receiptInvoice.sgst_total)}</div>
                <div className="text-base font-bold text-slate-900 pt-1">
                  Net Payable: {formatINR(receiptInvoice.grand_total)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
