import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUpRight, CheckCircle2, ChevronRight, CircleAlert, Clock3, Film, ImagePlus, KeyRound, LoaderCircle, LockKeyhole, LogOut, Plus, RefreshCw, Settings2, Sparkles, Trash2, Type, Upload, WandSparkles, X } from 'lucide-react';
import type { AspectRatio, Duration, GenerationAttempt, GenerationInput, Job, Mode, Resolution, Workspace } from './types.ts';
import { ApiError, apiRequest, errorText, jsonRequest, normalizeApiBase } from './lib/api.ts';
import { forgetAccess, rememberAccess, validAccessCode } from './lib/auth.ts';
import { estimateCost, formatCost, isPollingJob, isUnfinishedJob, MAX_PROMPT_LENGTH, mergeJob, safeMediaUrl, validateGeneration } from './lib/generation.ts';
import { prepareImage } from './lib/image.ts';

const API_BASE = normalizeApiBase(import.meta.env.VITE_MOBILE_API_URL);
const SAMPLE_PROMPTS: Record<Mode, string> = {
  text: 'Gün batımında sakin bir sahil. Dalgalar yavaşça kıyıya vuruyor, altın ışık suya yansıyor. Kamera su hizasında öne doğru süzülüyor. Doğal renkler, sinematik atmosfer.',
  image: 'Fotoğraftaki kompozisyonu ve kişiyi koru. Hafif bir esinti saçları ve kıyafeti hareketlendirsin. Kamera yavaşça yaklaşsın; hareketler doğal ve zarif olsun.',
};
const STATUS_LABELS: Record<Job['status'], string> = {
  submitting: 'İstek alınıyor', queued: 'Sırada', running: 'Hazırlanıyor', completed: 'Hazır', failed: 'Tamamlanamadı', submission_unknown: 'Kontrol gerekiyor',
};

function Brand() {
  return <a className="brand" href="#studio" aria-label="Resul Studio ana ekran">
    <img src="/icon.svg" alt="" width="42" height="42" />
    <span>Resul<span className="brand-light"> Studio</span><small>FİKİRLERİN HAREKETE GEÇSİN</small></span>
  </a>;
}

function Notice({ children, tone = 'error' }: { children: React.ReactNode; tone?: 'error' | 'info' | 'success' }) {
  return <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
    {tone === 'success' ? <CheckCircle2 size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
    <div>{children}</div>
  </div>;
}

function AccessGate({ onAccess, error, configured }: { onAccess: (code: string) => void; error: string; configured: boolean }) {
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const token = code.trim();
    if (!validAccessCode(token)) { setLocalError('Özel bağlantındaki 64 karakterlik erişim kodunu eksiksiz gir.'); return; }
    setLocalError('');
    setCode('');
    onAccess(token);
  };
  return <div className="access-layout" id="studio">
    <header className="topbar"><Brand /><span className="privacy-label"><LockKeyhole size={14} aria-hidden="true" /> Özel stüdyo</span></header>
    <main className="access-main">
      <div className="access-art" aria-hidden="true"><span className="art-frame frame-one" /><span className="art-frame frame-two" /><div className="art-center"><Film size={42} strokeWidth={1.3} /></div><span className="art-spark"><Sparkles size={23} /></span></div>
      <span className="eyebrow">RESUL STUDIO</span>
      <h1>Hayal ettiğin sahne,<br /><span>senin stüdyonda.</span></h1>
      <p className="access-intro">Kelimelerinden video oluştur. Fotoğraflarına hareket kat.<br className="desktop-break" /> Yaratıcılığına ayrılmış özel bir alan.</p>
      <section className="access-card" aria-labelledby="access-title">
        <div className="access-card-icon"><LockKeyhole size={22} aria-hidden="true" /></div>
        <h2 id="access-title">{configured ? 'Özel bağlantınla giriş yap' : 'Stüdyo bağlantısı hazırlanıyor'}</h2>
        <p>{configured ? 'Stüdyonu açmak için sana verilen özel erişim bağlantısını yeniden aç. Bağlantın yalnızca sana aittir.' : 'Bu sürümün sunucu bağlantısı henüz ayarlanmamış. Kurulum tamamlandığında özel bağlantınla giriş yapabilirsin.'}</p>
        {error ? <Notice>{error}</Notice> : null}
        {configured ? <details className="manual-access" open={Boolean(error)}>
          <summary>Erişim kodum var <ChevronRight size={16} aria-hidden="true" /></summary>
          <form onSubmit={submit}>
            <label htmlFor="access-code">Özel erişim kodu</label>
            <input id="access-code" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={code} onChange={event => setCode(event.target.value)} placeholder="64 karakterlik kodun" required maxLength={64} aria-describedby="access-help" />
            <p id="access-help" className="field-hint">Kod bu cihazda hatırlanır. Paylaşılan bir cihazda işin bittiğinde erişimi kaldır.</p>
            {localError ? <Notice>{localError}</Notice> : null}
            <button className="button primary full" type="submit">Stüdyomu aç <ArrowUpRight size={18} aria-hidden="true" /></button>
          </form>
        </details> : null}
      </section>
      <p className="access-footnote"><LockKeyhole size={13} aria-hidden="true" /> Üretimlerin ve ayarların sana özel.</p>
    </main>
    <footer className="site-footer"><span>Bir fikirle başlar.</span><span>Resul Studio</span></footer>
  </div>;
}

