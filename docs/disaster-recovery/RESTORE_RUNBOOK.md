# Restore Runbook

## Altın kurallar

1. Restore **yalnız izole recovery ortamında** yapılır.
2. Production'a doğrudan restore **yasak** (açık kriz + çift onay hariç).
3. Önce dry-run özeti, sonra insan onayı.
4. Secret'lar chat/log'a yazılmaz.

## Soft-delete kayıt geri yükleme (uygulama)

Bu endpoint **DB backup / PITR restore yapmaz** — yalnız soft-delete satır geri alır.

Production: `RECOVERY_API_ENABLED=true` yoksa fail-closed (503).

`RESTORE_CONFIRM` tek başına yetki değildir; yönetim rolü + firma erişimi + CSRF + audit zorunlu.

1. Listele: `GET /api/recovery/deleted-records?companyId=...&table=...`
2. Dry-run: `GET /api/recovery/restore?table=...&recordId=...&companyId=...`
3. Onaylı restore:
   ```http
   POST /api/recovery/restore
   { "table": "...", "recordId": "...", "companyId": "...",
     "confirm": true, "confirmPhrase": "RESTORE_CONFIRM" }
   ```
4. Audit kaydını doğrula (`action=restore`).

## Tam DB restore (operasyon)

1. İzole Supabase/Postgres projesi oluştur.
2. Yedek checksum'unu doğrula.
3. Decrypt (CI secret key — lokal dosyaya yazma).
4. Restore et.
5. Bütünlük: tablo sayıları, satır örnekleri, storage dosya sayımı.
6. Uygulama smoke: login, firma seçici, banka parser örnek, GİB credential maskeli okuma.
7. Credential rotation kararı (gerekirse).
8. Tatbikat süresini kaydet (RTO ölçümü).

## Onay

Kritik işlem phrase'leri: `src/lib/security/criticalApproval.js`
