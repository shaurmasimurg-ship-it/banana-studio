/**
 * Isolated mobile video gateway. This does not change Banana Studio Auth.
 * Every private operation authenticates a random 256-bit workspace capability.
 * Only its SHA-256 digest is stored in Postgres. Provider credentials are
 * encrypted with a key derived from the Edge runtime's server-only credential.
 */
type Json = Record<string, any>;
type Fetch = typeof globalThis.fetch;

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 32 * 1024 * 1024;
export const RATE_ESTIMATES = { '480P': 0.05, '768P': 0.08, '1080P': 0.16 };
const BUCKET = 'resul-mobile-media';
const MODEL = 'minimax/h3-max';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '600',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'REQUEST_FAILED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const encode = (value: string) => new TextEncoder().encode(value);

export async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function accessToken(header: string | null): string {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(header ?? '');
  if (!match) throw new HttpError(401, 'Sana özel erişim bağlantısını açman gerekiyor.', 'UNAUTHORIZED');
  return match[1];
}

export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, 'Geçersiz işlem kimliği.', 'INVALID_ID');
  }
  return value.toLowerCase();
}

export function queueUrl(value: unknown, requestId: string, kind?: 'status' | 'result' | 'cancel'): string {
  if (typeof value !== 'string') throw new HttpError(502, 'Video servisinin yanıtı doğrulanamadı.');
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpError(502, 'Video servisinin yanıtı doğrulanamadı.'); }
  const prefix = `/${MODEL}/requests/${encodeURIComponent(requestId)}`;
  if (url.origin !== 'https://queue.fal.run' || url.username || url.password || url.hash || url.search ||
      ![prefix, `${prefix}/status`, `${prefix}/cancel`, `${prefix}/response`].includes(url.pathname)) {
    throw new HttpError(502, 'Video servisinin kuyruk adresi doğrulanamadı.');
  }
  // Some H3 responses append /response; the REST result resource is the base.
  if (url.pathname === `${prefix}/response`) url.pathname = prefix;
  if (kind && url.pathname !== (kind === 'result' ? prefix : `${prefix}/${kind}`)) {
    throw new HttpError(502, 'Video servisinin kuyruk işlemi doğrulanamadı.');
  }
  return url.href;
}

export function mediaUrl(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(502, 'Video dosyasının adresi bulunamadı.');
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpError(502, 'Video dosyasının adresi doğrulanamadı.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !(url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media'))) {
    throw new HttpError(502, 'Video dosyasının adresi doğrulanamadı.');
  }
  return url.href;
}

export function validateJob(body: Json): Json {
  const idempotency_key = uuid(body.idempotencyKey);
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > 4000) throw new HttpError(400, 'Sahne açıklaması 1–4000 karakter olmalı.');
  if (!['text', 'image'].includes(body.mode)) throw new HttpError(400, 'Video türünü seç.');
  if (![5, 10, 15].includes(body.duration)) throw new HttpError(400, 'Süre 5, 10 veya 15 saniye olmalı.');
  if (!['480P', '768P', '1080P'].includes(body.resolution)) throw new HttpError(400, 'Geçerli bir çözünürlük seç.');
  if (!['9:16', '16:9', '1:1'].includes(body.aspectRatio)) throw new HttpError(400, 'Geçerli bir ekran oranı seç.');
  return {
    idempotency_key, prompt, mode: body.mode, duration: body.duration,
    resolution: body.resolution, aspect_ratio: body.aspectRatio,
    image_id: body.mode === 'image' ? uuid(body.imageId) : null,
  };
}

export function falInput(job: Json, imageUrl?: string): Json {
  const result: Json = {
    prompt: job.prompt, prompt_expansion_mode: 'disabled', duration: job.duration,
    resolution: job.resolution, enable_safety_checker: true, sync_mode: false,
  };
  if (job.mode === 'image') {
    if (!imageUrl) throw new HttpError(400, 'Önce bir fotoğraf yükle.');
    result.image_url = imageUrl;
  } else result.aspect_ratio = job.aspect_ratio;
  return result;
}

export function imageType(bytes: Uint8Array, declared: string): { mime: string; extension: string } {
  let mime = '';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mime = 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) mime = 'image/png';
  if (new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
      new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') mime = 'image/webp';
  if (!mime || mime !== declared) throw new HttpError(415, 'JPEG, PNG veya WebP fotoğraf yükle.');
  return { mime, extension: mime === 'image/jpeg' ? 'jpg' : mime.slice(6) };
}

