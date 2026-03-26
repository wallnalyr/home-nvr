/**
 * Shared auth-aware SWR fetchers.
 *
 * authFetcher     — on 401 hard-redirects to /login, throws on other errors.
 * authFetcherSafe — on 401 hard-redirects to /login, returns [] on other errors.
 */

function handleUnauthorized(): never {
  // Hard redirect bypasses Next.js router and SW cache
  window.location.href = "/login";
  throw new Error("Unauthorized");
}

export async function authFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function authFetcherSafe<T = unknown[]>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) return [] as unknown as T;
  const data = await res.json();
  return (Array.isArray(data) ? data : []) as T;
}
