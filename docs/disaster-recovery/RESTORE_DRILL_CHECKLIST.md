# Restore Drill Checklist

Tatbikat tarihi: ________  Ortam: izole recovery (prod değil)

## Hazırlık

- [ ] Yedek seçildi (tarih/saat)
- [ ] Checksum doğrulandı
- [ ] Encryption key CI/secret store'dan alındı (dosyaya kalıcı yazılmadı)
- [ ] İzole proje hazır
- [ ] Gözlemci + süre ölçümü başladı

## Restore

- [ ] Decrypt + restore tamam
- [ ] Tablo sayısı kontrolü
- [ ] Kritik satır örnekleri (firma, learning_memory, audit)
- [ ] Storage / dosya sayısı (varsa)
- [ ] Uygulama smoke (login, firma, banka örnek)

## Soft-delete restore API

- [ ] Dry-run özeti alındı
- [ ] `RESTORE_CONFIRM` ile tek kayıt restore
- [ ] Audit `restore` kaydı görüldü

## Sonuç

- [ ] RTO ölçüldü: ______ dakika (hedef ≤ 240 dakika / 4 saat)
- [ ] Storage dosyalarının DB restore ile geri gelmediği doğrulandı
- [ ] PITR ≠ ikinci immutable yedek olduğu not edildi
- [ ] RPO senaryosu notu: ______
- [ ] Bulgular / aksiyonlar:
- [ ] Tatbikat imza / onay

**Not:** Bu hedefler yalnızca başarılı tatbikatla doğrulanmış sayılır.
