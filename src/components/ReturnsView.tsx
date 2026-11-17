import { useState, type FormEvent } from 'react';
import { RotateCcw } from 'lucide-react';
import { apiFetch, formatDateTime, formatINR, formatShortDate } from '../lib/format';
import type { Batch, ReturnRecord, UserSession } from '../types';

interface ReturnsViewProps {
  batches: Batch[];
  returns: ReturnRecord[];
  user: UserSession;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function ReturnsView({
  batches,
  returns,
  user,
  onRefresh,
  onNotify,
}: ReturnsViewProps) {
  const [returnType, setReturnType] = useState<'Customer Return' | 'Damaged Stock' | 'Expired Write-Off'>(
    'Customer Return'
  );
  const [batchId, setBatchId] = useState<number>(batches[0]?.id ?? 1);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [qty, setQty] = useState('5');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!batchId) return;
    setSubmitting(true);
    try {
      const res = await apiFetch<{ restocked: number; amount: number }>('/api/returns', {
        method: 'POST',
        body: JSON.stringify({
          return_type: returnType,
          invoice_no: invoiceNo.trim() || null,
          batch_id: batchId,
          qty: Number(qty),
          reason: reason.trim() || returnType,
          actor_name: user.name,
          actor_role: user.role,
        }),
      });
      await onRefresh();
      setReason('');
      setInvoiceNo('');
      onNotify(
        res.restocked
          ? `Customer return restocked (${formatINR(res.amount)} refunded)`
          : `Reconciled write-off (${formatINR(res.amount)} cost impact)`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Return processing failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      <form
        onSubmit={handleSubmit}
        className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
      >
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-teal-600" /> Return & Damaged Stock Reconciliation
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Customer returns restore non-expired units to their batch; damaged or expired write-offs deduct stock automatically.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">Reconciliation Type</label>
          <div className="grid grid-cols-3 gap-2">
            {(['Customer Return', 'Damaged Stock', 'Expired Write-Off'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setReturnType(t)}
                className={`py-2 px-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                  returnType === t
                    ? 'bg-emerald-50 border-emerald-600 text-emerald-800'
                    : 'bg-white border-slate-200 text-slate-600'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Medicine Batch</label>
          <select
            value={batchId}
            onChange={(e) => setBatchId(Number(e.target.value))}
            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
          >
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.brand_name} · Batch {b.batch_no} ({b.qty_available} avail · Exp{' '}
                {formatShortDate(b.expiry_date)})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Quantity</label>
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
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Invoice Ref (Optional)
            </label>
            <input
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              placeholder="INV-2026-..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Reason / Inspection Note</label>
          <input
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Sealed strip returned unopened / Moisture damage"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg cursor-pointer disabled:opacity-60"
        >
          {submitting ? 'Updating Inventory...' : 'Commit Reconciliation'}
        </button>
      </form>

      <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
        <h3 className="text-base font-bold text-slate-900 mb-4">Reconciliation Ledger</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-2.5 pr-3">Type & Date</th>
                <th className="py-2.5 px-3">Medicine · Batch</th>
                <th className="py-2.5 px-3 text-right">Qty</th>
                <th className="py-2.5 px-3 text-right">Value</th>
                <th className="py-2.5 px-3">Inventory Action</th>
                <th className="py-2.5 pl-3">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {returns.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="py-3 pr-3">
                    <div className="font-semibold text-slate-900">{r.return_type}</div>
                    <div className="text-[11px] text-slate-500">{formatDateTime(r.created_at)}</div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-semibold text-slate-900">{r.brand_name}</div>
                    <div className="font-mono text-slate-500">{r.batch_no}</div>
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                    {r.qty}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                    {formatINR(r.amount)}
                  </td>
                  <td className="py-3 px-3 font-semibold">
                    {r.restocked ? (
                      <span className="text-emerald-700">Restocked to Batch</span>
                    ) : (
                      <span className="text-red-600">Deducted / Written Off</span>
                    )}
                  </td>
                  <td className="py-3 pl-3 text-slate-600 max-w-[200px] truncate">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
