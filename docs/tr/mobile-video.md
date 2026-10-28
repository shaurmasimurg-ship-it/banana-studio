# Mobil video sürümü

Bu bağımsız arayüz, telefonda metinden video ve fotoğraftan video üretmek için
hazırlanmıştır. `mobile/` statik Vite uygulaması Vercel Hobby üzerinde, sunucu
işlemleri `supabase/functions/resul-video/` Edge Function içinde çalışır.
Video üretimi fal.ai kuyruğunda sürer; tarayıcı açıkken durum sorgulanır ve geri
dönüldüğünde aynı iş izlenir. Bu dağıtımın Vercel Cron veya Vercel Queue ihtiyacı
yoktur. Ana Banana Studio uygulamasının diğer özelliklerini yayımlamaz.

## Erişim ve anahtarlar

- Bu sürüm ayrı bir özel çalışma alanı kullanır. Rastgele üretilmiş 32 baytlık
  erişim kodunun yalnız SHA-256 özeti veritabanına kaydedilir. İlk giriş bağlantısı
  kodu URL fragment'inde taşır; tarayıcı sayfa açılırken fragment'i temizler.
  Kod yalnız Authorization başlığında gönderilir. Bu özel bağlantı paylaşılmamalıdır.
- Orijinal Banana Auth kullanıcıları ve izin listesi değiştirilmez. Yeni özel
  tablolarda RLS açıktır; anon/authenticated rolleri tablo veya RPC erişimi alamaz.
  `resul_mobile_api` security-invoker'dır ve yalnız service_role çalıştırabilir.
- fal.ai anahtarı tarayıcı deposuna, kaynak koda veya Vercel değişkenlerine
  kaydedilmez. HTTPS üzerinden Edge'e gönderilir. Ücretsiz pricing API sorgusuyla
  kontrol edildikten sonra AES-256-GCM ile şifrelenir. HKDF, çalışma ortamındaki
  server-only Supabase anahtarından ayrı amaçlı bir şifreleme anahtarı üretir;
  AAD kaydı çalışma alanına bağlar. Supabase anahtarı dışarı aktarılmaz.
- Sunucu anahtarı döndürülürse fal.ai anahtarı tekrar girilmelidir. Erişim kodunu
  iptal etmek için ilgili private çalışma alanı `active=false` yapılabilir;
  kod yenilemek için yeni rastgele kodun özeti yönetici bağlantısıyla kaydedilir.
- `verify_jwt=false` sadece bu yeni Edge Function içindir: handler'ın kendi
  kimlik doğrulaması vardır. Bu bayrağı kimlik doğrulamasını kaldırmak için kullanmayın.

## Dağıtım

1. `scripts/resul-mobile-schema.sql` SQL'ini proje yöneticisi olarak uygulayın.
   Üç private tablo ve service-role-only RPC oluşturulur. Mevcut tablolara dokunulmaz.
2. Özel `resul-mobile-media` Storage bucket'ını oluşturun. İstemci erişim politikası
   eklemeyin. Sunucu dosyaları çalışma alanı altında saklayıp süreli imzalı URL verir.
3. Yönetici bağlantısından bir çalışma alanı, rastgele UUID ve rastgele erişim
   kodunun SHA-256 özetiyle kaydedilir. Gerçek kod veya hesap ayarları Git'e yazılmaz.
4. `resul-video` Edge Function dosyalarını aynı adla yayımlayın. Standart
   `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` yalnız Edge ortamında kullanılır.
5. `mobile/` klasörünü ayrı statik proje olarak yayımlayın. Tek public build ayarı
   `VITE_MOBILE_API_URL` olup Edge Function'ın base URL'sidir. Kurulum
   `npm ci --ignore-scripts`, build `npm run build`, output `dist`, Node 24.x.
6. Özel bağlantıyı yalnız çalışma alanı sahibine verin. Sahip Ayarlar'dan kendi
   fal.ai anahtarını kaydeder ve her ücretli üretimi uygulamadaki düğmeyle başlatır.

## Üretim ve maliyet davranışı

Tek model ailesi MiniMax H3 Max'tır. Varsayılan 5 saniye, 480P ve dikey kadrajdır.
Fotoğraftan üretimde kadraj kaynak fotoğraftan gelir. Ekrandaki maliyetler yayınlanan
normal saniye ücretleriyle yaklaşık hesaplanır; promosyon, gerçek çıktı uzunluğu ve
hesap koşulları son fal.ai ücretini değiştirebilir. Barındırma hesabı yükseltilmez.
Video oluşturma ücretini fal.ai alır; ücretsiz altyapı video üretimini ücretsiz yapmaz.

Aynı istek kimliği için ikinci ücretli submit yapılmaz. Gönderimin kabul edildiği
belirsizse otomatik tekrar yapılmadan `submission_unknown` kaydedilir. Geçici
status/result hataları kabul edilmiş işi yeniden üretmez. Eşzamanlı iş sınırı 2,
bir saatlik yeni istek sınırı 12'dir. Kuyruk URL'si, model ve request ID sunucuda
doğrulanır; başka URL'ye anahtar gönderilmez.

Fotoğraf sınırı 8 MiB'dir. Tamamlanan videolar 32 MiB'ye kadar özel Storage'a
arşivlenir. Arşiv başarısızsa sağlayıcının geçici indirme bağlantısı ve uyarı
gösterilir. Free Storage ve ağ kotaları dolabilir; dosyaları zamanında indirin.

## Doğrulama

- Mobil arayüz: `cd mobile` ardından `npm test`, `npm run typecheck`, `npm run build`.
- Edge işlevi: `node --test --test-isolation=none tests/resul-mobile.test.mjs`.
- SQL: `scripts/test-resul-mobile.sql` işlemleri rollback içinde test eder.
- Projenin normal test, typecheck, build ve public-release audit adımları da uygulanır.

Gerçek fal.ai anahtarı veya ücretli üretim kullanmadan güvenlik ve kuyruk
davranışı test edilebilir. Gerçek sağlayıcı/model erişimi ilk kullanıcı üretiminde
doğrulanır; demo çıktı gerçek üretim gibi gösterilmez.

## Resmî kaynaklar

- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/secrets
- https://supabase.com/docs/guides/functions/limits
- https://vercel.com/docs/frameworks/frontend/vite
- https://fal.ai/docs/documentation/model-apis/inference/queue
- https://fal.ai/docs/platform-apis/v1/models/pricing
- https://fal.ai/models/minimax/h3-max/text-to-video/api
- https://fal.ai/models/minimax/h3-max/image-to-video/api
