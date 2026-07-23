# Backup Policy

## Hedefler (tatbikatla kanıtlanmadıkça “sağlandı” denmez)

| Metrik | Hedef | Not |
|--------|-------|-----|
| RPO (PITR açıksa) | ≤ 15 dakika | Panelde PITR doğrulanmadan “aktif” denmez |
| RPO (günlük bağımsız yedek) | ≤ 24 saat | PITR’dan ayrı katman |
| RTO | ≤ 4 saat | Yalnız başarılı restore tatbikatı ile doğrulanır |

## İki ayrı varlık

### A. PostgreSQL veritabanı
- Supabase managed backup / PITR
- Günlük mantıksal dump/export (CI şablon)

### B. Supabase Storage dosyaları
- DB backup **Storage objelerini kapsamaz**
- Silinen Storage dosyası yalnız database restore ile geri gelmez
- Inventory manifest: bucket, path, company_id, size, checksum, version
- Dry-run: `npm run backup:storage-dry-run`
- Staging otomatik (drill-scoped): `npm run backup:staging-storage:dry-run` /
  `npm run backup:staging-storage -- --mode live` (yalnız `STAGING_*` secret’lar)
- Immutable S3 plan (AWS’siz): `npm run backup:immutable-s3:dry-run`
- Workflow: `.github/workflows/staging-storage-backup.yml` (Environment `staging-backup`; OIDC → S3)
- Staging ikinci hedef **live PASS** (2026-07-23):
  `docs/security/STAGING_IMMUTABLE_S3_BACKUP_2026-07-23.md`
  (COMPLIANCE / 35g; access key yok; DeleteObject yok)
- Production ikinci hedef kurulmadan production Storage yedek “tamamlandı” **ilan edilmez**

## Tek backup run ID
- DB + Storage manifest’leri aynı `run_id` ile bağlanır
- İki parçadan biri eksikse veya ikinci hedef yoksa run başarılı sayılmaz

## PITR vs ikinci yedek
- PITR, ikinci bağımsız/immutable yedek **yerine geçmez**
- Supabase PITR etkinleştirildiğinde paneldeki günlük backup davranışı değişebilir — dokümantasyonu panelden doğrulayın
- Storage dosyaları PITR kapsamına girmez

## Retention (öneri)
- Günlük: 35 gün · Haftalık: 12 hafta · Aylık: 12 ay

## Yetki ayrımı
- Yedek yazma: write-only tercih
- Silme/retention: ayrı kimlik + `BACKUP_DELETE_CONFIRM`
