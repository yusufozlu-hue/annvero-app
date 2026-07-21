# ANNVERO Threat Model

## Varlıklar

| Varlık | Etki |
|--------|------|
| Firma muhasebe / mutabakat verisi | Yüksek — tenant gizliliği |
| GİB kimlik bilgileri (şifreli) | Kritik — resmi portal erişimi |
| Kullanıcı oturumları | Yüksek — yetkisiz işlem |
| Audit / login event'leri | Orta — adli iz |
| Yedekler | Kritik — felaket kurtarma |

## Aktörler

- Yetkili ofis kullanıcısı (firma üyesi)
- Yönetici / partner
- Yetkisiz internet kullanıcısı
- Kötü niyetli tenant kullanıcısı (BOLA denemesi)
- Sızdırılmış service_role veya encryption key sahibi

## Önemli tehditler

### P0

1. **Cross-tenant erişim (BOLA):** `companyId` manipülasyonu → `assertCompanyAccess` + membership
2. **Auth bypass:** `user_metadata.role=admin` → artık app_metadata/allowlist/profil
3. **Secret sızıntısı:** client bundle / public env / log
4. **Veri kaybı:** yedeksiz production, destructive migration

### P1

5. Serverless in-memory rate limit etkisizliği
6. CSRF / missing security headers
7. Export içinde şifreli alanların sızması
8. Açık webhook (secret yokken)

### P2

9. CSP unsafe-inline
10. Malware tarama yok
11. Operasyonel gözlemlenebilirlik eksikleri

## Kontroller (kod)

| Kontrol | Konum |
|---------|--------|
| Session + company guard | `src/lib/auth/apiGuard.js` |
| Env fail-closed | `src/lib/security/envGuard.js` |
| Redaction | `src/lib/security/redact.js` |
| CSRF same-origin | `src/lib/security/csrf.js` |
| Security headers | `next.config.ts` + `securityHeaders.js` |
| Durable rate limit | `rateLimitDurable.js` |
| Soft delete / restore | `softDelete.js`, `recovery/*` |
| Encryption fail-closed | GİB crypto + `encryptionService.js` |
| Migration 024 | `024_security_dr_hardening.sql` |

## Kabul edilen riskler (geçici)

- Production Upstash yoksa rate limit instance-local kalır → kullanıcı aktivasyonu
- PITR durumu panelden doğrulanmadan "aktif" sayılmaz
- İkinci immutable yedek hedefi kurulmadan DR tamamlanmış sayılmaz
