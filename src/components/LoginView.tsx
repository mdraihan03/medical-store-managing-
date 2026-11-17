import { useState, type FormEvent } from 'react';
import { ShieldCheck, Stethoscope, PackageCheck, ArrowRight } from 'lucide-react';
import { MedoryxLogo } from './MedoryxLogo';
import { apiFetch } from '../lib/format';
import type { UserRole, UserSession } from '../types';

interface LoginViewProps {
  onLogin: (user: UserSession) => void;
}

const DEMO_ROLES: Array<{
  role: UserRole;
  name: string;
  email: string;
  scope: string;
  icon: typeof ShieldCheck;
}> = [
  {
    role: 'Admin',
    name: 'Dr. Arvind Mehta',
    email: 'admin@medoryx.in',
    scope: 'Full store control, supplier PO approvals, compliance audit logs & financial reports',
    icon: ShieldCheck,
  },
  {
    role: 'Pharmacist',
    name: 'Priya Nair, RPh',
    email: 'pharmacist@medoryx.in',
    scope: 'EMR prescription review, FEFO GST billing, drug-interaction overrides & returns',
    icon: Stethoscope,
  },
  {
    role: 'Store Staff',
    name: 'Rohan Kulkarni',
    email: 'staff@medoryx.in',
    scope: 'POS counter assistance, GRN stock intake, batch expiry tracking & reorder prep',
    icon: PackageCheck,
  },
];

export function LoginView({ onLogin }: LoginViewProps) {
  const [email, setEmail] = useState('pharmacist@medoryx.in');
  const [password, setPassword] = useState('pharma123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await apiFetch<UserSession>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickRole(role: UserRole) {
    setError('');
    setLoading(true);
    try {
      const user = await apiFetch<UserSession>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ quickRole: role }),
      });
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to switch role');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-6 py-12">
      <div className="max-w-5xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left Brand & Connected Suite Overview */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <MedoryxLogo size={40} />
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Medoryx</h1>
                <p className="text-xs text-slate-500">Connected Pharmacy & Clinical Store Suite</p>
              </div>
            </div>

            <h2 className="text-3xl font-bold tracking-tight text-slate-900 max-w-lg leading-tight mb-3">
              Expiry-aware dispensing, clinical safety, and batch-level control.
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed max-w-xl mb-8">
              Unified workspace connecting Electronic Medical Records (EMR), FEFO automated batch billing,
              generic brand-swap matching, GST invoicing, and supplier procurement.
            </p>

            <div className="border-t border-slate-200 pt-6">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Quick Demo Role Access
              </p>
              <div className="space-y-3">
                {DEMO_ROLES.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.role}
                      type="button"
                      disabled={loading}
                      onClick={() => handleQuickRole(item.role)}
                      className="w-full text-left p-4 rounded-lg border border-slate-200 hover:border-emerald-600 hover:bg-emerald-50/40 transition-colors flex items-center justify-between gap-4 group cursor-pointer"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-slate-100 group-hover:bg-emerald-100 text-slate-700 group-hover:text-emerald-700 flex items-center justify-center shrink-0 transition-colors">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                            <span>{item.role}</span>
                            <span className="text-slate-300" aria-hidden="true">·</span>
                            <span className="font-normal text-slate-600">{item.name}</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{item.scope}</p>
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1 whitespace-nowrap shrink-0">
                        Enter <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="pt-6 mt-6 border-t border-slate-100 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>SQLite Batch Engine</span>
            <span aria-hidden="true">·</span>
            <span>FEFO Expiry Enforcement</span>
            <span aria-hidden="true">·</span>
            <span>GST Tax Invoices (INR)</span>
            <span aria-hidden="true">·</span>
            <span>EMR Queue Sync</span>
          </div>
        </div>

        {/* Right Credential Sign-In Form */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-8 flex flex-col justify-center">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-slate-900">Staff Sign In</h2>
            <p className="text-xs text-slate-500 mt-1">
              Authenticate with your pharmacy staff credentials or select a role on the left.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                Work Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                placeholder="pharmacist@medoryx.in"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-medium text-slate-700 mb-1.5">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-60"
            >
              {loading ? 'Signing in...' : 'Sign In to Workspace'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100 text-xs text-slate-500 space-y-1.5 font-mono">
            <div className="flex justify-between">
              <span>Admin:</span>
              <span>admin@medoryx.in / admin123</span>
            </div>
            <div className="flex justify-between">
              <span>Pharmacist:</span>
              <span>pharmacist@medoryx.in / pharma123</span>
            </div>
            <div className="flex justify-between">
              <span>Store Staff:</span>
              <span>staff@medoryx.in / staff123</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
