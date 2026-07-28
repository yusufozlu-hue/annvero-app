# ADH Drive Pilot — Staging Tenant Isolation Drill

**Secret, parola, magic link veya token içermez.**

## Kanonik yetki kaynağı

| Katman | Kaynak |
|--------|--------|
| Firma erişimi | `annvero_company_members` (aktif satırlar, `user_id = auth.uid()`) |
| Rol | `annvero_user_profiles.role` + trusted `app_metadata` (elevated için AND-gate) |
| Mükellef rolü | `goruntuleme` (`ANNVERO_ROLES.VIEWER`) |
| API kapısı | `requireApiSession` → `assertCompanyAccess` → `canAccessCompany` |
| JWT/metadata | `user_metadata.company_ids` / `app_metadata.company_ids` **yetki vermez** |

## Staging kapsamı

| Alan | Değer |
|------|--------|
| Branch | `feature/drive-adh-pilot` |
| Supabase ref | `bveipjvbopbkvojfdpmo` |
| ADH companyId | `114f98b5-0411-45c5-a7c6-8061c9f06699` |
| Pilot viewer | `yusufozlu+adhpilot@gmail.com` |
| Rol | `goruntuleme` |

## Provision (staging-only)

```bash
node scripts/staging/provision-adh-pilot-viewer.mjs
```

- Mevcut kullanıcı korunur; ikinci auth kaydı oluşturulmaz.
- Yeni kullanıcıda Supabase davet e-postası gönderilir (parola üretilmez).
- Üyelik: yalnız ADH (`annvero_sync_company_membership` RPC).
- `ANNVERO STAGING TEST` ve diğer firmalar RPC ile kaldırılır.

## Yetki test matrisi (tarayıcı + API)

| Kontrol | Beklenen |
|---------|----------|
| Firma listesi | Yalnız ADH |
| ANNVERO STAGING TEST | Görünmez |
| ADH Evraklar listesi | İndekslenen PDF’ler görünür |
| Drive’da Aç | ADH belgesi açılır |
| Upload / sync / klasör kontrolü (ADH) | İzinli |
| Başka companyId ile API | 403 |
| Firma oluştur/sil | 403 |
| Klasör ağacı oluştur (POST folders) | 403 (mükellef) |
| Drive bağlantısını kaldır | 403 (mükellef) |
| `/admin`, Sistem Yönetimi nav | Görünmez / route guard |
| `_ANNVERO` | Listelenmez / açılamaz |

## Otomatik testler

- `npm run test:security` — ADH tenant fixture + route guard statikleri
- `node --import ./scripts/_alias-loader.mjs ./scripts/test-cloud-storage-evrak-havuzu.mjs`

## Tarayıcı girişi (operatör)

1. Staging preview URL’yi açın (feature/drive-adh-pilot deploy).
2. `yusufozlu+adhpilot@gmail.com` ile giriş yapın (davet e-postasındaki bağlantı veya mevcut parola).
3. Firma Yönetimi → yalnız **ADH AVRASYA** görünmeli.
4. Evraklar sekmesi → indekslenmiş belgeler listelenmeli.
5. Bulut Depolama → upload/sync deneyin; başka firma ID’si ile API çağrısı 403 dönmeli (DevTools Network).
