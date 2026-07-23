# ANNVERO Güvenlik/DR — V4.5.4 Reconciliation Report

**Paket:** `ANNVERO_GUVENLIK_KONTROL_V4_5_4_REVIEW.zip`
**Tarih:** 2026-07-21
**Kapsam:** Preflight `idx_audit_events_request_id` false-positive — exact predicate IN aliases

## Teyitler

| Madde | Durum |
|-------|--------|
| Production / staging bağlantısı | Yok |
| SQL / migration uygulama | Yok |
| 024 yeniden çalıştırılmadı | Evet (dokunulmadı) |
| 025 çalıştırılmadı | Evet (dokunulmadı) |
| Commit / push / PR / deploy | Yok |
| `.cursor/hooks/lib/deploy-utils.mjs` | Dokunulmadı |
| Migration 015, 020–025 | Dokunulmadı (hash V4.5.3 ile aynı) |
| `scripts/test-security-regression.mjs` | Dokunulmadı |

Bu paket **deploy onayı değildir**.

## Kök neden

Staging postflight: beklenen `(request_id<>'')`, PostgreSQL actual `(request_id<>''::text)`.
Semantik eşdeğer; 024 runtime zaten `::text` strip ediyor. Preflight detail + applied024 yolları regex ile yalnız `''` kabul ediyordu → 1 CONFLICT.

## Düzeltme

Her iki yolda exact IN:

- `(request_id<>'')`
- `(request_id<>''::text)`
- `(request_id!='')`
- `(request_id!=''::text)`

Global `::text` strip yok; substring / OR / diğer kolon / `::varchar` kabul edilmez.

## Değişen dosyalar

- `docs/security/STAGING_SCHEMA_PREFLIGHT_READ_ONLY.sql`
- `scripts/test-migration-contract-020-025.mjs` (section 21)
- `docs/security/RECONCILIATION_REPORT.md`
- `docs/security/SHA256SUMS.txt`

## SHA-256 (içerik)

| Dosya | SHA-256 |
|-------|---------|
| 024 (V4.5.3 ile aynı) | `E5EDD3DB3DACE342381C9AD83FD7BB5AD5C1868D908E4FBA4E04006F5954AD87` |
| 025 (V4.5.3 ile aynı) | `21B2A5FC4D6E1607E2B10C4989E7DCD60D1D87AF380DBC75621A684C301781D5` |
| Preflight (yeni) | `3C0DD9C3CC913886E9DAC94CBE343B996E4F13595F95AD78BC2A98B3CDF05982` |

ZIP SHA-256 paket üretiminde ayrıca hesaplanır (rapor gövdesine gömülmez).
Tam içerik listesi: `SHA256SUMS.txt` (kendi hash’ini içermez).

## Testler

| Komut | Exit |
|-------|------|
| `npm run test:migration-contract` | 0 (section 21 dahil) |
| `npm run security:ci` | 0 |
