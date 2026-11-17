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
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      ...options,
    });

    const contentType = res.headers.get('content-type') || '';

    // If deployment serves HTML (SPA fallback), 404/405, or 5xx serverless failure,
    // transparently fall back to the local persisted Medoryx pharmacy engine.
    if (
      res.status === 404 ||
      res.status === 405 ||
      res.status >= 500 ||
      !contentType.toLowerCase().includes('application/json')
    ) {
      const { localFallbackRequest } = await import('./localFallback');
      return await localFallbackRequest<T>(url, options);
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const errMsg =
        data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string'
          ? (data as { error: string }).error
          : `Request failed (${res.status})`;
      throw new Error(errMsg);
    }
    if (data === null) {
      const { localFallbackRequest } = await import('./localFallback');
      return await localFallbackRequest<T>(url, options);
    }
    return data as T;
  } catch (err) {
    // Re-throw explicit API validation errors (4xx); fall back on network/runtime failures
    if (err instanceof TypeError || (err instanceof Error && err.message.startsWith('Failed to fetch'))) {
      const { localFallbackRequest } = await import('./localFallback');
      return await localFallbackRequest<T>(url, options);
    }
    throw err;
  }
}

export async function fetchTextWithFallback(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && !contentType.toLowerCase().includes('text/html')) {
      return await res.text();
    }
  } catch {
    // Fall back below
  }
  const { localFallbackRequest } = await import('./localFallback');
  return await localFallbackRequest<string>(url, { method: 'GET' });
}
