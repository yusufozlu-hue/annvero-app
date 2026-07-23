# PRODUCTION SECURITY & DR REPORT

Bu rapor yerel güvenlik paketinin durumunu özetler. Production’a agent bağlantısı kurulmamıştır.
Staging tatbikat kanıtları operatör kayıtlarıdır (aşağıdaki tarihli raporlar).

## 1. Tespit edilen riskler

### P0
- `user_metadata.role=admin` ile yetki yükseltme (düzeltildi)
- Fallback profilde `user_metadata.company_ids` ile tenant claim (düzeltildi)
- Company export'ta şifreli GİB alanlarının düz export'u (redaksiyon eklendi)
- Production'da secret'siz açık webhook (fail-closed; staging/preview de HMAC zorunlu)
- `/api/tcmb`, `/api/elektraweb` oturumsuz (oturum + rate limit + upload guard)
- Staging/preview recovery default-on (explicit `RECOVERY_API_ENABLED=true` zorunlu)

### P1
- CSRF / security headers yoktu (eklendi)
- In-memory rate limit serverless'ta zayıf (durable adapter hazır; Upstash aktivasyonu kullanıcıda)
- Restore API yoktu (dry-run + onay eklendi)
- CI güvenlik kapıları yoktu (workflow eklendi)
- `.env.example` / SECURITY docs yoktu
- Browser/server auth cookie ayrışması (SSR cookie sync; staging drill’de doğrulandı)
- GİB cross-tenant’ın encryption/supabase guard’dan önce 500 dönmesi (tenant guard önce; staging’de 403)

### P2
- CSP `unsafe-inline` (bilinçli, raporlandı)
- Malware tarama adapter not_configured
- Key prefix'lerin debug diagnostics'te sızma riski (kaldırıldı)

## 2. Yapılan düzeltmeler (kod)

- Env fail-closed (`envGuard`)
- Admin metadata hardening
- Redaction, CSRF, CORS allowlist, request ID, security headers
- Durable rate limit adapter
- Export v3 redaksiyon + cross-tenant satır engeli
- Recovery restore API
- Migration 024 / 025 (staging’de uygulandı — bkz. tarihli rapor; production’da yok)
- Unauth route hardening
- `server-only` on `serverAdmin` / encryption service
- CI + secret/SQL/client scans + regression tests
- Backup dry-run + workflow example
- Supabase SSR cookie session sync (`@supabase/ssr`)
- GİB credentials: tenant `assertCompanyAccess` encryption/DB’den önce
- Dokümantasyon seti

## 3. Değiştirilen / eklenen dosyalar

Ayrıntılı liste final chat raporunda ve tarihli staging raporlarında.

## 4. Migration