function ProviderSettings({ workspace, onClose, onSave, onRemove, onForget }: { workspace: Workspace; onClose: () => void; onSave: (key: string) => Promise<void>; onRemove: () => Promise<void>; onForget: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true); setError(''); setSuccess('');
    try { await onSave(key.trim()); setKey(''); setSuccess('fal.ai bağlantın hazır. Artık video oluşturabilirsin.'); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError(''); setSuccess('');
    try { await onRemove(); setKey(''); setConfirmRemove(false); setSuccess('fal.ai anahtarı sunucudan kaldırıldı.'); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === dialog.current && !busy) onClose(); }}>
    <div className="dialog-inner">
      <div className="dialog-heading"><div><span className="eyebrow">STÜDYO AYARLARI</span><h2 id="settings-title">Üretim bağlantısı</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Ayarları kapat"><X size={22} /></button></div>
      <div className="provider-card"><span className="provider-symbol">f.</span><div><strong>fal.ai</strong><p>MiniMax H3 Max</p></div><span className={`status-badge ${workspace.providerConfigured ? 'completed' : 'queued'}`}>{workspace.providerConfigured ? 'Bağlı' : 'Bağlanmadı'}</span></div>
      <p className="settings-description">Video üretimi kendi fal.ai hesabından ücretlendirilir. Anahtarın yalnızca sunucuda şifrelenerek saklanır.</p>
      {workspace.providerConfigured ? <p className="key-suffix"><KeyRound size={15} aria-hidden="true" /> Kayıtlı anahtar <code>•••• {workspace.keySuffix?.slice(-4) || '••••'}</code></p> : null}
      <form onSubmit={save}>
        <label htmlFor="provider-key">{workspace.providerConfigured ? 'Yeni fal.ai API anahtarı' : 'fal.ai API anahtarı'}</label>
        <input id="provider-key" type="password" value={key} onChange={event => setKey(event.target.value)} placeholder="Anahtarını buraya yapıştır" autoComplete="off" autoCapitalize="none" spellCheck={false} required disabled={busy} aria-describedby="provider-key-help" />
        <p id="provider-key-help" className="field-hint">Bağlantı kontrolü ücretsizdir; video üretmez. Anahtar bu tarayıcıya kaydedilmez.</p>
        {error ? <Notice>{error}</Notice> : null}
        {success ? <Notice tone="success">{success}</Notice> : null}
        <button className="button primary full" type="submit" disabled={busy || !key.trim()}>{busy ? <span className="spin"><LoaderCircle size={18} /></span> : <KeyRound size={17} aria-hidden="true" />}{busy ? 'Bağlantı kontrol ediliyor…' : workspace.providerConfigured ? 'Anahtarı güncelle' : 'Bağla ve güvenle sakla'}</button>
      </form>
      <a className="text-link provider-link" href="https://fal.ai/dashboard/keys" target="_blank" rel="noopener noreferrer">fal.ai anahtarlarımı aç <ArrowUpRight size={15} aria-hidden="true" /></a>
      {workspace.providerConfigured ? <div className="remove-provider">
        {confirmRemove ? <><p>Anahtar kaldırılacak. Yeni üretim için yeniden bağlaman gerekir.</p><div className="button-row"><button className="button danger small" type="button" onClick={() => void remove()} disabled={busy}>Anahtarı kaldır</button><button className="button secondary small" type="button" onClick={() => setConfirmRemove(false)} disabled={busy}>Vazgeç</button></div></> : <button className="text-button muted" type="button" onClick={() => setConfirmRemove(true)} disabled={busy}><Trash2 size={15} aria-hidden="true" /> fal.ai bağlantısını kaldır</button>}
      </div> : null}
      <div className="device-settings"><div><strong>Bu cihazdaki erişim</strong><p>Özel bağlantınla tekrar giriş yapabilirsin.</p></div><button className="icon-button" type="button" onClick={onForget} disabled={busy} aria-label="Bu cihazdaki erişimi kaldır"><LogOut size={20} /></button></div>
    </div>
  </dialog>;
}