export async function readBounded(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array> {
  if (!body) throw new HttpError(400, 'Dosya boş.');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new HttpError(413, 'Dosya boyutu izin verilen sınırı aşıyor.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new HttpError(400, 'Dosya boş.');
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function base64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function unbase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const source = await crypto.subtle.importKey('raw', encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256', salt: encode('resul-video-credential-v1'), info: encode('fal-key-at-rest'),
  }, source, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealProvider(value: string, runtimeSecret: string, workspaceId: string): Promise<{ cipher: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encode(workspaceId) },
    await encryptionKey(runtimeSecret), encode(value));
  return { cipher: base64(new Uint8Array(cipher)), iv: base64(iv) };
}

export async function openProvider(cipher: string, iv: string, runtimeSecret: string, workspaceId: string): Promise<string> {
  try {
    const result = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(iv), additionalData: encode(workspaceId) },
      await encryptionKey(runtimeSecret), unbase64(cipher));
    return new TextDecoder().decode(result);
  } catch { throw new HttpError(409, 'Sunucu güvenlik ayarı değişmiş. fal.ai anahtarını yeniden kaydet.', 'KEY_REENTRY_REQUIRED'); }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
}

async function jsonBody(request: Request): Promise<Json> {
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) throw new HttpError(415, 'JSON isteği bekleniyor.');
  const bytes = await readBounded(request.body, 24 * 1024);
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, 'İstek okunamadı.'); }
}

function errorMessage(value: Json, fallback: string): string {
  const detail = value.detail;
  const message = typeof value.error === 'string' ? value.error :
    typeof value.message === 'string' ? value.message :
      typeof detail === 'string' ? detail : fallback;
  return message.replace(/[\r\n\t]/g, ' ').slice(0, 300);
}

export function publicJob(job: Json, videoUrl?: string): Json {
  return {
    id: job.id, mode: job.mode, prompt: job.prompt, status: job.status,
    duration: job.duration, resolution: job.resolution, aspectRatio: job.aspect_ratio,
    imageId: job.image_id || undefined, createdAt: job.created_at, updatedAt: job.updated_at,
    videoUrl: videoUrl || undefined, error: job.status === 'completed' ? undefined : job.error || undefined, warning: job.warning || undefined,
  };
}

