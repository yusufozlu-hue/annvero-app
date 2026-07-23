# Staging Tenant Isolation Drill — 2026-07-22

Operatör tatbikat kanıtı. Bu dosya agent tarafından staging’e bağlanılarak üretilmedi; verilen same-origin / RLS / cleanup sonuçları özetlenir.

**Secret, token, cookie, parola veya HMAC değeri içermez.**

## Scope

| Alan | Değer |
|------|--------|
| Branch | `security/staging-hardening` |
| Final doğrulama build / HEAD | `66c35a5` |
| Uygulama | `https://annvero-staging.vercel.app` |
| Supabase staging ref | `bveipjvbopbkvojfdpmo` |
| Production | Kullanılmadı (`www.annvero.com` / ref `ttxigznwcjvrlzuppbro` yok) |

## Actors

| Actor | Kimlik | Not |
|-------|--------|-----|
| Proof user | UUID `1fb8c953-ed5a-4d13-9a46-f69619cc11d6` | Rol `goruntuleme`; canonical kaynak `annvero_company_members` |
| Firma A | `00000000-0000-4000-8000-000000000001` | Aktif membership korundu |
| Sentetik firma B | `00000000-0000-4000-8000-eeeeeeeeee01` | Ad: `ANNVERO_SECURITY_SMOKE_TENANT_B`; membership eklenmedi; tatbikat sonunda silindi |

## Same-origin HTTP (PASS_STAGE2_AUTH)

| Kontrol | Sonuç |
|---------|--------|
| `GET /api/auth/me` | 200 |
| `authenticated` | `true` |
| `role` | `goruntuleme` |
| `companyIdsSource` | `membership` |
| Firma A in `companyIds` | `true` |
| Firma B in `companyIds` | `false` |
| `companyIds` count | `1` |
| GİB `companyId=B` | **403** |
| `GET /api/admin/users` | **403** |
| Firma B company-export | **403** |
| Stage sonucu | **PASS_STAGE2_AUTH** |

## Authenticated RLS

| Alan | Sonuç |
|------|--------|
| `execution_role` | `authenticated` |
| `auth.uid()` | proof user UUID (yukarıdaki) |
| `firm_a_visible` | `1` |
| `firm_b_visible` | `0` |

## Anon / grant

| Alan | Sonuç |
|------|--------|
| `anon_has_select` | `false` |
| `authenticated_has_select` | `true` |
| `rls_enabled` | `true` |

## Cleanup

| Adım | Sonuç |
|------|--------|
| Exact cleanup (firma B) | Başarılı |
| Final: `company_b_rows` | `0` |
| Final: `membership_b_rows` | `0` |
| Final: `user_a_membership_rows` | `1` |
| İkinci yanlışlıkla cleanup | `CLEANUP_ABORTED` (contract mismatch; firma B yok) — **fail-closed** |
| Rollback | Başarılı |
| `CASCADE` | Kullanılmadı |
| Production / firma A verisi | Değiştirilmedi |

## Classification

| Sınıf | Sonuç |
|-------|--------|
| Tenant HTTP isolation | **PASS** |
| Canonical membership isolation | **PASS** |
| Authenticated RLS isolation | **PASS** |
| Anonymous direct table access | **PASS** |
| Synthetic data cleanup | **PASS** |
| Production impact | **NONE** |

## Explicit non-claims

- Bu tatbikat **staging** kapsamındadır.
- **Production tenant izolasyonu uygulanmadı** ve bu raporla production-ready ilan edilmez.
- Production deploy / migration onayı hâlâ bekliyor.
- Paket tamamen production-ready **değildir**.
