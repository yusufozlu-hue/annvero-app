# Staging Immutable S3 Secondary Backup — 2026-07-23

Operatör / agent kanıtı. Secret, AWS hesap kimliği veya tam rol ARN içermez.

## Scope

| Alan | Değer |
|------|--------|
| Ortam | Staging only |
| Branch | `security/staging-hardening` |
| İzinli Supabase ref | `bveipjvbopbkvojfdpmo` |
| Yasak ref | `ttxigznwcjvrlzuppbro` (fail-closed; bu turda API yok) |
| Workflow | `.github/workflows/staging-storage-backup.yml` |
| Scripts | `staging-storage-backup.mjs` → `upload-immutable-s3.mjs` |
| GitHub Environment | `staging-backup` (yalnız bu branch; admin bypass kapalı) |
| Production impact | **NONE** |

## Özet sonuç

| Madde | Durum |
|-------|--------|
| Staging Storage backup live | **PASS** |
| BACKUP_MATCH / RESTORE_MATCH | **true** / **true** |
| Supabase drill cleanup | **PASS** (attempted; run exit 0) |
| GitHub OIDC assume role | **PASS** (ikinci deneme) |
| Static AWS access key | **NONE** |
| Immutable S3 upload + verify | **PASS** (3 object) |
| Object Lock | **COMPLIANCE** · retention **35 gün** · retain-until ≈ **2026-08-27** |
| S3 delete | **denenmedi**; rolde DeleteObject / retention değiştirme yok |
| Gerçek staging kullanıcı objelerine etki | **NONE** |
| Secret sızıntısı | **NONE** |
| Production backup kanıtı | **değil** — bu rapor production-ready ilan etmez |

## Deneme geçmişi (dürüst kayıt)

### 1) İlk deneme — FAIL

| Alan | Değer |
|------|--------|
| Actions run | `30004604101` @ commit `6a1c5a3` |
| Staging Storage backup | **PASS** |
| Configure AWS credentials (OIDC) | **FAIL** |
| Hata | `Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity` |
| Kök neden | IAM OIDC trust **sub/ref** beklentisi (`ref:refs/heads/security/staging-hardening`) ile gerçek token subject uyuşmuyordu |
| S3 upload | **skipped** (OIDC sonrası adım çalışmadı) |
| Artifact (ilk) | backup checksum paketleri üretildi; S3 secondary yok |

### 2) Düzeltme (kod dışı — AWS / GitHub Environment)

| Alan | Değer |
|------|--------|
| Trust subject | `repo:yusufozlu-hue/annvero-app:environment:staging-backup` |
| Audience | `sts.amazonaws.com` |
| GitHub Environment | `staging-backup` → yalnız `security/staging-hardening`; admin bypass **disabled** |
| Access key | oluşturulmadı / kullanılmadı |

### 3) İkinci deneme — PASS

| Alan | Değer |
|------|--------|
| Aynı run | `30004604101` (OIDC düzeltmesi sonrası başarılı yeniden çalışma) |
| Başarılı job | `89201131433` |
| Artifact ID | `8562898431` |
| Artifact digest | `sha256:1460afce760915d89a1e413097dd364d74aa65ae7118b74891322c1d1c7cda3c` |
| Artifact | 4 dosya · 2617 byte (secret yok) |
| OIDC | **PASS** |
| S3 upload + head-object + re-download checksum | **PASS** |

## S3 nesneleri

Bucket adı (public bilgi): `annvero-immutable-backup-tr-20260723` · Region: `eu-central-1`

| Key |
|-----|
| `staging/2026-07-23/30004604101/staging-storage-backup-envelope.json` |
| `staging/2026-07-23/30004604101/staging-storage-backup-manifest.json` |
| `staging/2026-07-23/30004604101/storage-backup-manifest.json` |

Metadata (nesne başına): `source=annvero-staging`, `github-run-id`, `sha256` (değerler logda secret değil).

## Bucket / IAM güvenlik özeti (değer yok)

| Kontrol | Beklenen / gözlenen |
|---------|---------------------|
| Public access | blocked |
| ACL | disabled |
| Versioning | enabled |
| Encryption | SSE-S3 |
| Object Lock | enabled · default **COMPLIANCE / 35 gün** |
| IAM | bucket list/read/write gerekli minimum; **DeleteObject yok**; retention değiştirme yok |
| Auth | GitHub OIDC → environment vars (`AWS_ROLE_ARN`, `AWS_REGION`, `BACKUP_SECONDARY_S3_BUCKET`) |

## Non-claims

- Bu kanıt **staging** immutable ikinci hedefi kapatır; **production** Storage / S3 backup kanıtı değildir.
- Paket **production-ready** sayılmaz.
- PITR hâlâ maliyet nedeniyle bilinçli açık risk / karar kapısıdır.
- Production admin AND, tenant A/B, restore ve migration 024/025 doğrulamaları açıktır.
- Tam AWS hesap kimliği / rol ARN bu belgede yer almaz.
