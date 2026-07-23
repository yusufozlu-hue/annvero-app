# Staging Database Restore Drill — 2026-07-22

Operatör tatbikat kanıtı. Secret / connection string içermez.

## Scope

| Alan | Değer |
|------|--------|
| Kaynak | Staging Supabase ref `bveipjvbopbkvojfdpmo` |
| Kaynak yedek | 21 Jul 2026 23:25:02 UTC |
| Restore projesi | `annvero-staging-restore-drill-20260722` |
| Restore başlangıcı | 22 Jul 2026 13:18:03 UTC |
| Healthy gözlemi | 22 Jul 2026 13:25:26 UTC |
| Gözlenen RTO | ≤ 7 dakika 23 saniye |
| Region | `eu-central-1` |
| Ek aylık maliyet (geçici proje) | $10.18/ay — proje silindiği için artık aktif değil |
| Sonuç | **PASS** |
| Cleanup | **COMPLETED** (2026-07-22) |
| Production impact | **NONE** |

Gerçek production (`annvero-app` / ref `ttxigznwcjvrlzuppbro`) kullanılmadı.

## Cleanup (2026-07-22)

| Madde | Sonuç |
|-------|--------|
| Geçici restore projesi | `annvero-staging-restore-drill-20260722` **kalıcı silindi** |
| Proje listesinde görünürlük | Artık yok |
| Kaynak `annvero-staging` / ref `bveipjvbopbkvojfdpmo` | Etkilenmedi |
| Geçici $10.18/ay kaynağı | Artık aktif değil |
| Faturalanmış tutar / iade | Kanıtsız iddia yok (bu raporda belirtilmez) |
| Production impact | **NONE** |

## Kapsam dışı

- Storage objects / settings yedekleme ve restore **bu tatbikatta kanıtlanmadı**
- PITR **etkin değil** (kaynak/restore gözlemi)

## Şema / veri kontrolü — PASS

| Kontrol | Sonuç |
|---------|--------|
| Kritik 5 tablo mevcut | PASS |
| Rate-limit RPC mevcut | PASS |
| Firma A satır | `1` |
| Auth user | `1` |
| Aktif profil | `1` |
| Aktif membership A | `1` |
| Sentetik firma B | `0` |

## Güvenlik kontrolü — PASS

| Kontrol | Sonuç |
|---------|--------|
| İlk 8 kontrol | `true` |
| Restrictive deny policy count | `9` |

## Açık riskler / non-claims

- **PITR kapalı** — point-in-time recovery bu tatbikatta kanıtlanmadı.
- **Storage yedekleme/restore** bu tatbikatta kanıtlanmadı.
- **Production restore uygulanmadı** — staging-only; production DR onayı bekliyor.
- Bu tatbikat production-ready ilanı **değildir**.
