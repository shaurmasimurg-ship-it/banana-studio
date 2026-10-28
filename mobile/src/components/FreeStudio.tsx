import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUpRight, Check, ChevronRight, CircleAlert, Clock3, Film, Globe2, ImagePlus, Images, Layers3, LoaderCircle, LockKeyhole, Sparkles } from 'lucide-react';
import '../styles/free-studio.css';

type EmbeddedToolId = 'wan-vace' | 'hunyuan';

const EMBEDDED_TOOLS: Record<EmbeddedToolId, { name: string; url: string; embedUrl: string; description: string }> = {
  'wan-vace': {
    name: 'Wan VACE',
    url: 'https://huggingface.co/spaces/linoyts/wan2-1-VACE-fast',
    embedUrl: 'https://linoyts-wan2-1-vace-fast.hf.space',
    description: 'Beş görseli tek videoda referans olarak kullan.',
  },
  hunyuan: {
    name: 'HunyuanVideo 1.5',
    url: 'https://huggingface.co/spaces/multimodalart/Hunyuan-Video-1-5',
    embedUrl: 'https://multimodalart-hunyuan-video-1-5.hf.space',
    description: 'Bir fotoğraftan 480p video oluştur.',
  },
};

const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox';
const VIDU_URL = 'https://www.vidu.com/ai-reference-to-video';

function PrivateStudioLink({ onOpenPrivate }: { onOpenPrivate?: () => void }) {
  const content = <><LockKeyhole size={15} aria-hidden="true" /><span>Özel stüdyo</span><ChevronRight size={15} aria-hidden="true" /></>;
  return onOpenPrivate
    ? <button className="free-private-link" type="button" onClick={onOpenPrivate}>{content}</button>
    : <a className="free-private-link" href="/">{content}</a>;
}

function ExternalLink({ href, children, className = '' }: { href: string; children: React.ReactNode; className?: string }) {
  return <a className={className} href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}<ArrowUpRight size={16} aria-hidden="true" /></a>;
}

function WanGuide() {
  return <div className="free-tool-guide">
    <div className="free-guide-heading"><span className="free-step-label">KISA REHBER</span><h3>Beş görsel, tek sahne.</h3></div>
    <ol className="free-guide-steps">
      <li><span>1</span><p><strong>Reference</strong> modunu seç.<small>Beş görsel için ilk ve son kare modunu kullanma.</small></p></li>
      <li><span>2</span><p><strong>Beş görseli yükle.</strong><small>Aracın görsel alanından fotoğraflarını ekle.</small></p></li>
      <li><span>3</span><p><strong>Sahneyi tarif et.</strong><small>Prompt alanında özneyi, hareketi ve kamerayı anlat.</small></p></li>
      <li><span>4</span><p><strong>Generate Video</strong> ile başlat.<small>Video hazır olduğunda aracın içinden indir.</small></p></li>
    </ol>
    <div className="free-recommended-settings" aria-label="Önerilen başlangıç ayarları">
      <span><Clock3 size={14} aria-hidden="true" /> Duration <strong>5 sn</strong></span>
      <span><Layers3 size={14} aria-hidden="true" /> Inference Steps <strong>6</strong></span>
      <span>Remove Background <strong>Kapalı</strong></span>
    </div>
  </div>;
}

function HunyuanGuide() {
  return <div className="free-tool-guide">
    <div className="free-guide-heading"><span className="free-step-label">KISA REHBER</span><h3>Bir fotoğrafa hareket kat.</h3></div>
    <ol className="free-guide-steps free-guide-three">
      <li><span>1</span><p><strong>Bir görsel yükle.</strong><small>Bu araç aynı anda beş referans kullanmaz.</small></p></li>
      <li><span>2</span><p><strong>Hareketi tarif et.</strong><small>Öznenin ve kameranın nasıl hareket edeceğini yaz.</small></p></li>
      <li><span>3</span><p><strong>Üret ve indir.</strong><small>480p çıktını aracın indirme seçeneğiyle kaydet.</small></p></li>
    </ol>
  </div>;
}

