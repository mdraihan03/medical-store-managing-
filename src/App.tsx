import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Plus,
  RotateCcw,
  Truck,
  X,
} from 'lucide-react';
import { apiFetch } from './lib/format';
import { MedoryxLogo } from './components/MedoryxLogo';
import { LoginView } from './components/LoginView';
import { DashboardView } from './components/DashboardView';
import { PrescriptionsView } from './components/PrescriptionsView';
import { BillingView, type CartEntry } from './components/BillingView';
import { InventoryView } from './components/InventoryView';
import { ReturnsView } from './components/ReturnsView';
import { ProcurementView } from './components/ProcurementView';
import { ReportsView } from './components/ReportsView';
import type {
  Batch,
  DashboardPayload,
  EmrPrescription,
  GrnRecord,
  InvoiceRecord,
  Medicine,
  PurchaseOrder,
  ReorderItem,
  ReturnRecord,
  Supplier,
  UserRole,
  UserSession,
} from './types';

type NavModule =
  | 'dashboard'
  | 'prescriptions'
  | 'billing'
  | 'inventory'
  | 'returns'
  | 'procurement'
  | 'reports';

const NAV_ITEMS: Array<{
  id: NavModule;
  label: string;
  icon: typeof LayoutDashboard;
  roles: UserRole[];
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['Admin', 'Pharmacist', 'Store Staff'] },
  { id: 'prescriptions', label: 'EMR Prescriptions', icon: ClipboardList, roles: ['Admin', 'Pharmacist'] },
  { id: 'billing', label: 'POS Billing & GST', icon: CreditCard, roles: ['Admin', 'Pharmacist', 'Store Staff'] },
  { id: 'inventory', label: 'Inventory & Expiry', icon: Package, roles: ['Admin', 'Pharmacist', 'Store Staff'] },
  { id: 'returns', label: 'Returns & Recon', icon: RotateCcw, roles: ['Admin', 'Pharmacist', 'Store Staff'] },
  { id: 'procurement', label: 'Suppliers & PO', icon: Truck, roles: ['Admin', 'Pharmacist', 'Store Staff'] },
  { id: 'reports', label: 'Reports & Audit', icon: BarChart3, roles: ['Admin', 'Pharmacist'] },
];

