# Staging Migration Application Report — 2026-07-21

Operasyonel kanıt: staging Supabase’e uygulanan migration **024** ve **025**.
V4.5.4 paket / reconciliation raporları geriye dönük değiştirilmez; bu dosya ayrı tarihli kayıttır.

## Hedef

| Madde | Değer |
|-------|--------|
| Ortam | Staging only |
| Supabase project ref | `bveipjvbopbkvojfdpmo` |
| Production ref | `ttxigznwcjvrlzuppbro` — **kullanılmadı** |
| Tarih | 2026-07-21 |
| Uygulama yöntemi | Supabase SQL Editor, Role `postgres`, transaction wrapper (`BEGIN` … `COMMIT`) |

## Migration 024

| Madde | Değer |
|-------|--------|
| Dosya | `supabase/migrations/024_security_dr_hardening.sql` |
| SHA-256 | `E5EDD3DB3DACE342381C9AD83FD7BB5AD5C1868D908E4FBA4E04006F5954AD87` |

### Geçmiş (başarısız deneme)

- V4.5.2 gövdesi ile ilk deneme PostgreSQL **42883** verdi: `operator does not exist: name[] = text[]`.
- Transaction **COMMIT olmadı**.
- Ayrı `ROLLBACK` komutu: `Success. No rows returned`.

### V4.5.3 sonrası başarılı uygulama

- `attname::text` type cast düzeltmesi bağımsız incelendi (V4.5.3).
- Aynı SHA ile 024 transaction sonucu: **Success. No rows returned** / **COMMIT**.

## Migration 025

| Madde | Değer |
|-------|--------|
| Dosya | `supabase/migrations/025_security_view_indexes_grants.sql` |
| SHA-256 | `21B2A5FC4D6E1607E2B10C4989E7DCD60D1D87AF380DBC75621A684C301781D5` |
| Transaction sonucu | **Success. No rows returned** / **COMMIT** |

## V4.5.4 final postflight

Kaynak: `docs/security/STAGING_SCHEMA_PREFLIGHT_READ_ONLY.sql` (V4.5.4 predicate aliases).

| Metrik | Değer |
|--------|--------|
| Toplam satır | 177 |
| READY | 95 |
| ALREADY_APPLIED | 81 |
| MANUAL_REVIEW | 1 |
| CONFLICT | 0 |
| MISSING | 0 |

### Özet satırları

- **024:** `actual_state=already_applied`, `status=ALREADY_APPLIED`
- **025:** `actual_state=already_applied`, `status=ALREADY_APPLIED`

### Tek MANUAL_REVIEW

- `supabase_migrations.schema_migrations` — `table_absent`
- Opsiyonel; tablo **oluşturulmadı**; migration repair **yapılmadı**.

## Teyitler

| Madde | Durum |
|-------|--------|
| Production’a bağlanılmadı | Evet |
| Production SQL / HTTP | Yok |
| Commit / push / deploy (bu uygulama oturumunda) | Yok (ayrı süreç) |
| 024 / 025 tekrar çalıştırılacak mı? | **Hayır** — ALREADY_APPLIED |
| Ham CSV / ekran görüntüleri commit’e | Alınmayacak |
| Secret / kullanıcı verisi bu raporda | Yok |

## İlişkili paketler (referans; değiştirilmedi)

- V4.5.3: Postgres `name[]` / `text[]` cast kapanışı
- V4.5.4: preflight `idx_audit_events_request_id` false-positive kapanışı
- Reconciliation / SHA256SUMS / preflight dosyaları bu kanıt için yeniden yazılmadı
