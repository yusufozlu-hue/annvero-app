# PRODUCTION SECURITY & DR REPORT

Bu rapor yerel güvenlik paketinin durumunu özetler. Production/staging'e bağlantı kurulmamıştır.

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
- Dokümantasyon seti

## 3. Değiştirilen / eklenen dosyalar

Ayrıntılı liste final chat raporunda.

## 4. Migration

- `024_security_dr_hardening.sql` — rate_limit_buckets, audit request_id/result, audit/login immutable policies, restore approvals, official_notifications soft-delete kolonları
- `025_security_view_indexes_grants.sql` — view/index/grant hardening
- Önkoşul: 020–023 (kör varsayım yok; notice'lar var)
- `REMEDIATION_SQL_REQUIRES_APPROVAL.sql` — AÇIK ONAY

### Staging DB (2026-07-21) — uygulandı

- Tarihli operasyonel kanıt: [`STAGING_MIGRATION_APPLICATION_REPORT_2026-07-21.md`](./STAGING_MIGRATION_APPLICATION_REPORT_2026-07-21.md)
- Staging ref `bveipjvbopbkvojfdpmo`: 024 + 025 COMMIT; V4.5.4 postflight CONFLICT=0, MISSING=0; ikisi de ALREADY_APPLIED
- **Uygulama (Next.js) security smoke henüz yapılmadı** — staging application deploy / env / test hesapları bekliyor
- **Production değiştirilmedi** — production ref’e SQL/HTTP/migration/deploy yok
- Staging/preview: webhook HMAC secret’sız **fail-closed**; recovery yalnız `RECOVERY_API_ENABLED=true`
- Production ve Preview secret’ları paylaşılmamalı; GİB key adı `GIB_CREDENTIALS_ENCRYPTION_KEY` (çoğul)
## 5–7. Test / tenant / backup

Yerel komutlarla doğrulanır (`npm run security:ci`, `backup:dry-run`). Production'a karşı test yok. Staging uygulama smoke bekliyor.

## 8. Bağlantı teyidi

- Bu DR raporunun ilk yazımında production/staging’e agent bağlantısı yoktu.
- Staging DB 024/025 uygulaması operatör tarafından SQL Editor ile yapıldı; kanıt yukarıdaki tarihli raporda.
- Production hâlâ değiştirilmedi; `supabase link` / `db push` / production SQL yok.

## 9. Dokunulmayan

- `.cursor/hooks/lib/deploy-utils.mjs`
- Commit / push / deploy yok

## 10–13. Kalan riskler ve kullanıcı adımları

Chat final raporuna bakın.
