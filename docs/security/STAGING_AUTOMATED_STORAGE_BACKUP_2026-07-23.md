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
| Live staging object-level backup (Actions) | **PASS** — run `29994737249` @ `473aa77` (Node 22) |
| Live BACKUP_MATCH / RESTORE_MATCH / cleanup | **PASS** (script exit 0 + artifact) |

## Bu turda BLOCKED / açık

| Madde | Neden |
|-------|--------|
| Immutable S3 **live** upload/verify | Kod + workflow hazır; henüz yeşil live S3 run yok |
| Production Storage backup/restore | Cutover runbook; staging PASS production sayılmaz |
| PITR | Bilinçli kapalı (maliyet); production ayrı onay |

### Immutable S3 (kod hazır)

| Alan | Değer |
|------|--------|
| Action | `aws-actions/configure-aws-credentials@7474bc4690e29a8392af63c5b98e7449536d5c3a` (v4.3.1) |
| Auth | GitHub OIDC → `vars.AWS_ROLE_ARN` (access key yok) |
| Bucket var | `vars.BACKUP_SECONDARY_S3_BUCKET` |
| Key | `staging/<UTC-YYYY-MM-DD>/<GITHUB_RUN_ID>/<file>` |
| Lock kontrolü | head-object: COMPLIANCE + retain ~35g + sha256 metadata + re-download |
| Delete | **Yok** (rolde DeleteObject yok; script denemez) |

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

Live run `29994737249`: sentetik nesne + drill bucket cleanup script varsayılanıyla PASS (exit 0).
Dry-run çıktıları `.tmp-staging-storage-backup/` / `.gitignore` altında; commit kapsamı dışı.

## Non-claims

- Bu rapor production-ready Storage DR ilanı değildir.
- Production cutover: `PRODUCTION_CUTOVER_RUNBOOK_2026-07-23.md` (`deploy onayla` zorunlu).
- PITR ve immutable ikinci hedef ayrı karar kapılarıdır.