/** Public tools hub. It never receives the private studio token or calls its API. */
export function FreeStudio({ onOpenPrivate }: { onOpenPrivate?: () => void }) {
  const [selectedTool, setSelectedTool] = useState<EmbeddedToolId | null>(null);
  const [openedTools, setOpenedTools] = useState<EmbeddedToolId[]>([]);
  const [loadedFrames, setLoadedFrames] = useState<Partial<Record<EmbeddedToolId, boolean>>>({});
  const workspaceRef = useRef<HTMLElement>(null);
  const workspaceHeadingRef = useRef<HTMLHeadingElement>(null);
  const cardsRef = useRef<HTMLElement>(null);

  const openTool = (id: EmbeddedToolId) => {
    setOpenedTools(current => current.includes(id) ? current : [...current, id]);
    if (id === selectedTool) {
      workspaceHeadingRef.current?.focus({ preventScroll: true });
      workspaceRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    setSelectedTool(id);
  };

  useEffect(() => {
    if (!selectedTool) return;
    const frame = window.requestAnimationFrame(() => {
      workspaceHeadingRef.current?.focus({ preventScroll: true });
      workspaceRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedTool]);

  const returnToTools = () => {
    setSelectedTool(null);
    cardsRef.current?.focus({ preventScroll: true });
    cardsRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  const currentTool = selectedTool ? EMBEDDED_TOOLS[selectedTool] : null;

  return <div className="free-studio-shell">
    <header className="topbar free-topbar">
      <a className="brand" href="/free" aria-label="Resul Studio ücretsiz araçlar ana ekran">
        <img src="/icon.svg" alt="" width="42" height="42" />
        <span>Resul<span className="brand-light"> Studio</span><small>FİKİRLERİN HAREKETE GEÇSİN</small></span>
      </a>
      <PrivateStudioLink onOpenPrivate={onOpenPrivate} />
    </header>

    <main>
      <section className="free-hero" aria-labelledby="free-title">
        <div className="free-hero-copy">
          <span className="free-eyebrow"><span /> ÜCRETSİZ ARAÇLAR</span>
          <h1 id="free-title">Görsellerini seç.<br /><span>Hikâyeni hareketlendir.</span></h1>
          <p>Beş görselden bir sahne, bir fotoğraftan yeni bir an.<br className="desktop-break" /> Ücretsiz denemeye uygun video araçları burada.</p>
          <a className="free-hero-anchor" href="#free-tools">Bir araç seç <ArrowDown size={17} aria-hidden="true" /></a>
        </div>
        <div className="free-hero-art" aria-hidden="true">
          <div className="free-image-stack">
            {[1, 2, 3, 4, 5].map(number => <div className={`free-art-card free-art-card-${number}`} key={number}><span>0{number}</span><ImagePlus size={25} strokeWidth={1.25} /></div>)}
            <div className="free-art-result"><Film size={25} strokeWidth={1.45} /><span>Tek video</span><i /></div>
          </div>
          <span className="free-art-caption">REFERANSLARINDAN YENİ BİR SAHNE</span>
        </div>
      </section>

      <div className="free-plan-note">
        <Sparkles size={19} aria-hidden="true" />
        <p><strong>Önce ücretsiz hakkını kullan.</strong> Hugging Face araçları günlük GPU kotasıyla, Vidu ise hesabındaki deneme kredileriyle çalışır. Kota ve sıra durumu hizmete göre değişir.</p>
      </div>

      <section className="free-tools-section" id="free-tools" ref={cardsRef} tabIndex={-1} aria-labelledby="free-tools-heading">
        <div className="free-section-heading"><div><span className="free-step-label">01 / ARACINI SEÇ</span><h2 id="free-tools-heading">Nasıl bir video hazırlayalım?</h2></div><span className="free-tool-count">3 seçenek</span></div>

        <div className="free-tools-grid">
          <article className={`free-tool-card free-tool-featured ${selectedTool === 'wan-vace' ? 'free-tool-selected' : ''}`}>
            <div className="free-card-heading"><span className="free-tool-symbol free-symbol-wan"><Images size={26} strokeWidth={1.5} aria-hidden="true" /></span><span className="free-recommend-badge"><Sparkles size={12} aria-hidden="true" /> İLK SEÇİM</span></div>
            <p className="free-card-kicker">BİRDEN FAZLA GÖRSELDEN</p>
            <h3>Wan VACE</h3>
            <p className="free-card-description">Kişi, ürün ve mekân referanslarını aynı videoda kullan. Beş görselli ilk denemen için.</p>
            <div className="free-tool-specs"><span><Images size={14} aria-hidden="true" /><strong>5 görsel</strong> bir arada</span><span><Clock3 size={14} aria-hidden="true" /> Yaklaşık 5 sn</span></div>
            <div className="free-credit-line"><Check size={15} aria-hidden="true" /><span>Ücretsiz GPU kotası · sıra olabilir</span></div>
            <button className="button primary free-open-button" type="button" onClick={() => openTool('wan-vace')} aria-controls="free-tool-workspace" aria-expanded={selectedTool === 'wan-vace'}>{openedTools.includes('wan-vace') ? 'Wan VACE’ye dön' : 'Aracı burada aç'}<ArrowDown size={17} aria-hidden="true" /></button>
            <ExternalLink href={EMBEDDED_TOOLS['wan-vace'].url} className="free-card-external">Ayrı sekmede aç</ExternalLink>
            <p className="free-model-note">Wan2.1 VACE 14B · Hugging Face demosu</p>
          </article>

          <article className={`free-tool-card ${selectedTool === 'hunyuan' ? 'free-tool-selected' : ''}`}>
            <div className="free-card-heading"><span className="free-tool-symbol"><ImagePlus size={26} strokeWidth={1.5} aria-hidden="true" /></span><span className="free-type-badge">TEK FOTOĞRAF</span></div>
            <p className="free-card-kicker">BİR GÖRSELDEN</p>
            <h3>HunyuanVideo <span>1.5</span></h3>
            <p className="free-card-description">Tek fotoğrafın için hareket, kamera ve atmosfer tarif et. Kısa sahnelerle denemeye başla.</p>
            <div className="free-tool-specs"><span><ImagePlus size={14} aria-hidden="true" /><strong>1 görsel</strong></span><span>480p çıktı</span></div>
            <div className="free-credit-line"><Check size={15} aria-hidden="true" /><span>Ücretsiz GPU kotası · sıra olabilir</span></div>
            <button className="button secondary free-open-button" type="button" onClick={() => openTool('hunyuan')} aria-controls="free-tool-workspace" aria-expanded={selectedTool === 'hunyuan'}>{openedTools.includes('hunyuan') ? 'HunyuanVideo’ya dön' : 'Aracı burada aç'}<ArrowDown size={17} aria-hidden="true" /></button>
            <ExternalLink href={EMBEDDED_TOOLS.hunyuan.url} className="free-card-external">Ayrı sekmede aç</ExternalLink>
            <p className="free-model-note">HunyuanVideo 1.5 · Hugging Face demosu</p>
          </article>

          <article className="free-tool-card free-tool-vidu">
            <div className="free-card-heading"><span className="free-tool-symbol"><Layers3 size={26} strokeWidth={1.5} aria-hidden="true" /></span><span className="free-type-badge">DENEME KREDİSİ</span></div>
            <p className="free-card-kicker">ÇOKLU REFERANSLA</p>
            <h3>Vidu</h3>
            <p className="free-card-description">Karakter, kıyafet ve sahne referanslarıyla video dene. Ücretsiz hakkını kendi hesabında kontrol et.</p>
            <div className="free-tool-specs"><span><Images size={14} aria-hidden="true" /><strong>5 görsel</strong> desteği</span><span>1–7 referans</span></div>
            <div className="free-credit-line free-credit-conditional"><CircleAlert size={15} aria-hidden="true" /><span>Ücretsiz kredi miktarı hesaba bağlı</span></div>
            <ExternalLink href={VIDU_URL} className="button secondary free-open-button">Vidu’da aç</ExternalLink>
            <div className="free-vidu-limit"><CircleAlert size={14} aria-hidden="true" /><p>Ücretsiz çıktı kişisel kullanım içindir. Ticari reklamda kullanma.</p></div>
            <p className="free-model-note">Vidu’nun kendi sitesinde açılır</p>
          </article>
        </div>
      </section>

      <section className="free-tool-workspace" id="free-tool-workspace" ref={workspaceRef} aria-labelledby="free-workspace-title" hidden={!selectedTool}>
        {currentTool ? <>
          <div className="free-workspace-heading"><div><span className="free-step-label">02 / VİDEONU HAZIRLA</span><h2 id="free-workspace-title" ref={workspaceHeadingRef} tabIndex={-1}>{currentTool.name}</h2><p>{currentTool.description}</p></div><button className="free-return-button" type="button" onClick={returnToTools}><ArrowLeft size={16} aria-hidden="true" /> Araçlara dön</button></div>
          {selectedTool === 'wan-vace' ? <WanGuide /> : <HunyuanGuide />}
          <div className="free-frame-help"><div><Globe2 size={19} aria-hidden="true" /><p><strong>Aşağıda Hugging Face’in kendi arayüzü açılır.</strong> Görsellerini oraya yükle. Ekran boşsa veya giriş istenirse ayrı sekmede devam et.</p></div><ExternalLink href={currentTool.url} className="button secondary small">Ayrı sekmede aç</ExternalLink></div>
        </> : null}
        {openedTools.map(id => <div className="free-embedded-tool" key={id} hidden={selectedTool !== id}>
          {!loadedFrames[id] ? <p className="free-frame-loading" role="status"><LoaderCircle size={17} className="spin" aria-hidden="true" /> Araç sayfası yükleniyor…</p> : null}
          <iframe
            src={EMBEDDED_TOOLS[id].embedUrl}
            title={`${EMBEDDED_TOOLS[id].name} video oluşturma aracı — Hugging Face`}
            className="free-tool-frame"
            sandbox={EMBED_SANDBOX}
            referrerPolicy="no-referrer"
            allow="fullscreen"
            onLoad={() => setLoadedFrames(current => ({ ...current, [id]: true }))}
          />
        </div>)}
        {currentTool ? <p className="free-provider-note"><Clock3 size={15} aria-hidden="true" /> Üretim süresi ve ücretsiz kota Hugging Face tarafından belirlenir. Aynı isteği art arda gönderme; araçtaki sıra ve sonuç durumunu takip et.</p> : null}
      </section>

      <section className="free-how-it-works" aria-labelledby="free-about-heading">
        <div className="free-about-icon"><Film size={22} strokeWidth={1.6} aria-hidden="true" /></div>
        <div><h2 id="free-about-heading">Videon nerede kaydedilir?</h2><p>Görsellerin ve üretimlerin seçtiğin hizmette işlenir. Hazır videoyu o aracın indirme düğmesiyle cihazına kaydet. Bu araçlardaki videolar özel stüdyo galerine otomatik eklenmez.</p></div>
      </section>

      <details className="free-details">
        <summary><span>Ücretsiz kullanım hakkında</span><ChevronRight size={18} aria-hidden="true" /></summary>
        <div className="free-details-content">
          <p>Wan VACE ve HunyuanVideo demoları ortak GPU kaynaklarını kullanır. Günlük kullanım hakkı dolduğunda veya yoğunluk olduğunda daha sonra yeniden deneyebilirsin. Hizmet kendi hesabına giriş yapmanı isteyebilir.</p>
          <p>Vidu’da ücretsiz deneme kredilerini ve üretim ücretini kendi hesabında kontrol et. Ücretsiz devam etmek için üretim tutarının mevcut ücretsiz hakkın içinde kaldığından emin ol.</p>
          <p>Sonuçların kalitesi görsellere ve sahne açıklamana bağlıdır. Kişinin görünümünü, kıyafeti ve ürün ayrıntılarını videoyu kullanmadan önce kontrol et.</p>
          <div className="free-source-links"><ExternalLink href="https://github.com/ali-vilab/VACE">VACE kaynak kodu</ExternalLink><ExternalLink href="https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5">HunyuanVideo kaynak kodu</ExternalLink><ExternalLink href="https://huggingface.co/docs/hub/en/spaces-zerogpu">Hugging Face ücretsiz kota</ExternalLink><ExternalLink href="https://www.vidu.com/blog/free-ai-animation">Vidu ücretsiz kullanım</ExternalLink></div>
        </div>
      </details>
    </main>

    <footer className="site-footer free-site-footer"><span>Bir fikirle başlar.</span><span>Resul Studio · Ücretsiz araçlar</span></footer>
  </div>;
}

export default FreeStudio;
