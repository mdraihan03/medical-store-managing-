import { useEffect, useState } from 'react';
import { Database, Download, X } from 'lucide-react';
import { apiFetch, fetchTextWithFallback, formatDateTime, formatINR, formatShortDate } from '../lib/format';
import type { AuditLog, Batch } from '../types';

interface ReportsOverview {
  category_snapshot: Array<{
    category: string;
    sku_count: number;
    active_units: number;
    cost_value: number;
    mrp_value: number;
  }>;
  payment_breakdown: Array<{
    payment_method: string;
    invoice_count: number;
    taxable_value: number;
    gst_collected: number;
    gross_revenue: number;
  }>;
  gst_slabs: Array<{
    gst_rate: number;
    units_sold: number;
    cgst: number;
    sgst: number;
    gross_total: number;
  }>;
  audit_logs: AuditLog[];
}

interface ReportsViewProps {
  batches: Batch[];
}

export function ReportsView({ batches }: ReportsViewProps) {
  const [subTab, setSubTab] = useState<'stock' | 'expiry' | 'sales' | 'audit'>('stock');
  const [overview, setOverview] = useState<ReportsOverview | null>(null);
  const [mysqlModal, setMysqlModal] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ReportsOverview>('/api/reports/overview')
      .then(setOverview)
      .catch(() => {});
  }, [batches]);

  async function openMysqlSchema() {
    const txt = await fetchTextWithFallback('/api/schema/mysql');
    setMysqlModal(txt);
  }

  function exportAuditCsv() {
    if (!overview) return;
    const header = 'Timestamp,Actor,Role,Action,Entity,Details';
    const lines = overview.audit_logs.map(
      (l) =>
        `"${l.created_at}","${l.actor_name}","${l.actor_role}","${l.action_type}","${l.entity}","${l.details.replace(/"/g, '""')}"`
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medoryx-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const expiryBatches = batches.filter((b) => b.qty_available > 0 && b.days_to_expiry <= 90);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
          {(
            [
              { id: 'stock', label: 'Stock Status & Snapshots' },
              { id: 'expiry', label: `Expiry Report (${expiryBatches.length})` },
              { id: 'sales', label: 'Sales & GST Revenue' },
              { id: 'audit', label: 'Audit & Compliance Logs' },
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

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openMysqlSchema}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <Database className="w-3.5 h-3.5" /> Export MySQL DDL
          </button>
          <button
            type="button"
            onClick={exportAuditCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Export Audit CSV
          </button>
        </div>
      </div>

      {subTab === 'stock' && overview && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-base font-bold text-slate-900 mb-4">
            Stock Valuation Snapshot by Therapeutic Category
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 pr-3">Therapeutic Category</th>
                  <th className="py-2.5 px-3 text-right">SKUs</th>
                  <th className="py-2.5 px-3 text-right">Active Units</th>
                  <th className="py-2.5 px-3 text-right">Cost Valuation</th>
                  <th className="py-2.5 pl-3 text-right">Retail MRP Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overview.category_snapshot.map((row) => (
                  <tr key={row.category} className="hover:bg-slate-50">
                    <td className="py-3 pr-3 font-semibold text-slate-900 text-sm">{row.category}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {row.sku_count}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                      {row.active_units}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatINR(row.cost_value)}
                    </td>
                    <td className="py-3 pl-3 text-right font-mono tabular-nums font-semibold text-emerald-700">
                      {formatINR(row.mrp_value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'expiry' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-base font-bold text-slate-900 mb-4">
            90-Day Expiry & Quarantine Compliance Report
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 pr-3">Batch No</th>
                  <th className="py-2.5 px-3">Medicine</th>
                  <th className="py-2.5 px-3">Expiry Date</th>
                  <th className="py-2.5 px-3">Risk Window</th>
                  <th className="py-2.5 px-3 text-right">Units</th>
                  <th className="py-2.5 pl-3 text-right">Cost at Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expiryBatches.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-3 font-mono font-bold text-slate-900">{b.batch_no}</td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900">{b.brand_name}</div>
                      <div className="text-slate-500">{b.generic_name}</div>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-700">{formatShortDate(b.expiry_date)}</td>
                    <td className="py-3 px-3 font-semibold">
                      <span
                        className={
                          b.risk_tier === 'expired' || b.risk_tier === 'critical'
                            ? 'text-red-700'
                            : b.risk_tier === 'amber'
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                        }
                      >
                        {b.risk_tier === 'expired' ? 'Expired' : `${b.days_to_expiry} days`}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">{b.qty_available}</td>
                    <td className="py-3 pl-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {formatINR(b.cost_value_at_risk)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'sales' && overview && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-base font-bold text-slate-900 mb-4">Revenue by Payment Channel</h3>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2">Method</th>
                  <th className="py-2 text-right">Invoices</th>
                  <th className="py-2 text-right">GST</th>
                  <th className="py-2 text-right">Gross Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overview.payment_breakdown.map((p) => (
                  <tr key={p.payment_method}>
                    <td className="py-3 font-semibold text-slate-900">{p.payment_method}</td>
                    <td className="py-3 text-right font-mono tabular-nums">{p.invoice_count}</td>
                    <td className="py-3 text-right font-mono tabular-nums text-slate-600">
                      {formatINR(p.gst_collected)}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums font-bold text-emerald-700">
                      {formatINR(p.gross_revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-base font-bold text-slate-900 mb-4">GST Tax Slab Collection Summary</h3>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2">GST Slab</th>
                  <th className="py-2 text-right">Units Sold</th>
                  <th className="py-2 text-right">CGST</th>
                  <th className="py-2 text-right">SGST</th>
                  <th className="py-2 text-right">Gross</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overview.gst_slabs.map((g) => (
                  <tr key={g.gst_rate}>
                    <td className="py-3 font-mono font-bold text-slate-900">{g.gst_rate}% GST</td>
                    <td className="py-3 text-right font-mono tabular-nums">{g.units_sold}</td>
                    <td className="py-3 text-right font-mono tabular-nums">{formatINR(g.cgst)}</td>
                    <td className="py-3 text-right font-mono tabular-nums">{formatINR(g.sgst)}</td>
                    <td className="py-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {formatINR(g.gross_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'audit' && overview && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-base font-bold text-slate-900 mb-4">Audit & Compliance Trail</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 pr-3">Timestamp</th>
                  <th className="py-2.5 px-3">Actor & Role</th>
                  <th className="py-2.5 px-3">Action</th>
                  <th className="py-2.5 px-3">Entity</th>
                  <th className="py-2.5 pl-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overview.audit_logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-3 font-mono text-slate-500 whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="font-semibold text-slate-900">{log.actor_name}</span> ·{' '}
                      <span className="text-slate-500">{log.actor_role}</span>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-teal-700">{log.action_type}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-800">{log.entity}</td>
                    <td className="py-2.5 pl-3 text-slate-700">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mysqlModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">Medoryx Reference MySQL 8.0 Schema</h3>
              <button
                type="button"
                onClick={() => setMysqlModal(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="p-4 rounded-lg bg-slate-950 text-slate-100 text-xs font-mono overflow-auto max-h-96">
              {mysqlModal}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
