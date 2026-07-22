# Production Security Checklist

Her madde için: kod hazır / kullanıcı işlemi / doğrulandı.

## Staging durumu (2026-07-22)

- [x] Staging DB migration **024** + **025**: tamamlandı
  Kanıt: `docs/security/STAGING_MIGRATION_APPLICATION_REPORT_2026-07-21.md`
- [x] Staging application deploy (branch build `118f660`): tamamlandı (ayrı `annvero-staging` Vercel projesi)
- [x] Staging security smoke (unauth + auth transport + GİB/admin/export 403): tamamlandı
- [x] **Staging tenant isolation drill**: tamamlandı (2026-07-22)
  Kanıt: `docs/security/STAGING_TENANT_ISOLATION_DRILL_2026-07-22.md`
  Sınıflar: HTTP / membership / RLS / anon grant / synthetic cleanup → **PASS**; production impact **NONE**
- [x] **Staging admin AND-gate live smoke**: tamamlandı (2026-07-22)
  Kanıt: `docs/security/STAGING_ADMIN_AND_GATE_DRILL_2026-07-22.md`
  Negatif: allowlist yok + `app_metadata.admin` → `/api/admin/users` **403**;
  Pozitif: staging-only allowlist + trusted `app_metadata.admin` → **200** (`PASS_ADMIN_AND_POSITIVE`)
- [x] **Staging database restore drill**: tamamlandı (2026-07-22) — **PASS**
  Kanıt: `docs/security/STAGING_DATABASE_RESTORE_DRILL_2026-07-22.md`
  RTO ≤ 7m23s; şema/veri + restrictive deny PASS; production impact **NONE**
  Cleanup **COMPLETED**: geçici proje `annvero-staging-restore-drill-20260722` silindi;
  kaynak staging etkilenmedi; geçici $10.18/ay kaynağı artık aktif değil
  (faturalanmış tutar/iade iddiası yok)
- [x] Vercel staging env / proof test account (viewer + membership A): tatbikatta kullanıldı
- [ ] **Production admin doğrulaması**: bekliyor (staging AND-gate production sayılmaz)
- [ ] **Production tenant izolasyonu**: uygulanmadı (staging tatbikatı production’ı kapsamaz)
- [ ] **Production database restore**: uygulanmadı (staging restore production sayılmaz)
- [ ] Production migration / deploy: **yasak** / bekliyor (açık onay yok)
- [ ] Paket tamamen production-ready: **hayır** (production onay + migration + smoke bekliyor; bu test sonucu değiştirmez)

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

- [x] Staging: kritik API'ler 401/403 davranışı smoke + tenant drill
- [x] Staging: cross-tenant `companyId` denemesi 403 (export, GİB, admin)
- [ ] Production: kritik API / cross-tenant smoke (bekliyor; staging PASS production sayılmaz)
- [ ] Admin client role spoof başarısız (production smoke)
- [x] Staging: login / SSR cookie transport sonrası `/api/auth/me` authenticated=true (auth cookie sync)
- [x] Staging: admin AND-gate (negatif 403 + pozitif 200) — `STAGING_ADMIN_AND_GATE_DRILL_2026-07-22.md`
- [ ] Production: admin AND-gate live smoke (bekliyor)

## API hardening

- [ ] Security headers production response'da görünüyor
- [ ] Webhook secret production'da zorunlu
- [ ] Staging/preview webhook HMAC zorunlu (secret yoksa fail-closed)
- [ ] Staging/preview `RECOVERY_API_ENABLED=true` olmadan restore kapalı
- [ ] GİB/export rate limit 429 üretiyor
- [ ] Production ↔ Preview secret izolasyonu (Supabase/GİB/Drive/HMAC paylaşılmıyor)

## Backup / DR

- [ ] Supabase PITR panel kontrolü (**staging’de PITR kapalı** — açık risk)
- [ ] Günlük yedek workflow aktif (şablondan)
- [ ] İkinci immutable yedek hedefi
- [x] Staging restore tatbikatı izole ortamda yapıldı (2026-07-22) —
  `STAGING_DATABASE_RESTORE_DRILL_2026-07-22.md` (geçici restore projesi cleanup **COMPLETED**)
- [ ] Storage objects/settings yedekleme/restore kanıtı (bu tatbikatta kapsam dışı; risk açık)
- [ ] Production restore tatbikatı (bekliyor; staging PASS production sayılmaz)
- [x] Staging RTO ölçüldü (≤ 7m23s); production RPO/RTO tatbikatı bekliyor
- [ ] Supabase PITR etkin (staging’de PITR kapalı — risk açık kalır)

## CI

- [ ] `security-gates.yml` workflow yeşil
- [ ] `npm audit` yüksek/kritik kabul kaydı veya fix
