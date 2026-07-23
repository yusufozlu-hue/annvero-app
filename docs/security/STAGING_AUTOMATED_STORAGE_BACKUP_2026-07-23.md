# Staging Automated Storage Backup — 2026-07-23

Operatör / agent kanıtı. Secret / service-role değerleri içermez.

## Scope

| Alan | Değer |
|------|--------|
| Ortam | Staging only |
| İzinli ref | `bveipjvbopbkvojfdpmo` |
| Yasak ref | `ttxigznwcjvrlzuppbro` (fail-closed) |
| Workflow | `.github/workflows/staging-storage-backup.yml` |
| Script | `scripts/backup/staging-storage-backup.mjs` |
| Schedule | `0 3 * * *` (UTC) + `workflow_dispatch` |
| Retention (manifest) | günlük 35 gün · haftalık 12 · aylık 12 |
| Production impact | **NONE** (bu turda production API yok) |

## Bu turda kanıtlanan

| Madde | Durum |
|-------|--------|
| Staging-only project ref kilidi | **PASS** (unit + dry-run self-check) |
| Production ref reddi (API öncesi) | **PASS** |
| Dry-run manifest + checksum + yerel restore | **PASS** |
| Secret’ları loglamama (redact + STAGING_* ayrımı) | **PASS** (kod/test) |
| Min GHA permissions (`contents: read`) | **PASS** |
| concurrency + timeout-minutes(30) + workflow_dispatch | **PASS** |
| Drill-only; kullanıcı objelerine dokunmama | **PASS** (tasarım + dry-run) |

## Bu turda BLOCKED

| Madde | Neden |
|-------|--------|
| Live object-level backup (staging API) | `STAGING_SUPABASE_URL` + `STAGING_SUPABASE_SERVICE_ROLE_KEY` bu ortamda tanımlı değil |
| Yerel `.env.local` ile canlı koşum | `NEXT_PUBLIC_SUPABASE_URL` **production** ref’ine işaret ediyor → kullanılamaz / DUR |
| İkinci immutable S3 hedefi | `BACKUP_SECONDARY_S3_BUCKET` yok |
| GitHub Environment `staging-backup` secret kurulumu | Değer uydurulmadı; operatör adımı |

### Gerekli secret adları (değer yok)

| Secret adı | Amaç |
|------------|------|
| `STAGING_SUPABASE_URL` | Staging API URL (`https://bveipjvbopbkvojfdpmo.supabase.co`) |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Staging service role (drill bucket create/upload/download/delete) |
| `BACKUP_SECONDARY_DIR` (opsiyonel) | İkinci yerel/CI kopya kökü |
| `BACKUP_SECONDARY_S3_BUCKET` (opsiyonel) | Immutable object-lock hedefi |
| `BACKUP_ENCRYPTION_KEY` (opsiyonel) | İleride envelope şifreleme |

## Fail-closed notları

- Canlı mod **genel** `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` kabul etmez.
- Production ref tespitinde süreç **non-zero** çıkar; Storage API çağrılmaz.
- Retention silme: kaynak kullanıcı dosyalarına uygulanmaz; yalnız drill bucket + `BACKUP_DELETE_CONFIRM` politikası (dokümante).

## Cleanup

Bu turda canlı drill bucket oluşturulmadı → cleanup N/A.
Dry-run çıktıları `.tmp-staging-storage-backup/` / `.gitignore` altında; commit kapsamı dışı.

## Non-claims

- Bu rapor production-ready Storage DR ilanı değildir.
- Otomatik zamanlama workflow dosyası hazır; GitHub’da secret + Environment olmadan schedule **yeşil live PASS üretmez**.
- PITR hâlâ kapalı (ayrı açık risk).
