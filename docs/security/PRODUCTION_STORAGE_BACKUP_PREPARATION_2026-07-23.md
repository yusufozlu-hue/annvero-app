# Production Storage Backup Preparation — 2026-07-23

Bu belge yalnız hazırlık kanıtıdır. Production Storage envanteri alınmadı,
object kopyalanmadı ve workflow çalıştırılmadı.

## Durum

| Alan | Durum |
|------|-------|
| Production Supabase ref kilidi | Kodda hazır: `ttxigznwcjvrlzuppbro` |
| Staging / bilinmeyen ref reddi | Kod ve statik test **PASS** |
| Kaynak Storage erişimi | Salt okunur `listBuckets` / `list` / `download` |
| Kaynakta create/update/move/copy/remove/delete | **Yok** |
| GitHub workflow | `.github/workflows/production-storage-backup.yml` |
| Workflow tetikleme | Yalnız manuel `workflow_dispatch` |
| Modlar | `dry-run` · `inventory` · `live` |
| Schedule | İlk production live kanıtına kadar **yok** |
| GitHub Environment | `production-backup`; yalnız `main`; admin bypass kapalı |
| Supabase secret adları | `PRODUCTION_SUPABASE_URL`, `PRODUCTION_SUPABASE_SERVICE_ROLE_KEY` |
| AWS auth | GitHub OIDC; statik access key **yok** |
| AWS role | `ANNVERO-GitHub-Production-Immutable-Backup` |
| AWS region | `eu-central-1` |
| Immutable bucket | `annvero-production-immutable-backup-tr-20260723` |
| Object Lock | COMPLIANCE; varsayılan 35 gün |
| S3 delete / retention değişikliği | Kodda ve IAM izinlerinde **yok** |
| Staging commit | `866da13` — `feat(security): add production storage backup pipeline` |
| Production inventory | **BEKLİYOR** |
| Production live immutable backup | **BEKLİYOR** |
| Production restore | **BEKLİYOR** |

## Hazırlanan kod

- `scripts/backup/lib/productionBackupGuard.mjs`
- `scripts/backup/production-storage-backup.mjs`
- `scripts/backup/upload-production-immutable-s3.mjs`
- `scripts/test-production-storage-backup.mjs`

Workflow, source objeleri yalnız GitHub runner üzerinde geçici olarak tutar.
Artifact yüklemeden önce geçici object kopyalarını kaldırır; artifact kapsamına
yalnız secret içermeyen kanıt JSON'ları girer.

## Yerel / staging doğrulamaları

| Kontrol | Sonuç |
|---------|-------|
| `npm run security:ci` | **PASS** |
| `npm run test:production-storage-backup` | **PASS** |
| `npm run backup:production-storage:dry-run` | **PASS** — network yok |
| `npm run lint:security` | **PASS** |
| Vercel staging deployment | **SUCCESS** |
| Production workflow run | **YOK** |
| Production impact | **NONE** |

## Production'da yapılandırılan altyapı

- S3 bucket oluşturuldu; versioning ve Object Lock etkin.
- Genel erişim engellendi; ACL kapalı; sunucu tarafı şifreleme etkin.
- GitHub OIDC trust subject:
  `repo:yusufozlu-hue/annvero-app:environment:production-backup`
- IAM policy yalnız gerekli bucket list/get ve object put/get/retention okuma
  izinleriyle sınırlandı.
- GitHub Environment değişken adları:
  `AWS_ROLE_ARN`, `AWS_REGION`, `BACKUP_SECONDARY_S3_BUCKET`.
- Secret değerleri bu belgede ve loglarda yer almaz.

## Kanıtlanmayanlar

- Production bucket envanterinin eksiksiz okunabildiği
- Tüm production objelerinin immutable hedefe kopyalandığı
- Manifest / object SHA-256 eşleşmesi
- `head-object` ile COMPLIANCE ve retain-until doğrulaması
- Re-download checksum ve production restore
- Otomatik schedule

Bu maddeler tamamlanmadan production Storage backup **PASS** veya tam
production-ready DR ilan edilmez.

## Sonraki kontrollü sıra

1. PR / `main` merge ve production application deploy için ayrı açık onay.
2. Workflow `inventory` modu — yalnız okuma; çıktı incelenir.
3. Ayrı açık onayla tek `live` run.
4. Manifest, checksum, Object Lock ve re-download kanıtı.
5. PASS sonrasında schedule kararı ve restore tatbikatı.
