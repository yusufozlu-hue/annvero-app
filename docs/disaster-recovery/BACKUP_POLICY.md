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
- Workflow: `.github/workflows/staging-storage-backup.yml` (staging Environment; production-backup değil)
- İkinci bağımsız + object-lock hedef kurulmadan Storage yedek “tamamlandı” sayılmaz

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
