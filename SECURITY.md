# ANNVERO Security

Production güvenlik özeti. Gerçek secret, token veya müşteri verisi içermez.

## Mimari

- **App:** Next.js (Vercel)
- **DB/Auth:** Supabase / PostgreSQL
- **Automation:** Railway (GİB), opsiyonel n8n webhook
- **Tenant izolasyonu:** API guard (`apiGuard`) + RLS policies + `annvero_company_members` (023)

## Temel kurallar

1. `SUPABASE_SERVICE_ROLE_KEY` ve encryption key'ler **yalnız server-only** katmanda.
2. Client'tan gelen `role`, `isAdmin`, `companyId` **güvenilmez**; sunucu doğrular.
3. `user_metadata.role` ile admin olunamaz; profil + `app_metadata` + email allowlist.
4. Yerel/test ortamında bilinen production (`ttxigznwcjvrlzuppbro`) / staging (`bveipjvbopbkvojfdpmo`) ref **fail-closed**.
5. Production secret'ları Cursor/AI erişebilen dosyalara yazılmaz.
6. Migration'lar ileri yönlüdür; remote push bu repodan otomatik yapılmaz.

## Hızlı komutlar

```bash
npm run security:ci
npm run test:security
npm run backup:dry-run
```

## Dokümanlar

- [Threat model](docs/security/THREAT_MODEL.md)
- [Production checklist](docs/security/PRODUCTION_SECURITY_CHECKLIST.md)
- [DR report](docs/security/PRODUCTION_SECURITY_DR_REPORT.md)
- [Backup policy](docs/disaster-recovery/BACKUP_POLICY.md)
- [Restore runbook](docs/disaster-recovery/RESTORE_RUNBOOK.md)
- [Incident response](docs/disaster-recovery/INCIDENT_RESPONSE.md)

## Ortam

Şablon: `.env.example`
Public env'de `service_role` / encryption key **yasak**.

## Rate limit

- Adapter: `src/lib/security/rateLimitDurable.js`
- Upstash env varsa kullanılır; yoksa memory (serverless'ta zayıf) veya `rate_limit_buckets` (migration 024)
- Production aktivasyonu: kullanıcı secret tanımı gerekir

## CSP notu

`script-src 'unsafe-inline'` (ve dev'de `unsafe-eval`) mevcut Next.js hydrate için bilinçli. Ayrıntı: `CSP_UNSAFE_USAGE_REPORT`.
