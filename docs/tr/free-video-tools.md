# Resul Studio: ücretsiz video araçları

`/free` bölümü özel çalışma alanından bağımsız açılır. Wan VACE ve HunyuanVideo
araçları, kullanıcı açmayı seçtiğinde sağlayıcının gerçek arayüzü olarak sayfaya
yüklenir. Vidu kendi sitesinde açılır. Bu bölüm kendi GPU sunucumuz değildir;
model erişimi, ücretsiz kota ve üretim sırası ilgili hizmet tarafından yönetilir.

## Araçlar

| Araç | Giriş | Kullanım sınırı |
| --- | --- | --- |
| Wan2.1 VACE 14B Fast | Reference modunda birden çok görsel; beş görsel birlikte kullanılabilir | Yaklaşık 5 saniyeye kadar, ücretsiz ZeroGPU kotası ve sıra |
| HunyuanVideo 1.5 | Bir başlangıç görseli | 480p, ücretsiz ZeroGPU kotası ve sıra |
| Vidu Reference to Video | Birden çok referans; beş görsel desteklenen aralıktadır | Hesaba bağlı ücretsiz kredi; ücretsiz çıktı kişisel kullanım içindir |

Wan VACE için ilk denemede `Reference`, 5 saniye, 6 adım ve kapalı
`Remove Background` ayarları önerilir. Görsel benzerliği ve çıktı kalitesi
üretilen sonuç üzerinde değerlendirilmelidir; bu arayüz belirli bir kalite veya
ücretsiz üretim adedi garanti etmez.

## iPhone

Araç içindeki dosya seçiciye görseller yüklenir. Giriş, indirme veya yükleme
gömülü araçta çalışmazsa aynı sağlayıcının tam sayfa bağlantısı kullanılır.
Sekmeyi kapatmak sağlayıcının sunucusundaki üretimi iptal etmez. Ücretsiz kota
dolduğunda hizmetin sıfırlanma süresi beklenir; uygulama ücretli bir API'ye geçmez.

## Gizlilik ve uygulama sınırı

- Ücretsiz bölüm `App` bileşenini başlatmaz; Supabase çalışma alanını yüklemez ve
  fal.ai üretim uçlarına istek göndermez.
- Özel erişim URL parçacığı, herhangi bir arayüz oluşturulmadan önce kaldırılır.
  Erişim kodu veya sağlayıcı anahtarı gömülü araçlara aktarılmaz.
- Sağlayıcı adresleri sabittir. URL sorgusu veya özel çalışma alanı verisi iframe
  adresine eklenmez. Yönlendiren sayfa bilgisi gönderilmez.
- CSP `frame-src` yalnızca seçilen iki Hugging Face Space kökenine izin verir.
  Gömülü araç üst pencereyi yönlendiremez; dosya seçimi ve indirme kullanıcı
  tarafından sağlayıcı arayüzünde yapılır.
- Görseller ve ücretsiz üretim sonuçları seçilen sağlayıcıda işlenir. Özel
  Supabase galerisine otomatik kaydedilmez; uygulama bunları hazır video olarak
  göstermez.
- Araçlar açılırken üretim, ödeme, abonelik veya otomatik yeniden deneme yapılmaz.

## Doğrulanan kaynaklar

Erişim koşulları 28 Ekim 2026 tarihinde kontrol edildi. Hizmetler koşullarını
veya arayüzlerini değiştirebilir.

- [VACE resmi kaynak kodu](https://github.com/ali-vilab/VACE)
- [Wan VACE çalışan demo](https://huggingface.co/spaces/linoyts/wan2-1-VACE-fast)
- [Wan VACE uygulama kodu](https://huggingface.co/spaces/linoyts/wan2-1-VACE-fast/blob/main/app.py)
- [HunyuanVideo demo](https://huggingface.co/spaces/multimodalart/Hunyuan-Video-1-5)
- [ZeroGPU kullanım ve kota bilgileri](https://huggingface.co/docs/hub/en/spaces-zerogpu)
- [Hugging Face gömme belgeleri](https://huggingface.co/docs/hub/en/spaces-embed)
- [Vidu referansla video](https://www.vidu.com/ai-reference-to-video)
- [Vidu ücretsiz kullanım sınırları](https://www.vidu.com/blog/free-ai-animation)