function JobCard({ job, onRefresh, checking, checkError, onReuse, reuseDisabled }: { job: Job; onRefresh: () => void; checking: boolean; checkError?: string; onReuse: () => void; reuseDisabled: boolean }) {
  const videoUrl = safeMediaUrl(job.videoUrl);
  const date = new Date(job.createdAt);
  const dateLabel = Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
  return <article className={`job-card job-${job.status}`}>
    <div className="job-card-top"><span className={`status-badge ${job.status}`}><span className="status-dot" />{STATUS_LABELS[job.status]}</span><time dateTime={job.createdAt}>{dateLabel}</time></div>
    {job.status === 'completed' && videoUrl ? <div className="video-wrap"><video controls playsInline preload="metadata" src={videoUrl}>Tarayıcın videoyu oynatamıyor. Aşağıdaki bağlantıdan açabilirsin.</video></div>
      : <div className={`job-placeholder ${isPollingJob(job) ? 'in-progress' : ''}`}>
        {isPollingJob(job) ? <><span className="render-orbit"><Film size={26} strokeWidth={1.4} aria-hidden="true" /></span><strong>{job.status === 'running' ? 'Sahnen hayat buluyor.' : job.status === 'queued' ? 'Sıran geldiğinde başlayacak.' : 'İsteğin güvenle alınıyor.'}</strong><span>Bu sayfaya daha sonra dönebilirsin.</span></>
          : <><CircleAlert size={30} strokeWidth={1.5} aria-hidden="true" /><strong>{job.status === 'submission_unknown' ? 'Gönderim durumu doğrulanamadı.' : job.status === 'completed' ? 'Video bağlantısı henüz alınamadı.' : 'Bu sahne tamamlanamadı.'}</strong></>}
      </div>}
    <div className="job-content">
      <div className="job-metadata"><span>{job.mode === 'image' ? <ImagePlus size={13} aria-hidden="true" /> : <Type size={13} aria-hidden="true" />}{job.mode === 'image' ? 'Görselden' : 'Metinden'}</span><span>{job.duration} sn</span><span>{job.resolution.toLowerCase()}</span><span>{job.mode === 'image' ? 'Özgün kadraj' : job.aspectRatio}</span></div>
      <details className="job-prompt"><summary>{job.prompt}<ChevronRight size={15} aria-hidden="true" /></summary><p>{job.prompt}</p></details>
      {job.warning ? <Notice tone="info">{job.warning}</Notice> : null}
      {job.error ? <p className="job-error"><CircleAlert size={15} aria-hidden="true" />{job.error}</p> : null}
      {job.status === 'submission_unknown' ? <p className="unknown-explanation">Çift ücretlendirmeyi önlemek için otomatik olarak yeniden gönderilmez. Önce mevcut işlemin durumunu kontrol et.</p> : null}
      {checkError ? <Notice>{checkError}</Notice> : null}
      <div className="job-actions"><button className="text-button" type="button" onClick={onReuse} disabled={reuseDisabled}><WandSparkles size={15} aria-hidden="true" /> Açıklamayı kullan</button>
        {job.status === 'completed' && videoUrl ? <a className="text-link accent" href={videoUrl} target="_blank" rel="noopener noreferrer" download>Videoyu aç / indir <ArrowUpRight size={15} aria-hidden="true" /></a>
          : <button className="text-button" type="button" onClick={onRefresh} disabled={checking}>{checking ? <span className="spin"><RefreshCw size={14} /></span> : <RefreshCw size={14} aria-hidden="true" />} Durumu kontrol et</button>}
      </div>
    </div>
  </article>;
}