export default function App() {
  const [user, setUser] = useState<UserSession | null>(null);
  const [activeModule, setActiveModule] = useState<NavModule>('dashboard');
  const [inventorySubTab, setInventorySubTab] = useState<'catalog' | 'expiry' | 'add' | 'import'>('catalog');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Shared live SQLite data state
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [prescriptions, setPrescriptions] = useState<EmrPrescription[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [grnRecords, setGrnRecords] = useState<GrnRecord[]>([]);

  // Cross-module workflow state (EMR -> POS Billing, Reorder -> Purchase Order)
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [linkedRx, setLinkedRx] = useState<EmrPrescription | null>(null);
  const [prefillReorder, setPrefillReorder] = useState<ReorderItem | null>(null);

  // Toast feedback
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null);

  const notify = useCallback((msg: string, tone: 'success' | 'error' = 'success') => {
    setToast({ msg, tone });
    window.setTimeout(() => {
      setToast((curr) => (curr?.msg === msg ? null : curr));
    }, 3800);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, meds, bat, rxs, invs, rets, sups, pos, grns] = await Promise.all([
        apiFetch<DashboardPayload>('/api/dashboard'),
        apiFetch<Medicine[]>('/api/medicines'),
        apiFetch<Batch[]>('/api/batches'),
        apiFetch<EmrPrescription[]>('/api/prescriptions'),
        apiFetch<InvoiceRecord[]>('/api/invoices'),
        apiFetch<ReturnRecord[]>('/api/returns'),
        apiFetch<Supplier[]>('/api/suppliers'),
        apiFetch<PurchaseOrder[]>('/api/purchase-orders'),
        apiFetch<GrnRecord[]>('/api/grn'),
      ]);
      setDashboard(dash);
      setMedicines(meds);
      setBatches(bat);
      setPrescriptions(rxs);
      setInvoices(invs);
      setReturns(rets);
      setSuppliers(sups);
      setPurchaseOrders(pos);
      setGrnRecords(grns);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load workspace data', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (user) {
      refreshAll();
    }
  }, [user, refreshAll]);

  async function switchRole(role: UserRole) {
    try {
      const nextUser = await apiFetch<UserSession>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ quickRole: role }),
      });
      setUser(nextUser);
      const allowed = NAV_ITEMS.filter((n) => n.roles.includes(role)).map((n) => n.id);
      if (!allowed.includes(activeModule)) {
        setActiveModule('dashboard');
      }
      notify(`Switched active session to ${nextUser.role} (${nextUser.name})`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Role switch failed', 'error');
    }
  }

  function handleSendRxToBilling(rx: EmrPrescription) {
    setLinkedRx(rx);
    setCart(rx.items.map((it) => ({ medicine_id: it.medicine_id, qty: it.prescribed_qty })));
    setActiveModule('billing');
    notify(`Loaded ${rx.rx_code} for ${rx.patient_name} into POS Billing`);
  }

  function handleNavigateBilling(medicineId?: number) {
    if (medicineId) {
      setCart((prev) => {
        const exists = prev.find((i) => i.medicine_id === medicineId);
        if (exists) return prev;
        return [...prev, { medicine_id: medicineId, qty: 1 }];
      });
    }
    setActiveModule('billing');
  }

  function handleCreatePoFromReorder(item: ReorderItem) {
    setPrefillReorder(item);
    setActiveModule('procurement');
    notify(`Drafting Purchase Order for ${item.brand_name} (${item.supplier_name})`);
  }

  if (!user) {
    return <LoginView onLogin={(u) => setUser(u)} />;
  }

  const allowedNav = NAV_ITEMS.filter((item) => item.roles.includes(user.role));
  const currentNavLabel = NAV_ITEMS.find((n) => n.id === activeModule)?.label || 'Dashboard';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:sticky lg:top-0 lg:h-screen bg-white border-r border-slate-200 shrink-0 no-print">
        <div className="h-14 px-5 flex items-center gap-2.5 border-b border-slate-200 shrink-0">
          <MedoryxLogo size={28} />
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Medoryx
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {allowedNav.map((item) => {
            const Icon = item.icon;
            const active = activeModule === item.id;
            const badgeCount =
              item.id === 'prescriptions'
                ? dashboard?.kpis.pending_rx_count
                : item.id === 'billing' && cart.length > 0
                ? cart.length
                : undefined;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id === 'inventory') setInventorySubTab('catalog');
                  setActiveModule(item.id);
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                  active
                    ? 'bg-emerald-50 text-emerald-800 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-emerald-700' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </span>
                {badgeCount !== undefined && badgeCount > 0 && (
                  <span className="text-xs font-mono tabular-nums text-emerald-700 font-semibold">
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Role & Session Switcher Footer */}
        <div className="p-4 border-t border-slate-200 space-y-3">
          <div>
            <div className="text-xs font-bold text-slate-900 truncate">{user.name}</div>
            <div className="text-[11px] text-slate-500">
              {user.role} · <span className="font-mono">{user.license_no}</span>
            </div>
          </div>

          <div>
            <label htmlFor="role-switch" className="block text-[11px] text-slate-500 mb-1">
              Quick Role Switch
            </label>
            <select
              id="role-switch"
              value={user.role}
              onChange={(e) => switchRole(e.target.value as UserRole)}
              className="w-full px-2.5 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg cursor-pointer"
            >
              <option value="Admin">Admin</option>
              <option value="Pharmacist">Pharmacist</option>
              <option value="Store Staff">Store Staff</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => setUser(null)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-red-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-900/40" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative w-64 bg-white h-full flex flex-col border-r border-slate-200 z-10">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200">
              <div className="flex items-center gap-2">
                <MedoryxLogo size={26} />
                <span className="font-display font-bold text-slate-900">Medoryx</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {allowedNav.map((item) => {
                const Icon = item.icon;
                const active = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveModule(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg ${
                      active ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-slate-600'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setUser(null)}
                className="w-full py-2 text-xs font-semibold text-slate-700 border border-slate-200 rounded-lg"
              >
                Sign Out ({user.role})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb Left — Primary Action Right */}
        <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8 shrink-0 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm whitespace-nowrap truncate">
              <span className="text-slate-400 font-medium">Medoryx</span>
              <span className="text-slate-300" aria-hidden="true">/</span>
              <span className="font-semibold text-slate-900">{currentNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setActiveModule('billing')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> New Counter Sale
            </button>
          </div>
        </header>

        {/* Main Scrollable Viewport */}
        <main className="flex-1 p-6 max-w-[1400px] w-full mx-auto">
          {activeModule === 'dashboard' && (
            <DashboardView
              data={dashboard}
              loading={loading && !dashboard}
              onNavigateBilling={handleNavigateBilling}
              onNavigateExpiry={() => {
                setInventorySubTab('expiry');
                setActiveModule('inventory');
              }}
              onCreatePoFromReorder={handleCreatePoFromReorder}
            />
          )}

          {activeModule === 'prescriptions' && (
            <PrescriptionsView
              prescriptions={prescriptions}
              medicines={medicines}
              user={user}
              onRefresh={refreshAll}
              onSendToBilling={handleSendRxToBilling}
              onNotify={notify}
            />
          )}

          {activeModule === 'billing' && (
            <BillingView
              medicines={medicines}
              invoices={invoices}
              user={user}
              cart={cart}
              setCart={setCart}
              linkedRx={linkedRx}
              setLinkedRx={setLinkedRx}
              onRefreshAll={refreshAll}
              onNotify={notify}
            />
          )}

          {activeModule === 'inventory' && (
            <InventoryView
              key={inventorySubTab}
              medicines={medicines}
              batches={batches}
              suppliers={suppliers}
              user={user}
              initialSubTab={inventorySubTab}
              onRefresh={refreshAll}
              onNotify={notify}
            />
          )}

          {activeModule === 'returns' && (
            <ReturnsView
              batches={batches}
              returns={returns}
              user={user}
              onRefresh={refreshAll}
              onNotify={notify}
            />
          )}

          {activeModule === 'procurement' && (
            <ProcurementView
              suppliers={suppliers}
              purchaseOrders={purchaseOrders}
              grnRecords={grnRecords}
              medicines={medicines}
              user={user}
              prefillReorder={prefillReorder}
              clearPrefillReorder={() => setPrefillReorder(null)}
              onRefresh={refreshAll}
              onNotify={notify}
            />
          )}

          {activeModule === 'reports' && <ReportsView batches={batches} />}
        </main>
      </div>

      {/* Action Feedback Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg border text-xs font-semibold shadow-sm no-print ${
            toast.tone === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-white border-emerald-200 text-slate-900'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
