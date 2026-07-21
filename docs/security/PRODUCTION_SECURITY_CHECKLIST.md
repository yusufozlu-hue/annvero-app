# Production Security Checklist

Her madde için: kod hazır / kullanıcı işlemi / doğrulandı.

## Staging durumu (2026-07-21)

- [x] Staging DB migration **024** + **025**: tamamlandı
  Kanıt: `docs/security/STAGING_MIGRATION_APPLICATION_REPORT_2026-07-21.md`
- [ ] Staging application deploy: bekliyor
- [ ] Staging security smoke: bekliyor
- [ ] Vercel staging env / test accounts: bekliyor
- [ ] Production migration / deploy: **yasak** / bekliyor (açık onay yok)

### Staging / Preview fail-closed (kod)

- [x] Staging/preview webhook: HMAC secret yoksa fail-closed (DEV_OPEN yok)
- [x] Staging/preview recovery: `RECOVERY_API_ENABLED=true` olmadan disabled
- [x] Production ve Preview secret paylaşımı yasak (branch override)
- [x] GİB key exact adı: `GIB_CREDENTIALS_ENCRYPTION_KEY` (çoğul)

## Ortam ve secret

- [ ] Vercel/Railway secret store'da `SUPABASE_SERVICE_ROLE_KEY` (public değil)
- [ ] `GIB_CREDENTIALS_ENCRYPTION_KEY` tanımlı ve rotate prosedürü biliniyor
- [ ] `ANNVERO_ADMIN_EMAILS` server-only
- [ ] Yerel `.env*` production secret içermiyor
- [ ] `ANNVERO_APP_ENV=production` (veya Vercel production)
- [ ] Upstash veya `ANNVERO_RATE_LIMIT_BACKEND=supabase` + migration 024

## Veritabanı

- [ ] Production migration sırası: 020 → 021 → 022 → 023 uygulandı
- [ ] 023 üyelik seed yönetici onayı ile yapıldı
- [x] Migration **024** (+ **025**) staging'de uygulandı ve postflight CONFLICT=0 (production henüz yok)
- [ ] Migration **024** / **025** production'a uygulandı (yasak / bekliyor)
- [ ] RLS policy envanteri gözden geçirildi
- [ ] `docs/security/REMEDIATION_SQL_REQUIRES_APPROVAL.sql` gerekirse onaylı uygulandı

## Auth / tenant

- [ ] Kritik API'ler 401/403 davranışı smoke test
- [ ] Cross-tenant `companyId` denemesi 403
- [ ] Admin client role spoof başarısız
- [ ] Login / beni hatırla / logout cookie temizliği OK

## API hardening

- [ ] Security headers production response'da görünüyor
- [ ] Webhook secret production'da zorunlu
- [ ] Staging/preview webhook HMAC zorunlu (secret yoksa fail-closed)
- [ ] Staging/preview `RECOVERY_API_ENABLED=true` olmadan restore kapalı
- [ ] GİB/export rate limit 429 üretiyor
- [ ] Production ↔ Preview secret izolasyonu (Supabase/GİB/Drive/HMAC paylaşılmıyor)

## Backup / DR

- [ ] Supabase PITR panel kontrolü
- [ ] Günlük yedek workflow aktif (şablondan)
- [ ] İkinci immutable yedek hedefi
- [ ] Restore tatbikatı izole ortamda yapıldı
- [ ] RPO/RTO hedefleri tatbikatla ölçüldü

## CI

- [ ] `security-gates.yml` workflow yeşil
- [ ] `npm audit` yüksek/kritik kabul kaydı veya fix
