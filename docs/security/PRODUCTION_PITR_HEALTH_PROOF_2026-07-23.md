# Production PITR ve Sağlık Kanıtı — 2026-07-23

## Kapsam

Bu kayıt, production Supabase compute/PITR değişikliği sonrasındaki operatör ekran kanıtlarını ve salt okunur uygulama sağlık kontrolünü özetler.

| Alan | Değer |
|------|-------|
| Ortam | Production |
| Supabase project ref | `ttxigznwcjvrlzuppbro` |
| Uygulama build | `83b61e3` (değişmedi) |
| Tarih | 2026-07-23 |
| Production SQL / migration | **NONE** |
| PR merge / application deploy | **NONE** |

## Onaylı değişiklikler

| Madde | Sonuç |
|-------|-------|
| Compute | **Small** · 2 GB memory · 2-core CPU |
| Compute değişikliği | Nano → Small; panelde başarıyla tamamlandı |
| PITR | **ENABLED** |
| PITR saklama süresi | **7 gün** |
| Staging PITR | Değişmedi / kapalı |
| Production maliyet kararı | Ürün sahibi tarafından açıkça onaylandı |

## Değişiklik sonrası sağlık kontrolü

| Kontrol | Sonuç |
|---------|-------|
| Production ana web sayfası | **PASS** |
| Login / session | **PASS** |
| `/dashboard` yüklenmesi | **PASS** |
| Firma seçici ve firma listesi | **PASS** |
| Uygulama ↔ Auth/DB bağlantısı | **PASS** (oturum ve firma listesinin okunmasıyla doğrulandı) |
| Production build hash | `83b61e3` — değişmedi |
| Test sırasında veri yazma/silme | **NONE** |

## Kanıt sınırları

- Bu kontrol login, dashboard ve firma listesinin salt okunur yüklenmesini kanıtlar.
- Production admin AND-gate, tenant A/B, GİB cross-tenant, migration 024/025 ve Storage restore kanıtı değildir.
- PITR etkinliği Storage nesnelerini kapsamaz; production Storage inventory/live/restore kapıları ayrıca açıktır.
- Bu kayıt PR merge, production deploy veya SQL/migration onayı vermez.

## Sonuç

Production compute değişikliği sonrası temel uygulama sağlığı **PASS** ve 7 günlük PITR **ENABLED** olarak doğrulandı. Production cutover genel kararı, kalan güvenlik ve migration kapıları tamamlanana kadar **NO-GO** kalır.
