export const ACCESS_STORAGE_KEY = 'resul-studio-access';
const ACCESS_PATTERN = /^[a-f0-9]{64}$/;

export function validAccessCode(value: unknown): value is string {
  return typeof value === 'string' && ACCESS_PATTERN.test(value);
}

export function parseAccessFragment(hash: string): { hasAccess: boolean; token: string | null } {
  const values = new URLSearchParams(hash.replace(/^#/, ''));
  const candidates = values.getAll('access');
  return {
    hasAccess: candidates.length > 0,
    token: candidates.length === 1 && validAccessCode(candidates[0]) ? candidates[0] : null,
  };
}

interface AccessBrowser {
  location: { hash: string; pathname: string; search: string };
  history: { state: unknown; replaceState(data: unknown, unused: string, url?: string | URL | null): void };
  localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

export function consumeAccess(browser: AccessBrowser): { token: string | null; invalidLink: boolean } {
  const parsed = parseAccessFragment(browser.location.hash);
  // Remove the fragment before any API request or rendering, including malformed codes.
  if (parsed.hasAccess) {
    browser.history.replaceState(browser.history.state, '', browser.location.pathname + browser.location.search);
    if (parsed.token) {
      try { browser.localStorage.setItem(ACCESS_STORAGE_KEY, parsed.token); } catch { /* Session still works in memory. */ }
    }
    return { token: parsed.token, invalidLink: !parsed.token };
  }
  try {
    const token = browser.localStorage.getItem(ACCESS_STORAGE_KEY);
    return { token: validAccessCode(token) ? token : null, invalidLink: false };
  } catch {
    return { token: null, invalidLink: false };
  }
}

export function rememberAccess(token: string): void {
  if (!validAccessCode(token)) return;
  try { localStorage.setItem(ACCESS_STORAGE_KEY, token); } catch { /* Storage can be unavailable in private mode. */ }
}

export function forgetAccess(): void {
  try { localStorage.removeItem(ACCESS_STORAGE_KEY); } catch { /* Memory session is cleared separately. */ }
}
