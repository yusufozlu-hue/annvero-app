# Service-role API route auth inventory

Generated for closure audit. `service_role` RLS bypass eder; koruma API guard’dadır.

| Route | Guard |
|-------|--------|
| `admin/users` | `requireManagementUser` / admin |
| `backup/company-export` | `requireManagementApi` + company access |
| `recovery/deleted-records` | `requireManagementApi` |
| `recovery/restore` | `requireManagementApi` + CSRF + RECOVERY_API_ENABLED + entity allowlist |
| `companies` | `requireManagementUser` |
| `companies/migrate` | `requireManagementUser` |
| `gib-credentials` | `requireApiSession` + `assertCompanyAccess` + rate limit |
| `gib-tebligat/*` | `requireApiSession` + company where needed |
| `learning-memory` | session + company scope |
| `transaction-memory` | session + company scope |
| `reconciliation-matches` | session + company scope |
| `learned-bank-rules` | session + company |
| `bank-card-ops` | session |
| `official-notifications*` | session + company |
| `gib-check-reminders` | session |
| `google-drive/*` | session + company |
| `knowledge/builder` | session + company |
| `core/accounting-decision` | session + company |
| `dev/core-test` | session + management/dev |
| `mevzuat-hap-notlari` | session; mutate admin |
| `push-subscriptions` | session (user.id) |

Statik kontrol: `npm run security:check-routes` (critical + service-role inventory).