export default function App({ initialAccess }: { initialAccess: { token: string | null; invalidLink: boolean } }) {
  const [token, setToken] = useState(initialAccess.token);
  const [accessError, setAccessError] = useState(initialAccess.invalidLink ? 'Bu erişim bağlantısı eksik veya geçersiz. Özel bağlantının tamamını yeniden aç.' : '');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [pollError, setPollError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('text');
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<Duration>(5);
  const [resolution, setResolution] = useState<Resolution>('480P');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [upload, setUpload] = useState<{ id: string; preview: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [recovery, setRecovery] = useState<GenerationAttempt | null>(null);
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({});
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  const uploadSequence = useRef(0);
  const previewRef = useRef<string | null>(null);
  const submissionLock = useRef(false);

  const clearAccess = useCallback((message = '') => {
    forgetAccess(); setToken(null); setWorkspace(null); setSettingsOpen(false); setAccessError(message);
    setPrompt(''); setUpload(null); setUploadError(''); setSubmitError(''); setSubmitSuccess(false); setRecovery(null);
    uploadController.current?.abort(); uploadSequence.current++;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
  }, []);

  const handleAuthFailure = useCallback((error: unknown): boolean => {
    if (error instanceof ApiError && error.status === 401) { clearAccess('Erişim kodun doğrulanamadı. Özel bağlantını yeniden aç.'); return true; }
    return false;
  }, [clearAccess]);

  const loadWorkspace = useCallback(async (signal?: AbortSignal) => {
    if (!API_BASE || !token) return;
    setLoading(true); setWorkspaceError('');
    try {
      const data = await apiRequest<Workspace>(API_BASE, token, '/workspace', { signal });
      if (signal?.aborted) return;
      if (!Array.isArray(data.jobs)) throw new ApiError('Stüdyo bilgileri alınamadı. Lütfen yeniden dene.');
      setWorkspace(current => ({ ...data, jobs: data.jobs.reduce(mergeJob, current?.jobs || []) }));
      setPollError('');
    } catch (error) { if (!signal?.aborted && !handleAuthFailure(error)) setWorkspaceError(errorText(error)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [token, handleAuthFailure]);

  useEffect(() => { const controller = new AbortController(); void loadWorkspace(controller.signal); return () => controller.abort(); }, [loadWorkspace]);
  useEffect(() => () => { uploadController.current?.abort(); if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  const pollingIds = workspace?.jobs.filter(isPollingJob).map(job => job.id).sort().join(',') || '';
  useEffect(() => {
    if (!API_BASE || !token || !pollingIds) return;
    const controller = new AbortController();
    let busy = false;
    const poll = async () => {
      if (document.hidden || busy || controller.signal.aborted) return;
      busy = true;
      try {
        const results = await Promise.allSettled(pollingIds.split(',').map(id => apiRequest<{ job: Job }>(API_BASE, token, `/jobs/${encodeURIComponent(id)}`, { signal: controller.signal })));
        if (controller.signal.aborted) return;
        let problem = '';
        const incoming: Job[] = [];
        for (const result of results) {
          if (result.status === 'fulfilled') incoming.push(result.value.job);
          else if (handleAuthFailure(result.reason)) return;
          else problem = 'Durumlar şu an yenilenemiyor. Bağlantı geldiğinde otomatik olarak tekrar kontrol edilecek.';
        }
        if (incoming.length) setWorkspace(current => current ? { ...current, jobs: incoming.reduce(mergeJob, current.jobs) } : current);
        setPollError(problem);
      } finally { busy = false; }
    };
    const interval = window.setInterval(() => void poll(), 5000);
    const onVisibility = () => { if (!document.hidden) void poll(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearInterval(interval); controller.abort(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [token, pollingIds, handleAuthFailure]);

  const refreshJob = async (id: string) => {
    if (!API_BASE || !token || checking[id]) return;
    setChecking(current => ({ ...current, [id]: true })); setCheckErrors(current => ({ ...current, [id]: '' }));
    try {
      const data = await apiRequest<{ job: Job }>(API_BASE, token, `/jobs/${encodeURIComponent(id)}`);
      setWorkspace(current => current ? { ...current, jobs: mergeJob(current.jobs, data.job) } : current);
    } catch (error) { if (!handleAuthFailure(error)) setCheckErrors(current => ({ ...current, [id]: errorText(error) })); }
    finally { setChecking(current => ({ ...current, [id]: false })); }
  };

  const saveProvider = async (apiKey: string) => {
    if (!API_BASE || !token) return;
    try {
      const result = await apiRequest<{ configured: boolean; keySuffix: string }>(API_BASE, token, '/provider', jsonRequest({ apiKey }));
      setWorkspace(current => current ? { ...current, providerConfigured: result.configured, keySuffix: result.keySuffix } : current);
    } catch (error) { handleAuthFailure(error); throw error; }
  };
  const removeProvider = async () => {
    if (!API_BASE || !token) return;
    try { await apiRequest(API_BASE, token, '/provider', { method: 'DELETE' }); setWorkspace(current => current ? { ...current, providerConfigured: false, keySuffix: undefined } : current); }
    catch (error) { handleAuthFailure(error); throw error; }
  };

  const clearImage = () => {
    uploadSequence.current++; uploadController.current?.abort(); setUpload(null); setUploading(false); setUploadError('');
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    if (fileRef.current) fileRef.current.value = '';
  };
  const selectImage = async (file: File | undefined) => {
    if (!file || !API_BASE || !token) return;
    clearImage();
    const sequence = uploadSequence.current;
    const controller = new AbortController(); uploadController.current = controller;
    setUploading(true);
    let preview: string | null = null;
    try {
      const blob = await prepareImage(file, Math.min(workspace?.limits.maxImageBytes || 8388608, 8388608));
      if (controller.signal.aborted || sequence !== uploadSequence.current) return;
      preview = URL.createObjectURL(blob); previewRef.current = preview;
      setUpload({ id: '', preview, name: file.name });
      const data = await apiRequest<{ id: string; previewUrl: string }>(API_BASE, token, '/upload', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob, signal: controller.signal }, 120000);
      if (!controller.signal.aborted && sequence === uploadSequence.current) setUpload({ id: data.id, preview, name: file.name });
    } catch (error) { if (!controller.signal.aborted && sequence === uploadSequence.current && !handleAuthFailure(error)) { setUploadError(errorText(error)); setUpload(null); if (preview) URL.revokeObjectURL(preview); previewRef.current = null; } }
    finally { if (sequence === uploadSequence.current) setUploading(false); }
  };

  const performSubmission = async (attempt: GenerationAttempt) => {
    if (!API_BASE || !token || submissionLock.current) return;
    submissionLock.current = true; setSubmitting(true); setSubmitError(''); setSubmitSuccess(false);
    try {
      const data = await apiRequest<{ job: Job }>(API_BASE, token, '/jobs', jsonRequest({ ...attempt.input, idempotencyKey: attempt.idempotencyKey }));
      setWorkspace(current => current ? { ...current, jobs: mergeJob(current.jobs, data.job) } : current);
      setRecovery(null); setSubmitSuccess(true);
    } catch (error) {
      if (!handleAuthFailure(error)) {
        setSubmitError(errorText(error));
        const explicitlyRejected = error instanceof ApiError && [400, 402, 403, 404, 422].includes(error.status);
        setRecovery(explicitlyRejected ? null : attempt);
      }
    } finally { submissionLock.current = false; setSubmitting(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (recovery) { void performSubmission(recovery); return; }
    const input: GenerationInput = { mode, prompt: prompt.trim(), duration, resolution, aspectRatio, ...(mode === 'image' ? { imageId: upload?.id } : {}) };
    const error = validateGeneration(input);
    if (error) { setSubmitError(error); return; }
    if (!workspace?.providerConfigured) { setSettingsOpen(true); return; }
    if (workspace.jobs.filter(isUnfinishedJob).length >= workspace.limits.maxConcurrent) { setSubmitError('Devam eden işlemlerinden biri tamamlandığında yeni video oluşturabilirsin.'); return; }
    void performSubmission({ input, idempotencyKey: crypto.randomUUID() });
  };

  const focusComposer = () => { document.getElementById('create')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); promptRef.current?.focus({ preventScroll: true }); };
  const onAccess = (code: string) => { rememberAccess(code); setAccessError(''); setToken(code); };
  if (!API_BASE || !token) return <AccessGate onAccess={onAccess} error={accessError} configured={Boolean(API_BASE)} />;

  const activeCount = workspace?.jobs.filter(isUnfinishedJob).length || 0;
  const completedCount = workspace?.jobs.filter(job => job.status === 'completed').length || 0;
  const estimate = estimateCost(resolution, duration, workspace?.pricing.rates);
  const editingDisabled = submitting || Boolean(recovery);
  const atCapacity = Boolean(workspace && activeCount >= workspace.limits.maxConcurrent);

  return <div className="app-shell" id="studio">
    <header className="topbar"><Brand /><nav aria-label="Stüdyo menüsü"><a className="gallery-nav" href="#videos"><Film size={17} aria-hidden="true" /><span>Videolarım</span></a><button className="settings-button" type="button" onClick={() => setSettingsOpen(true)} disabled={!workspace} aria-label="Stüdyo ayarlarını aç"><Settings2 size={18} /><span>Ayarlar</span></button></nav></header>
    {!workspace ? <main className="loading-main">{loading ? <div className="loading-card" role="status"><span className="spin"><LoaderCircle size={28} /></span><h1>Stüdyon açılıyor.</h1><p>Videoların ve ayarların yükleniyor.</p></div> : <div className="loading-card"><CircleAlert size={30} /><h1>Stüdyoya bağlanamadık.</h1><Notice>{workspaceError || 'Bağlantını kontrol ederek yeniden dene.'}</Notice><button className="button primary" onClick={() => void loadWorkspace()} type="button"><RefreshCw size={17} /> Yeniden dene</button><button className="text-button" onClick={() => clearAccess()} type="button">Erişim kodunu değiştir</button></div>}</main> : <main>
      <section className="hero" aria-labelledby="hero-title"><div><div className="hero-kicker"><span /> SANA ÖZEL YARATICI ALAN</div><h1 id="hero-title">Bir fikir.<br /><span>Hareketli bir hikâye.</span></h1><p>Kelimelerle başla. Bir fotoğrafa hareket kat.<br />Sıradaki sahne senin.</p></div><div className="hero-note"><span className="hero-note-icon"><Sparkles size={23} strokeWidth={1.5} aria-hidden="true" /></span><span>Yönetmen koltuğu<br /><strong>bu kez senin.</strong></span><div className="note-meta"><span>MiniMax H3 Max</span><span>5–15 sn</span></div></div></section>
      {workspaceError ? <Notice>{workspaceError}</Notice> : null}
      <div className="studio-grid">
        <section className="composer panel" id="create" aria-labelledby="create-title">
          <div className="section-heading"><div className="heading-with-number"><span className="section-number">01</span><h2 id="create-title">Yeni video</h2></div><span className="micro-label">HAYAL ET. OLUŞTUR.</span></div>
          {!workspace.providerConfigured ? <button className="connect-callout" type="button" onClick={() => setSettingsOpen(true)}><span className="connect-icon"><KeyRound size={18} aria-hidden="true" /></span><span><strong>Üretime bir adım kaldı</strong><small>fal.ai anahtarını bağlayarak başla</small></span><ArrowUpRight size={18} aria-hidden="true" /></button> : <div className="connected-line"><span /><span>fal.ai bağlı</span><span className="connected-model">MiniMax H3 Max</span></div>}
          <form onSubmit={submit}>
            <fieldset disabled={editingDisabled} className="generation-fields">
              <legend className="sr-only">Video ayarları</legend>
              <div className="mode-tabs" role="group" aria-label="Video başlangıç türü"><button type="button" aria-pressed={mode === 'text'} onClick={() => setMode('text')} className={mode === 'text' ? 'selected' : ''}><Type size={18} aria-hidden="true" /> Metinden video</button><button type="button" aria-pressed={mode === 'image'} onClick={() => setMode('image')} className={mode === 'image' ? 'selected' : ''}><ImagePlus size={18} aria-hidden="true" /> Görselden video</button></div>
              {mode === 'image' ? <div className="image-field"><div className="field-heading"><label htmlFor="reference-image">Başlangıç fotoğrafı</label><span>En fazla 8 MB</span></div><input ref={fileRef} id="reference-image" className="sr-only" type="file" accept="image/*" onChange={event => void selectImage(event.target.files?.[0])} tabIndex={-1} />
                {upload ? <div className="image-preview"><img src={upload.preview} alt="Video için seçilen başlangıç karesi" /><div className="image-preview-footer"><span>{uploading ? <span className="spin"><LoaderCircle size={15} /></span> : <CheckCircle2 size={15} aria-hidden="true" />}{uploading ? 'Fotoğraf yükleniyor…' : 'Fotoğraf hazır'}</span><button type="button" className="icon-button" onClick={clearImage} aria-label="Seçilen fotoğrafı kaldır"><X size={18} /></button></div></div>
                  : <button className="upload-dropzone" type="button" onClick={() => fileRef.current?.click()} disabled={uploading}><span className="upload-icon">{uploading ? <span className="spin"><LoaderCircle size={24} /></span> : <Upload size={24} strokeWidth={1.5} aria-hidden="true" />}</span><strong>{uploading ? 'Fotoğraf hazırlanıyor…' : 'Bir fotoğraf seç'}</strong><span>Fotoğraf arşivinden veya kamerandan</span><small>JPEG, PNG, WebP · Büyük fotoğraflar küçültülür</small></button>}
                {uploadError ? <Notice>{uploadError}</Notice> : null}
                <p className="field-hint">Fotoğrafın kadrajı korunur. Yükleme video üretimini başlatmaz.</p>
              </div> : null}
              <div className="prompt-field"><div className="field-heading"><label htmlFor="video-prompt">{mode === 'image' ? 'Fotoğraf nasıl hareket etsin?' : 'Nasıl bir sahne hayal ediyorsun?'}</label><button className="sample-button" type="button" onClick={() => { setPrompt(SAMPLE_PROMPTS[mode]); promptRef.current?.focus(); }}><Sparkles size={13} aria-hidden="true" /> Örnek ekle</button></div><textarea ref={promptRef} id="video-prompt" value={prompt} onChange={event => { setPrompt(event.target.value); setSubmitSuccess(false); }} maxLength={MAX_PROMPT_LENGTH} rows={5} placeholder={mode === 'text' ? 'Sahneni, kameranın hareketini ve atmosferi anlat…' : 'Yüz ifadesi, hareket, kamera ve ışık…'} aria-describedby="prompt-help" /><div className="prompt-bottom"><span id="prompt-help">Biraz detay, daha iyi bir sahne.</span><span>{prompt.length.toLocaleString('tr-TR')} / 5.000</span></div></div>
              <div className="settings-grid"><div><label htmlFor="duration">Süre</label><select id="duration" value={duration} onChange={event => setDuration(Number(event.target.value) as Duration)}><option value={5}>5 saniye</option><option value={10}>10 saniye</option><option value={15}>15 saniye</option></select></div><div><label htmlFor="resolution">Çözünürlük</label><select id="resolution" value={resolution} onChange={event => setResolution(event.target.value as Resolution)}><option value="480P">480p</option><option value="768P">768p</option><option value="1080P">1080p</option></select></div><div><label htmlFor="aspect-ratio">Kadraj</label><select id="aspect-ratio" value={aspectRatio} onChange={event => setAspectRatio(event.target.value as AspectRatio)} disabled={mode === 'image'} aria-describedby={mode === 'image' ? 'image-ratio-help' : undefined}><option value="9:16">9:16 · Dikey</option><option value="16:9">16:9 · Yatay</option><option value="1:1">1:1 · Kare</option></select></div></div>
              {mode === 'image' ? <p id="image-ratio-help" className="field-hint ratio-hint">Görselden videoda kadraj seçilen fotoğraftan alınır.</p> : null}
            </fieldset>
            <div className="cost-summary"><div><span>Tahmini üretim ücreti</span><small>{duration} saniye · {resolution.toLowerCase()}</small></div><strong>{formatCost(estimate)}<span>USD</span></strong></div>
            <p className="billing-note">Tahmini tutardır. Son ücret fal.ai tarafından belirlenir ve kendi hesabından düşülür.</p>
            {submitError ? <Notice>{submitError}</Notice> : null}
            {recovery ? <Notice tone="info"><strong>Yeni bir üretim başlatılmayacak.</strong><p>Aynı isteği yeniden kontrol ederek mevcut gönderimin sonucunu alabilirsin. Ayarların bu sırada korunur.</p></Notice> : null}
            {submitSuccess ? <Notice tone="success">İsteğin videolarına eklendi. <a href="#videos">Durumunu gör <ArrowDown size={13} aria-hidden="true" /></a></Notice> : null}
            <button className="button primary generate-button" type="submit" disabled={submitting || uploading || (!recovery && (!workspace.providerConfigured || atCapacity || !prompt.trim() || (mode === 'image' && !upload?.id)))}>{submitting ? <span className="spin"><LoaderCircle size={19} /></span> : recovery ? <RefreshCw size={18} aria-hidden="true" /> : <Sparkles size={19} aria-hidden="true" />}{submitting ? 'İsteğin gönderiliyor…' : recovery ? 'Aynı gönderimi kontrol et' : 'Ücretli video oluştur'}{!submitting && !recovery ? <ArrowUpRight size={19} aria-hidden="true" /> : null}</button>
            <p className="submit-footnote">{atCapacity ? `Aynı anda en fazla ${workspace.limits.maxConcurrent} işlem. Yeni video için süren işlemini bekle.` : <><LockKeyhole size={12} aria-hidden="true" /> Yalnızca düğmeye bastığında üretim başlar.</>}</p>
          </form>
        </section>
        <section className="gallery-section" id="videos" aria-labelledby="videos-title">
          <div className="gallery-heading"><div><div className="heading-with-number"><span className="section-number">02</span><h2 id="videos-title">Videoların</h2></div><p>{workspace.jobs.length ? `${completedCount} hazır${activeCount ? ` · ${activeCount} işlem sürüyor` : ''}` : 'Fikirlerinin hayat bulduğu yer.'}</p></div><button className="icon-button refresh-button" onClick={() => void loadWorkspace()} disabled={loading} type="button" aria-label="Videoları yenile"><span className={loading ? 'spin' : ''}><RefreshCw size={18} /></span></button></div>
          {pollError ? <Notice tone="info">{pollError}</Notice> : null}
          {workspace.jobs.length ? <div className="jobs-grid">{workspace.jobs.map(job => <JobCard key={job.id} job={job} onRefresh={() => void refreshJob(job.id)} checking={Boolean(checking[job.id])} checkError={checkErrors[job.id]} reuseDisabled={editingDisabled} onReuse={() => { if (editingDisabled) return; setPrompt(job.prompt.slice(0, MAX_PROMPT_LENGTH)); setSubmitSuccess(false); focusComposer(); }} />)}</div> : <div className="empty-gallery"><div className="empty-frames" aria-hidden="true"><span /><div><Film size={39} strokeWidth={1.2} /></div></div><span className="eyebrow">HENÜZ İLK SAHNEDESİN</span><h3>Burada güzel şeyler<br />birikecek.</h3><p>İlk videonu oluşturduğunda burada<br />izleyebilir, açabilir ve indirebilirsin.</p><button className="button secondary" type="button" onClick={focusComposer}><Plus size={16} aria-hidden="true" /> İlk sahnemi oluştur</button><div className="empty-footer"><Clock3 size={13} aria-hidden="true" /> Üretim geçmişin bu alanda görünür.</div></div>}
          <div className="gallery-tip"><Sparkles size={17} strokeWidth={1.5} aria-hidden="true" /><p><strong>Küçük bir yönetmen notu</strong>“Yavaşça yaklaşan kamera” gibi net hareketler ve ışık tarifleriyle başla.</p></div>
        </section>
      </div>
    </main>}
    <footer className="site-footer"><span>Bir fikirle başlar.</span><span><LockKeyhole size={12} aria-hidden="true" /> Resul Studio · Özel alanın</span></footer>
    {settingsOpen && workspace ? <ProviderSettings workspace={workspace} onClose={() => setSettingsOpen(false)} onSave={saveProvider} onRemove={removeProvider} onForget={() => clearAccess()} /> : null}
  </div>;
}
