# Staging Admin AND-Gate Drill — 2026-07-22

Operatör tatbikat kanıtı. Secret, token, cookie, parola veya `/api/admin/users` yanıt gövdesi içermez.

## Scope

| Alan | Değer |
|------|--------|
| Vercel projesi | `annvero-staging` (ayrı proje) |
| URL | `https://annvero-staging.vercel.app` |
| Build | `118f660` |
| Supabase staging ref | `bveipjvbopbkvojfdpmo` |
| Gerçek production | Kullanılmadı (`annvero-app` / ref `ttxigznwcjvrlzuppbro` yok) |

Proof kullanıcı e-posta (maskeli): `y***@gmail.com`

## Negatif kanıt (allowlist yok)

| Madde | Değer |
|-------|--------|
| Trusted `app_metadata.role` | `admin` |
| `user_metadata.role` | boş |
| DB profil rolü | `goruntuleme` (aktif) |
| `ANNVERO_ADMIN_EMAILS` (staging Vercel) | **tanımlı değil** |
| `GET /api/admin/users` | **403** |

**Sonuç:** `app_metadata.admin` tek başına admin yetkisi vermedi.

## Pozitif kanıt (allowlist + trusted app_metadata)

| Madde | Değer |
|-------|--------|
| `ANNVERO_ADMIN_EMAILS` | Yalnız `annvero-staging` Vercel projesinin **Production** ortamına eklendi |
| “Production” etiketi anlamı | Staging projesinin aktif Vercel ortamı; gerçek `annvero-app` production **değil** |
| Redeploy | Aynı staging branch/build yeniden deploy; kullanıcı logout/login |
| Same-origin DevTools (salt okunur) | aşağıda |

| Rapor alanı | Değer |
|-------------|--------|
| `REPORT_ME_STATUS` | `200` |
| `REPORT_AUTHENTICATED` | `true` |
| `REPORT_ROLE` | `admin` |
| `REPORT_ADMIN_USERS_STATUS` | `200` |
| `REPORT_RESULT` | `PASS_ADMIN_AND_POSITIVE` |

`/api/admin/users` yanıt gövdesi **kaydedilmedi**.

**Sonuç:** Admin erişimi yalnız allowlist e-posta **AND** trusted `app_metadata.admin` birlikteyken açıldı.

## Truth table

| Durum | Admin yetkisi |
|-------|----------------|
| Allowlist yok + `app_metadata.admin` | Admin değil → **403** |
| Allowlist var + `app_metadata.admin` yok | Admin değil |
| Allowlist var + `app_metadata.admin` | Admin → **200** |
| `user_metadata.admin` | Yetki kaynağı **değil** |
| DB profile `role=admin` tek başına | Yetki kaynağı **değil** |

## Non-claims

- Production admin testi **yapılmadı**.
- Production env **değiştirilmedi**.
- SQL / migration **uygulanmadı**.
- Admin kullanıcı listesi veya başka hassas response body **kaydedilmedi**.
- Bağımsız `mevzuat-hap-notlari` 401 bu testin parçası **değildir**.
- Bu tatbikat production-ready ilanı **değildir**.
- Production impact: **NONE**
