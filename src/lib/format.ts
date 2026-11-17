export function formatINR(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value || 0);
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') || iso.includes(' ') ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}
