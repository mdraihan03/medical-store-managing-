import { useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Package,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import { formatINR, formatNumber, formatShortDate } from '../lib/format';
import type { DashboardPayload, ReorderItem } from '../types';

interface DashboardViewProps {
  data: DashboardPayload | null;
  loading: boolean;
  onNavigateBilling: (medicineId?: number) => void;
  onNavigateExpiry: () => void;
  onCreatePoFromReorder: (item: ReorderItem) => void;
}

export function DashboardView({
  data,
  loading,
  onNavigateBilling,
  onNavigateExpiry,
  onCreatePoFromReorder,
}: DashboardViewProps) {
  const [shelfFilter, setShelfFilter] = useState<'all' | 'critical' | 'amber' | 'green'>('all');

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-80 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  const { kpis, expiry_shelf, expiry_summary, stock_value_trends, fast_moving_items, reorder_list } = data;

  const filteredShelf =
    shelfFilter === 'all' ? expiry_shelf : expiry_shelf.filter((b) => b.risk_tier === shelfFilter);

  // Chart calculations for Stock Value Trends
  const maxStockVal = Math.max(...stock_value_trends.map((d) => d.stock_value), 1);
  const minStockVal = Math.min(...stock_value_trends.map((d) => d.stock_value)) * 0.92;
  const maxSalesVal = Math.max(...stock_value_trends.map((d) => d.daily_sales), 100);
  const chartWidth = 640;
  const chartHeight = 200;
  const padX = 28;
  const padY = 18;

  const linePoints = stock_value_trends
    .map((pt, idx) => {
      const x =
        padX + (idx / Math.max(1, stock_value_trends.length - 1)) * (chartWidth - padX * 2);
      const y =
        chartHeight -
        padY -
        ((pt.stock_value - minStockVal) / Math.max(1, maxStockVal - minStockVal)) *
          (chartHeight - padY * 2);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="space-y-6">
      {/* 4-Column Operational KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Active Stock Valuation (Cost)</span>
            <Package className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {formatINR(kpis.total_stock_value)}
          </div>
          <p className="text-xs text-slate-500 mt-1.5 font-mono tabular-nums">
            MRP Value: {formatINR(kpis.total_mrp_value)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>90-Day Expiry Stock at Risk</span>
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-red-600">
            {formatINR(kpis.at_risk_90d_value)}
          </div>
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            {formatNumber(kpis.at_risk_90d_units)} units across {expiry_shelf.length} batches
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Items at or Below Reorder</span>
            <ShoppingCart className="w-4 h-4 text-teal-600" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {kpis.reorder_count} SKUs
          </div>
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            {kpis.pending_rx_count} EMR prescriptions awaiting dispense
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Today&apos;s Counter Revenue</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700">
            {formatINR(kpis.today_revenue)}
          </div>
          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
            {kpis.today_invoices} GST invoices · Quarantined: {formatINR(kpis.expired_quarantined_value)}
          </p>
        </div>
      </div>

      {/* 1. Expiry Shelf (90-Day Risk Timeline + Cost Value at Risk) */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              90-Day Expiry Shelf & Cost Value at Risk
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Batches expiring within 90 days ranked by urgency. FEFO billing prioritizes these batches automatically before expiry.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'all', label: `All ≤90d (${expiry_shelf.length})` },
                  { id: 'critical', label: `Red <30d (${expiry_summary.critical_batches})` },
                  { id: 'amber', label: `Amber 30-60d (${expiry_summary.amber_batches})` },
                  { id: 'green', label: `Green 61-90d (${expiry_summary.green_batches})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setShelfFilter(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    shelfFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onNavigateExpiry}
              className="px-3 py-1.5 text-xs font-semibold text-teal-700 hover:text-teal-800 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Open Full Expiry Ledger
            </button>
          </div>
        </div>

        {/* Tier Cost Breakdown Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4 border-b border-slate-100 text-xs">
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-red-50/70 border border-red-200/70">
            <span className="font-semibold text-red-800">Red · Critical (&lt;30 days)</span>
            <span className="font-mono font-bold tabular-nums text-red-700">
              {formatINR(expiry_summary.critical_value)}
            </span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-50/70 border border-amber-200/70">
            <span className="font-semibold text-amber-800">Amber · Watch (30–60 days)</span>
            <span className="font-mono font-bold tabular-nums text-amber-700">
              {formatINR(expiry_summary.amber_value)}
            </span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-50/70 border border-emerald-200/70">
            <span className="font-semibold text-emerald-800">Green · Safe Window (61–90 days)</span>
            <span className="font-mono font-bold tabular-nums text-emerald-700">
              {formatINR(expiry_summary.green_value)}
            </span>
          </div>
        </div>

        {filteredShelf.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            No active batches in this expiry window.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 mt-2">
            {filteredShelf.map((batch) => {
              const pctRemaining = Math.max(4, Math.min(100, Math.round((batch.days_to_expiry / 90) * 100)));
              const barColor =
                batch.risk_tier === 'critical'
                  ? 'bg-red-600'
                  : batch.risk_tier === 'amber'
                  ? 'bg-amber-500'
                  : 'bg-emerald-600';
              const tierLabel =
                batch.risk_tier === 'critical'
                  ? 'Critical (<30d)'
                  : batch.risk_tier === 'amber'
                  ? 'Watch (30–60d)'
                  : 'Monitor (61–90d)';
              const labelColor =
                batch.risk_tier === 'critical'
                  ? 'text-red-700'
                  : batch.risk_tier === 'amber'
                  ? 'text-amber-700'
                  : 'text-emerald-700';

              return (
                <div
                  key={batch.id}
                  className="py-3.5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center"
                >
                  <div className="lg:col-span-4 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 truncate">
                        {batch.brand_name}
                      </span>
                      <span className="text-xs text-slate-400" aria-hidden="true">·</span>
                      <span className="text-xs font-mono text-slate-600">{batch.batch_no}</span>
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {batch.generic_name} · Rack {batch.rack_location} · Exp {formatShortDate(batch.expiry_date)}
                    </div>
                  </div>

                  <div className="lg:col-span-4">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className={`font-semibold ${labelColor}`}>{tierLabel}</span>
                      <span className="font-mono tabular-nums text-slate-700">
                        {batch.days_to_expiry} days left
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${barColor}`}
                        style={{ width: `${pctRemaining}%` }}
                      />
                    </div>
                  </div>

                  <div className="lg:col-span-2 text-left lg:text-right">
                    <div className="text-sm font-bold font-mono tabular-nums text-slate-900">
                      {formatINR(batch.cost_value_at_risk)}
                    </div>
                    <div className="text-xs text-slate-500 font-mono tabular-nums">
                      {batch.qty_available} units @ ₹{batch.cost_price.toFixed(2)}
                    </div>
                  </div>

                  <div className="lg:col-span-2 flex lg:justify-end">
                    <button
                      type="button"
                      onClick={() => onNavigateBilling(batch.medicine_id)}
                      className="px-3 py-1.5 text-xs font-semibold text-emerald-700 border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Bill FEFO
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 5. Inventory Dashboard: Stock Value Trends + Fast-Moving Items */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Stock Value Trends Chart */}
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Stock Value & Daily Sales Trend</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                10-day inventory cost valuation trajectory alongside daily counter sales
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-teal-600 inline-block" /> Stock Value
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-emerald-200 inline-block rounded-xs" /> Sales
              </span>
            </div>
          </div>

          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight + 26}`}
              className="w-full h-56"
              role="img"
              aria-label="10-day stock value and daily sales trend"
            >
              {/* Subtle horizontal gridlines */}
              {[0.25, 0.5, 0.75].map((ratio) => {
                const y = padY + ratio * (chartHeight - padY * 2);
                return (
                  <line
                    key={ratio}
                    x1={padX}
                    y1={y}
                    x2={chartWidth - padX}
                    y2={y}
                    stroke="#F1F5F9"
                    strokeWidth="1"
                  />
                );
              })}

              {/* Daily sales bars */}
              {stock_value_trends.map((pt, idx) => {
                const x =
                  padX +
                  (idx / Math.max(1, stock_value_trends.length - 1)) * (chartWidth - padX * 2);
                const barH = (pt.daily_sales / maxSalesVal) * (chartHeight * 0.42);
                return (
                  <rect
                    key={pt.date}
                    x={x - 9}
                    y={chartHeight - padY - barH}
                    width={18}
                    height={Math.max(2, barH)}
                    rx={2}
                    fill="#A7F3D0"
                  />
                );
              })}

              {/* Stock Valuation Line */}
              <polyline
                fill="none"
                stroke="#0D9488"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={linePoints}
              />

              {/* Nodes & Dates */}
              {stock_value_trends.map((pt, idx) => {
                const x =
                  padX +
                  (idx / Math.max(1, stock_value_trends.length - 1)) * (chartWidth - padX * 2);
                const y =
                  chartHeight -
                  padY -
                  ((pt.stock_value - minStockVal) / Math.max(1, maxStockVal - minStockVal)) *
                    (chartHeight - padY * 2);
                return (
                  <g key={pt.date}>
                    <circle cx={x} cy={y} r="3.5" fill="#FFFFFF" stroke="#0D9488" strokeWidth="2" />
                    <text
                      x={x}
                      y={chartHeight + 12}
                      textAnchor="middle"
                      className="fill-slate-400 text-[10px]"
                    >
                      {pt.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </section>

        {/* Fast-Moving Items */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-900">Fast-Moving Medicines</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Highest-velocity SKUs by dispensed unit volume
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2 pr-3">Medicine</th>
                  <th className="py-2 px-2 text-right">Sold</th>
                  <th className="py-2 px-2 text-right">On Hand</th>
                  <th className="py-2 pl-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {fast_moving_items.map((item) => (
                  <tr key={item.medicine_id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 pr-3">
                      <div className="font-semibold text-slate-900">{item.brand_name}</div>
                      <div className="text-slate-500 truncate max-w-[160px]">{item.generic_name}</div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums font-semibold text-slate-800">
                      {item.units_sold}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-600">
                      {item.current_stock}
                    </td>
                    <td className="py-2.5 pl-2 text-right font-mono tabular-nums font-semibold text-emerald-700">
                      {formatINR(item.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* 4. Automated Reorder List */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Reorder List & Preferred Supplier Contacts
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Items at or below reorder threshold with recommended replenishment quantities.
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-600">
            {reorder_list.length} items requiring purchase order
          </span>
        </div>

        <div className="overflow-x-auto mt-2">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 pr-4">Medicine & Generic</th>
                <th className="py-3 px-3 text-right">In Stock</th>
                <th className="py-3 px-3 text-right">Reorder At</th>
                <th className="py-3 px-3 text-right">Suggested Order</th>
                <th className="py-3 px-3">Preferred Supplier</th>
                <th className="py-3 pl-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {reorder_list.map((item) => (
                <tr key={item.medicine_id} className="hover:bg-slate-50/70">
                  <td className="py-3 pr-4">
                    <div className="font-semibold text-slate-900">
                      {item.brand_name}{' '}
                      <span className="text-xs font-normal text-slate-500">{item.strength}</span>
                    </div>
                    <div className="text-xs text-slate-500">{item.generic_name}</div>
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums">
                    <span className={item.current_stock === 0 ? 'font-bold text-red-600' : 'font-semibold text-amber-700'}>
                      {item.current_stock === 0 ? '0 (Out of stock)' : item.current_stock}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                    {item.reorder_level}
                  </td>
                  <td className="py-3 px-3 text-right">
                    <div className="font-mono tabular-nums font-bold text-slate-900">
                      {item.suggested_order_qty} units
                    </div>
                    <div className="text-xs font-mono tabular-nums text-slate-500">
                      Est. {formatINR(item.est_order_cost)}
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="text-xs font-semibold text-slate-900">{item.supplier_name}</div>
                    <div className="text-xs text-slate-500">
                      {item.supplier_phone} · {item.lead_time_days}d lead
                    </div>
                  </td>
                  <td className="py-3 pl-3 text-right">
                    <button
                      type="button"
                      onClick={() => onCreatePoFromReorder(item)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Draft PO <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
