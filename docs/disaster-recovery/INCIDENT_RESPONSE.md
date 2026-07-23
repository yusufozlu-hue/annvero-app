# Incident Response

## Sınıflandırma

| Seviye | Örnek |
|--------|-------|
| SEV1 | Production veri sızıntısı, service_role ifşası, tenantlar arası sızıntı |
| SEV2 | Auth bypass şüphesi, GİB credential compromise |
| SEV3 | Rate limit bypass, tek endpoint anomali |

## İlk 60 dakika

1. Etkilenen sistemi izole et (anahtar revoke / rotate planı).
2. Audit + login_events incele (secret basmadan).
3. Vercel/Supabase erişim loglarını koru.
4. Müşteri bildirimi kararı (hukuk/yönetim).

## Secret compromise

1. Etkilenen anahtarı **hemen rotate** et (Supabase dashboard / Vercel env).
2. Eski anahtarı revoke et.
3. GİB encryption key rotate ise re-encrypt prosedürü: aşağıdaki adımlar.
4. Git geçmişinde secret varsa: geçmişi **değiştirme**; rotate + monitoring.

## GİB key rotation (özet)

1. Yeni `GIB_CREDENTIALS_ENCRYPTION_KEY` üret (32 byte).
2. Maintenance penceresi.
3. Eski key ile decrypt → yeni key ile encrypt (script, izole; production secret chat'e gelmez).
4. Vercel env güncelle → redeploy.
5. Audit: credential change (secret olmadan).

## İletişim

- İç: yönetici + teknik sahip
- Dış: gerekirse müşteri / KVKK süreçleri

## Sonrası

- Root cause
- Kontrol iyileştirmesi
- Restore/backup tatbikatı gerekiyorsa planla
