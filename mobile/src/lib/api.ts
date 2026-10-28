export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function normalizeApiBase(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/+$/, '');
  } catch { return null; }
}

export async function apiRequest<T>(base: string, token: string, path: string, options: RequestInit = {}, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');
    const response = await fetch(`${base}${path}`, { ...options, headers, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    const text = await response.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : {}; } catch { throw new ApiError('Sunucudan beklenen yanıt alınamadı. Lütfen yeniden kontrol et.', response.status); }
    if (!response.ok) {
      const candidate = data && typeof data === 'object' && 'error' in data ? (data as { error: unknown }).error : undefined;
      const message = typeof candidate === 'string' && candidate.trim() ? candidate.slice(0, 600)
        : response.status === 401 ? 'Erişim kodun geçersiz veya süresi dolmuş. Özel bağlantını yeniden aç.'
          : response.status === 429 ? 'Şu an çok fazla işlem var. Biraz bekleyip yeniden dene.'
            : 'İşlem tamamlanamadı. Lütfen yeniden dene.';
      throw new ApiError(message, response.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.signal?.aborted) throw error;
    throw new ApiError(timedOut ? 'Sunucunun yanıtı beklenenden uzun sürdü. Bağlantını kontrol edip yeniden dene.' : 'Bağlantı kurulamadı. İnternet bağlantını kontrol edip yeniden dene.');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

export const jsonRequest = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const errorText = (error: unknown): string => error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu. Yeniden dene.';
