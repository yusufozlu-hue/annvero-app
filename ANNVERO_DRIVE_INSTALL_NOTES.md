# ANNVERO Google Drive V1 — Kurulum Notu

Bu paket yalnız Google Drive gerçek OAuth entegrasyonu için değişen/yeni dosyaları içerir.

## Uygulama sırası

1. Dosyaları mevcut ANNVERO proje köküne, klasör yollarını koruyarak kopyalayın.
2. `supabase/migrations/020_cloud_storage_evrak_havuzu_v1.sql` dosyasını önce staging'de inceleyip uygulayın.
3. Staging smoke testini yapın: bağla, klasör oluştur, ikinci kez oluştur (0 yeni), sync, klasörü aç, bağlantıyı kaldır.
4. Production migration ve deploy yalnız açık manuel onaydan sonra yapılmalıdır.

## Beklenen server environment değişkenleri

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REDIRECT_URI`
- `GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY` (32-byte base64)

Secret değerleri bu pakette bulunmaz.

## Doğrulama sonucu

- Cloud Storage testleri: geçti.
- Hedefli ESLint: geçti.
- Next.js 16.2.9 production build: geçti.
- Commit, push, migration uygulaması ve deploy: yapılmadı.