- `024_security_dr_hardening.sql` — rate_limit_buckets, audit request_id/result, audit/login immutable policies, restore approvals, official_notifications soft-delete kolonları
- `025_security_view_indexes_grants.sql` — view/index/grant hardening
- Önkoşul: 020–023 (kör varsayım yok; notice'lar var)
- `REMEDIATION_SQL_REQUIRES_APPROVAL.sql` — AÇIK ONAY

### Staging DB (2026-07-21) — uygulandı

- Tarihli operasyonel kanıt: [`STAGING_MIGRATION_APPLICATION_REPORT_2026-07-21.md`](./STAGING_MIGRATION_APPLICATION_REPORT_2026-07-21.md)
- Staging ref `bveipjvbopbkvojfdpmo`: 024 + 025 COMMIT; V4.5.4 postflight CONFLICT=0, MISSING=0; ikisi de ALREADY_APPLIED
- Staging/preview: webhook HMAC secret’sız **fail-closed**; recovery yalnız `RECOVERY_API_ENABLED=true`
- Production ve Preview secret’ları paylaşılmamalı; GİB key adı `GIB_CREDENTIALS_ENCRYPTION_KEY` (çoğul)

### Staging tenant isolation drill (2026-07-22) — PASS (staging only)

- Kanıt: [`STAGING_TENANT_ISOLATION_DRILL_2026-07-22.md`](./STAGING_TENANT_ISOLATION_DRILL_2026-07-22.md)
- Build `66c35a5` @ `https://annvero-staging.vercel.app`
- Same-origin: `/api/auth/me` membership A only; GİB/admin/export B → **403** (`PASS_STAGE2_AUTH`)
- Authenticated RLS: firm A visible=1, firm B visible=0
- Anon select grant yok; RLS açık
- Sentetik firma B cleanup: rows=0; A membership=1; ikinci cleanup fail-closed abort; CASCADE yok
- **Production tenant izolasyonu uygulanmadı**
- **Production impact: NONE**
- Paket **production-ready ilan edilmez**; production deploy/migration onayı hâlâ bekliyor

### Staging admin AND-gate drill (2026-07-22) — PASS (staging only)

- Kanıt: [`STAGING_ADMIN_AND_GATE_DRILL_2026-07-22.md`](./STAGING_ADMIN_AND_GATE_DRILL_2026-07-22.md)
- Build `118f660` @ `https://annvero-staging.vercel.app` (Vercel projesi `annvero-staging`)
- Negatif: `ANNVERO_ADMIN_EMAILS` yok + trusted `app_metadata.admin` → `GET /api/admin/users` **403**
- Pozitif: allowlist yalnız staging proje “Production” env + trusted `app_metadata.admin` → status **200** (`PASS_ADMIN_AND_POSITIVE`); body kaydedilmedi
- Truth: allowlist AND trusted app_metadata; `user_metadata` / DB `role=admin` tek başına yetki değil
- **Production admin testi yapılmadı**; production env değiştirilmedi
- **Production impact: NONE**
- Bu tatbikat production-ready sonucunu değiştirmez

### Staging database restore drill (2026-07-22) — PASS (staging only)

- Kanıt: [`STAGING_DATABASE_RESTORE_DRILL_2026-07-22.md`](./STAGING_DATABASE_RESTORE_DRILL_2026-07-22.md)
- Kaynak: staging ref `bveipjvbopbkvojfdpmo` (yedek 21 Jul 2026 23:25:02 UTC)
- Restore projesi: `annvero-staging-restore-drill-20260722` (`eu-central-1`); RTO ≤ 7m23s; geçici ek maliyet $10.18/ay (proje silindi — artık aktif değil)
- Şema/veri PASS (kritik tablolar + rate-limit RPC; A=1 / B=0 membership tutarlı)
- Güvenlik PASS (ilk 8 kontrol true; restrictive deny policy count=9)
- **Cleanup COMPLETED (2026-07-22):** geçici restore projesi kalıcı silindi; proje listesinde yok; kaynak staging etkilenmedi; production impact **NONE**; faturalanmış tutar/iade konusunda kanıtsız iddia yok
- **Açık riskler (devam):** PITR kapalı; production restore uygulanmadı; otomatik Storage backup bu DB drill’de kanıtlanmadı
- **Production impact: NONE**
- Bu tatbikat production-ready sonucunu değiştirmez

### Staging Storage backup/restore drill (2026-07-22) — PASS (staging only, manuel)

- Kanıt: [`STAGING_STORAGE_BACKUP_RESTORE_DRILL_2026-07-22.md`](./STAGING_STORAGE_BACKUP_RESTORE_DRILL_2026-07-22.md)
- Staging ref `bveipjvbopbkvojfdpmo`; private bucket `annvero-security-storage-drill-20260722` (1 MB / `text/plain`; 114 byte)
- SHA-256 (kaynak=yedek=restore): `8ADD6A3E30E9E28CF7EF633AA4260F230317D701C8AC5F7ED02E7A6F3E9CC3BA`
- `BACKUP_MATCH=True`, `RESTORE_MATCH=True`; restore sonrası yeniden indirme doğrulandı
- Cleanup: sentetik nesne + bucket kalıcı silindi
- **Kanıtlanan:** yalnız manuel object-level backup/restore
- **Kanıtlanmayan:** otomatik/scheduled Storage backup; production Storage restore
- **Açık risk:** PITR kapalı
- **Production impact: NONE**
- Bu tatbikat production-ready sonucunu değiştirmez

### Staging automated Storage backup pipeline (2026-07-23) — PARTIAL

- Kanıt: [`STAGING_AUTOMATED_STORAGE_BACKUP_2026-07-23.md`](./STAGING_AUTOMATED_STORAGE_BACKUP_2026-07-23.md)
- Kod: `scripts/backup/staging-storage-backup.mjs` + `lib/stagingBackupGuard.mjs`
- Workflow: `.github/workflows/staging-storage-backup.yml` (cron `0 3 * * *` UTC, dispatch, concurrency, timeout 30m, `contents: read`)
- Dry-run + production ref fail-closed: **PASS**
- Live staging API: **BLOCKED** — `STAGING_SUPABASE_URL` / `STAGING_SUPABASE_SERVICE_ROLE_KEY` yok; yerel `.env.local` production ref (kullanılmadı)
- İkinci S3 hedefi: **NOT_CONFIGURED**
- **Production impact: NONE**

## 5–7. Test / tenant / backup

Yerel: `npm run security:ci`, `backup:dry-run`.
Staging: tenant isolation + admin AND-gate + database restore + Storage (manuel) drill PASS.
Production’a karşı smoke / izolasyon / admin / restore tatbikatı **yok**.

## 8. Bağlantı teyidi

- Bu DR raporunun ilk yazımında production/staging’e agent bağlantısı yoktu.
- Staging DB 024/025 uygulaması operatör tarafından SQL Editor ile yapıldı; kanıt tarihli migration raporunda.
- Staging tenant, admin AND-gate, database restore ve Storage drill operatör kanıtları tarihli raporlarda.
- Production hâlâ değiştirilmedi; `supabase link` / `db push` / production SQL yok.

## 9. Dokunulmayan

- `.cursor/hooks/lib/deploy-utils.mjs`
- Bu doküman turunda commit / push / deploy yok (ayrı onay gerekir)

## 10–13. Kalan riskler ve kullanıcı adımları

- Production migration 024/025 + deploy: **açık onay bekliyor**
- Production tenant isolation smoke: **yapılmadı**
- Production admin AND-gate doğrulaması: **yapılmadı**
- Production database restore: **yapılmadı**
- Production Storage restore: **yapılmadı**
- PITR kapalı (açık risk)
- Otomatik / scheduled Storage backup: **pipeline hazır; live kanıt BLOCKED** (STAGING_* secrets)
- Chat final / checklist ile hizalı kalın; staging PASS ≠ production-ready