export function createHandler(config: { supabaseUrl: string; serviceRoleKey: string; fetch?: Fetch }) {
  const transport = config.fetch ?? globalThis.fetch;
  const supabaseUrl = config.supabaseUrl.replace(/\/$/, '');
  const adminHeaders = { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}` };
  const request = (url: string, init: RequestInit = {}, timeout = 20_000) =>
    transport(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeout) });

  async function rpc(action: string, hash: string, payload: Json = {}): Promise<any> {
    const response = await request(`${supabaseUrl}/rest/v1/rpc/resul_mobile_api`, {
      method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_action: action, p_access_hash: hash, p_payload: payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = data.code;
      if (code === '28000' || code === '28P01') throw new HttpError(401, 'Erişim bağlantısı geçersiz veya kapatılmış.', 'UNAUTHORIZED');
      if (code === 'P0002') throw new HttpError(404, 'Bu kayıt çalışma alanında bulunamadı.', 'NOT_FOUND');
      if (code === 'P0001' || code === '23514') {
        const message = errorMessage(data, 'İşlem şu anda tamamlanamıyor.');
        const local = message.includes('Two videos') ? 'İki video zaten hazırlanıyor. Biri tamamlanınca yeniden deneyebilirsin.' :
          message.includes('12 video') ? 'Bir saat içinde 12 video isteği sınırına ulaşıldı. Daha sonra yeniden deneyebilirsin.' :
          message.includes('Save a provider') ? 'Önce Ayarlar bölümünden fal.ai anahtarını ekle.' : 'Bu işlem mevcut kayıtla çakışıyor. Sayfayı yenileyip durumu kontrol et.';
        throw new HttpError(409, local, 'CONFLICT');
      }
      if (code === '22023' || code === '22P02') throw new HttpError(400, 'İstek alanlarından biri geçersiz. Seçimlerini kontrol et.', 'INVALID_REQUEST');
      throw new HttpError(503, 'Çalışma alanına şu anda ulaşılamıyor. Biraz sonra tekrar dene.', 'DATABASE_UNAVAILABLE');
    }
    return data;
  }

  function objectUrl(key: string): string {
    return `${supabaseUrl}/storage/v1/object/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async function upload(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    const response = await request(objectUrl(key), {
      method: 'POST', headers: { ...adminHeaders, 'Content-Type': mime, 'x-upsert': 'true' }, body: bytes,
    }, 45_000);
    if (!response.ok) throw new HttpError(503, 'Dosya kaydedilemedi. Depolama alanını veya bağlantını kontrol et.', 'STORAGE_UNAVAILABLE');
  }

  async function signed(key: string, expiresIn = 3600): Promise<string> {
    const response = await request(`${supabaseUrl}/storage/v1/object/sign/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn }),
    });
    const result = await response.json().catch(() => ({}));
    const value = result.signedURL ?? result.signedUrl;
    if (!response.ok || typeof value !== 'string') throw new HttpError(503, 'Dosya bağlantısı hazırlanamadı.');
    if (value.startsWith('/object/')) return `${supabaseUrl}/storage/v1${value}`;
    if (value.startsWith(`${supabaseUrl}/storage/v1/`)) return value;
    throw new HttpError(503, 'Dosya bağlantısı doğrulanamadı.');
  }

  async function clientJob(job: Json): Promise<Json> {
    let url: string | undefined;
    if (job.output_key) {
      try { url = await signed(job.output_key); } catch { /* Provider link remains a fallback. */ }
    }
    if (!url && job.source_video_url) url = mediaUrl(job.source_video_url);
    return publicJob(job, url);
  }

  async function provider(workspace: Json): Promise<string> {
    if (!workspace.provider_cipher || !workspace.provider_iv) throw new HttpError(409, 'Önce Ayarlar bölümünden fal.ai anahtarını ekle.', 'KEY_REQUIRED');
    return openProvider(workspace.provider_cipher, workspace.provider_iv, config.serviceRoleKey, workspace.id);
  }

  const archives = new Map<string, Promise<Json>>();
  async function archiveWork(job: Json, hash: string): Promise<Json> {
    if (!job.source_video_url || job.output_key) return job;
    const outputKey = `${job.workspace_id}/videos/${job.id}.mp4`;
    try {
      const response = await request(mediaUrl(job.source_video_url), {}, 35_000);
      if (!response.ok) throw new Error('media unavailable');
      const length = Number(response.headers.get('content-length') || '0');
      if (length > MAX_VIDEO_BYTES) throw new Error('media too large');
      const bytes = await readBounded(response.body, MAX_VIDEO_BYTES);
      const type = (response.headers.get('content-type') || '').split(';')[0];
      if (!['video/mp4', 'application/octet-stream', 'video/quicktime', ''].includes(type)) throw new Error('unexpected media type');
      await upload(outputKey, bytes, 'video/mp4');
      return await rpc('job_update', hash, { id: job.id, output_key: outputKey, warning: null });
    } catch {
      return await rpc('job_update', hash, { id: job.id,
        warning: 'Video hazır; kalıcı kopyası henüz kaydedilemedi. Geçici bağlantı geçerliyken indir; daha sonra yeniden kontrol edebilirsin.' });
    }
  }

  async function archive(job: Json, hash: string): Promise<Json> {
    const key = `${job.workspace_id}/${job.id}`;
    const pending = archives.get(key);
    if (pending) return pending;
    const work = archiveWork(job, hash).finally(() => { archives.delete(key); });
    archives.set(key, work);
    return work;
  }

  return async function handle(requestInput: Request): Promise<Response> {
    if (requestInput.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const pathname = new URL(requestInput.url).pathname;
    const path = pathname.slice(pathname.lastIndexOf('/resul-video') + '/resul-video'.length).replace(/\/$/, '') || '/';
    if (requestInput.method === 'GET' && path === '/health') return json({ ok: true, version: 'mobile-1' });
    try {
      if (!config.serviceRoleKey || !supabaseUrl.startsWith('https://')) throw new HttpError(503, 'Sunucu kurulumu tamamlanmamış.');
      const token = accessToken(requestInput.headers.get('Authorization'));
      const hash = await sha256(token);
      // The service-only RPC resolves the bearer digest to an active workspace.
      // No caller-supplied workspace id, email or role is used for authorization.
      const context = await rpc('context', hash);
      const workspace = context.workspace;
      if (!workspace?.id) throw new HttpError(401, 'Erişim bağlantısı geçersiz.', 'UNAUTHORIZED');

      if (requestInput.method === 'GET' && (path === '/workspace' || path === '/')) {
        return json({
          name: workspace.name, providerConfigured: Boolean(workspace.provider_cipher), keySuffix: workspace.key_suffix ?? null,
          pricing: { rates: RATE_ESTIMATES, currency: 'USD', source: 'estimate' },
          jobs: await Promise.all((context.jobs ?? []).map(clientJob)),
          limits: { maxConcurrent: 2, maxImageBytes: MAX_IMAGE_BYTES },
        });
      }

      if (path === '/provider' && requestInput.method === 'POST') {
        const body = await jsonBody(requestInput);
        const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
        if (!/^[\x21-\x7e]{16,256}$/.test(key)) throw new HttpError(400, 'fal.ai anahtarını eksiksiz yapıştır.');
        // Authenticated pricing lookup validates the key without a paid inference.
        const response = await request(`https://api.fal.ai/v1/models/pricing?endpoint_id=${MODEL}/text-to-video&endpoint_id=${MODEL}/image-to-video`, {
          headers: { Authorization: `Key ${key}`, Accept: 'application/json' },
        });
        if (response.status === 401 || response.status === 403) throw new HttpError(400, 'fal.ai anahtarı doğrulanamadı. Anahtarı kontrol et.', 'INVALID_PROVIDER_KEY');
        if (!response.ok) throw new HttpError(503, 'fal.ai şu anda anahtarı doğrulayamıyor. Biraz sonra yeniden dene.');
        const prices = await response.json().catch(() => null);
        if (!Array.isArray(prices?.prices)) throw new HttpError(502, 'fal.ai doğrulama yanıtı beklenen biçimde değil.');
        const sealed = await sealProvider(key, config.serviceRoleKey, workspace.id);
        await rpc('provider_set', hash, { ...sealed, suffix: key.slice(-4) });
        return json({ configured: true, keySuffix: key.slice(-4) });
      }

      if (path === '/provider' && requestInput.method === 'DELETE') {
        await rpc('provider_delete', hash);
        return json({ configured: false, keySuffix: null });
      }

      if (path === '/upload' && requestInput.method === 'POST') {
        const contentLength = Number(requestInput.headers.get('content-length') || 0);
        if (contentLength > MAX_IMAGE_BYTES) throw new HttpError(413, 'Fotoğraf 8 MB veya daha küçük olmalı.');
        const bytes = await readBounded(requestInput.body, MAX_IMAGE_BYTES);
        const kind = imageType(bytes, (requestInput.headers.get('content-type') ?? '').split(';')[0]);
        const id = crypto.randomUUID();
        const key = `${workspace.id}/inputs/${id}.${kind.extension}`;
        await upload(key, bytes, kind.mime);
        await rpc('upload_add', hash, { id, object_key: key, mime: kind.mime, bytes: bytes.byteLength });
        return json({ id, previewUrl: await signed(key, 3600) }, 201);
      }

      if (path === '/jobs' && requestInput.method === 'POST') {
        const input = validateJob(await jsonBody(requestInput));
        const key = await provider(workspace);
        let imageUrl: string | undefined;
        if (input.mode === 'image') {
          const uploaded = await rpc('upload_get', hash, { id: input.image_id });
          imageUrl = await signed(uploaded.object_key, 86400);
        }
        // Reservation is serialized and unique per (workspace, idempotency key).
        // A retry returns the existing job and never starts another paid request.
        const reservation = await rpc('job_reserve', hash, input);
        if (!reservation.created) return json({ job: await clientJob(reservation.job) });
        const job = reservation.job;
        let response: Response;
        try {
          response = await request(`https://queue.fal.run/${MODEL}/${input.mode === 'image' ? 'image-to-video' : 'text-to-video'}`, {
            method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(falInput(input, imageUrl)),
          }, 25_000);
        } catch {
          const saved = await rpc('job_update', hash, { id: job.id, status: 'submission_unknown',
            error: 'Video servisine gönderimin sonucu kesinleşmedi. Çift ücret oluşmaması için otomatik tekrar yapılmadı; fal.ai geçmişini kontrol et.' });
          return json({ job: await clientJob(saved) });
        }
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          const uncertain = response.status >= 500;
          const saved = await rpc('job_update', hash, { id: job.id, status: uncertain ? 'submission_unknown' : 'failed',
            error: uncertain ? 'Video servisi gönderimi kesinleştiremedi. Otomatik tekrar yapılmadı; fal.ai geçmişini kontrol et.' :
              response.status === 402 ? 'fal.ai bakiyesi yetersiz. Hesabındaki bakiyeyi kontrol et.' :
              response.status === 401 || response.status === 403 ? 'fal.ai anahtarı veya model erişimi kabul edilmedi. Hesap ayarlarını kontrol et.' :
              response.status === 429 ? 'fal.ai istek sınırına ulaşıldı. Biraz bekleyip yeniden dene.' :
              'Video servisi isteği kabul etmedi. Açıklamayı, fotoğrafı ve fal.ai model erişimini kontrol et.' });
          return json({ job: await clientJob(saved) });
        }
        try {
          const requestId = uuid(result.request_id);
          const saved = await rpc('job_update', hash, {
            id: job.id, status: result.status === 'IN_PROGRESS' ? 'running' : 'queued', provider_request_id: requestId,
            status_url: queueUrl(result.status_url, requestId, 'status'), response_url: queueUrl(result.response_url, requestId, 'result'),
            cancel_url: result.cancel_url ? queueUrl(result.cancel_url, requestId, 'cancel') : null,
          });
          return json({ job: await clientJob(saved) }, 201);
        } catch {
          // The upstream may already have accepted this paid request.
          const saved = await rpc('job_update', hash, { id: job.id, status: 'submission_unknown',
            error: 'İstek gönderildi ancak takip bilgisi kaydedilemedi. Otomatik tekrar yapılmadı; fal.ai geçmişini kontrol et.' });
          return json({ job: await clientJob(saved) });
        }
      }

      if (requestInput.method === 'GET' && /^\/jobs\/[0-9a-f-]+$/i.test(path)) {
        let job = await rpc('job_get', hash, { id: uuid(path.split('/')[2]) });
        if (job.status === 'completed') {
          if (!job.output_key && job.source_video_url) job = await archive(job, hash);
          return json({ job: await clientJob(job) });
        }
        if (!['queued', 'running'].includes(job.status)) return json({ job: await clientJob(job) });
        const key = await provider(workspace);
        const response = await request(queueUrl(job.status_url, job.provider_request_id, 'status'), { headers: { Authorization: `Key ${key}` } });
        if (!response.ok) throw new HttpError(503, 'Video durumu geçici olarak alınamadı. Aynı iş takip edilmeye devam edecek.', 'POLL_RETRY');
        const status = await response.json();
        if (status.status === 'COMPLETED') {
          if (status.error) {
            job = await rpc('job_update', hash, { id: job.id, status: 'failed', error: 'Video servisi bu üretimi tamamlayamadı. Ayrıntıyı fal.ai işlem geçmişinden kontrol et.' });
          } else {
            const output = await request(queueUrl(job.response_url, job.provider_request_id, 'result'), { headers: { Authorization: `Key ${key}` } });
            const result = await output.json().catch(() => ({}));
            // Lookup authorization, missing-result, and transient errors do not
            // invalidate an already accepted paid request or authorize a retry.
            if (!output.ok && ![400, 422].includes(output.status)) throw new HttpError(503, 'Video sonucu henüz indirilemiyor. Aynı iş yeniden kontrol edilecek.', 'POLL_RETRY');
            if (!output.ok || result.error) {
              job = await rpc('job_update', hash, { id: job.id, status: 'failed', error: 'Video servisi bu üretimi tamamlayamadı. Ayrıntıyı fal.ai işlem geçmişinden kontrol et.' });
            } else {
              job = await rpc('job_update', hash, { id: job.id, status: 'completed', source_video_url: mediaUrl(result.video?.url), error: null });
              job = await archive(job, hash);
            }
          }
        } else if (status.status === 'IN_PROGRESS' || status.status === 'IN_QUEUE') {
          job = await rpc('job_update', hash, { id: job.id, status: status.status === 'IN_PROGRESS' ? 'running' : 'queued' });
        } else throw new HttpError(503, 'Video servisinin durumu henüz kesinleşmedi. Aynı iş yeniden kontrol edilecek.', 'POLL_RETRY');
        return json({ job: await clientJob(job) });
      }
      throw new HttpError(404, 'Bu işlem bulunamadı.', 'NOT_FOUND');
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
      return json({ error: 'Bağlantı geçici olarak kesildi. Biraz sonra yeniden dene.', code: 'TEMPORARY_ERROR' }, 503);
    }
  };
}
