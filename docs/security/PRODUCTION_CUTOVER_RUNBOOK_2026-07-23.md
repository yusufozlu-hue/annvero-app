# Production Cutover Runbook — Security/DR Paketi (2026-07-23)

**Bu belge plan/runbook’tur. Uygulama yoktur.**
Hiçbir adım **açık kullanıcı onayı** + chat’te **`deploy onayla`** (ve ilgili SQL/migration onayı) olmadan çalıştırılmaz.

## 0. Kilitler

| Kilit | Değer |
|-------|--------|
| Staging branch HEAD (kanıtlı) | `473aa77a1ad8e2f878a9aa2a365b7d21c37b9af5` |
| `origin/main` (dokunulmamış) | `83b61e318ff4702f0e15e5b3232eeef944c34b5d` |
| Staging Supabase ref | `bveipjvbopbkvojfdpmo` |
| Production Supabase ref | `ttxigznwcjvrlzuppbro` |
| Production uygulama | `www.annvero.com` / Vercel production (`annvero-app`) |
| Staging uygulama | `annvero-staging` (ayrı proje) |

### Yasaklar (uygulama turunda)

- Production’a agent/SQL bağlanması **onaysız yasak**
- `supabase db push` / kör migration runner **yasak**
- Force push, hard reset, `main`’e merge onaysız **yasak**
- Gerçek kullanıcı satırı/Storage objesi silme veya “temizlik” **yasak**
- Secret değerlerini chat/log’a yazmak **yasak**
- Bu runbook’taki hiçbir faz **`deploy onayla` olmadan** uygulanmaz

### Staging’de kanıtlanmış (production sayılmaz)

| Kanıt | Sonuç | Kaynak |
|-------|--------|--------|
| DB migration 024+025 | PASS | `STAGING_MIGRATION_APPLICATION_REPORT_2026-07-21.md` |
| Tenant isolation | PASS | `STAGING_TENANT_ISOLATION_DRILL_2026-07-22.md` |
| Admin AND-gate | PASS | `STAGING_ADMIN_AND_GATE_DRILL_2026-07-22.md` |
| DB restore drill | PASS | `STAGING_DATABASE_RESTORE_DRILL_2026-07-22.md` |
| Storage manuel drill | PASS | `STAGING_STORAGE_BACKUP_RESTORE_DRILL_2026-07-22.md` |
| Otomatik Storage backup live | PASS | Actions run `29994737249` @ `473aa77` |
| Immutable S3 ikinci hedef (staging) | PASS | `STAGING_IMMUTABLE_S3_BACKUP_2026-07-23.md` — run `30004604101` / job `89201131433` |
| Staging PITR | kapalı — **maliyet nedeniyle kabul edilmiş açık risk** (~100 USD/ay/proje); staging’de açılmayacak | operatör kararı |
| Production PITR | şimdi açılmayacak; cutover’da **bütçe/onay kapısı** (~100 USD/ay/proje) | ayrı açık onay |
| Günlük fiziksel DB backup | aktif (operatör beyanı) | panel/operasyon |

---

## 1. Production’a uygulanacak değişiklikler (exact sıra)

### 1.1 Kod / deploy sırası (uygulama onayı sonrası)

1. Preflight + yedek kapıları (Faz A–B) **PASS**
2. Production Vercel env doğrulama (secret **adları**; değer yok)
3. Application deploy yolu (**doğrudan `main` push yok**):
   `security/staging-hardening` → **PR** → diff kontrolü → kontrollü merge → production deploy
   (PR/merge açık onayı ayrı; bu runbook merge yapmaz)
4. DB: salt okunur preflight `STAGING_SCHEMA_PREFLIGHT_READ_ONLY.sql` üretim eşdeğeri (production ref)
5. DB migration **024** (`024_security_dr_hardening.sql`) — SQL Editor, `postgres`, `BEGIN`…`COMMIT`
6. DB migration **025** (`025_security_view_indexes_grants.sql`) — aynı yöntem
7. Postflight: CONFLICT=0, MISSING=0; 024/025 `ALREADY_APPLIED` veya READY→applied
8. Güvenlik doğrulamaları + smoke (Faz D–E)
9. İzleme (Faz F) → Go/No-Go (Faz G)

### 1.2 Migration önkoşul zinciri (production DB)

| Sıra | Dosya | Not |
|------|--------|-----|
| 0 | 020 → 021 → 022 → 023 | Önceden uygulanmış olmalı; eksikse **DUR** (önce ayrı onaylı kapanış) |
| 1 | `024_security_dr_hardening.sql` | Rate-limit RPC, audit, restrictive deny, restore approvals, soft-delete kolonları |
| 2 | `025_security_view_indexes_grants.sql` | Index/grant/policy doğrulama; önkoşul 024 |
| opsiyonel | `REMEDIATION_SQL_REQUIRES_APPROVAL.sql` | **Ayrı açık onay**; kör çalıştırma yok |

SHA (staging uygulaması ile aynı dosyalar; uygulama öncesi yeniden hash doğrula):

| Dosya | Staging’de kaydedilen SHA-256 |
|-------|-------------------------------|
| 024 | `E5EDD3DB3DACE342381C9AD83FD7BB5AD5C1868D908E4FBA4E04006F5954AD87` |
| 025 | `21B2A5FC4D6E1607E2B10C4989E7DCD60D1D87AF380DBC75621A684C301781D5` |

---

## 2. Adım şablonu (her üretim işlemi)

Her adım için doldurulacak alanlar:

| Alan | Anlam |
|------|--------|
| Ön koşul | Önceki PASS + onay |
| İşlem | Ne yapılır |
| Salt okunur ön kontrol | Bağlantı/ref/yedek/hash |
| Beklenen sonuç | Ne görülmeli |
| PASS | Kabul |
| FAIL | Red |
| Rollback | Geri dönüş |
| DUR | Hemen dur koşulları |

---

## Faz A — Salt okunur preflight

### A1. Ref ve ortam ayrımı

| Alan | İçerik |
|------|--------|
| Ön koşul | Operatör production panel erişimi; agent production’a bağlı değil |
| İşlem | Dashboard’da project ref = `ttxigznwcjvrlzuppbro` olduğunu görsel doğrula; staging `bveipjvbopbkvojfdpmo` ile karıştırma |
| Ön kontrol | Vercel production projesi ≠ `annvero-staging` |
| Beklenen | Ref eşleşmesi; Preview secret’ları production ile **paylaşılmıyor** |
| PASS | Ref doğru; izolasyon notu yazılı |
| FAIL | Yanlış proje / shared Preview secret şüphesi |
| Rollback | N/A (salt okunur) |
| DUR | Herhangi bir staging credential production’a yazılacaksa |

### A2. Kod/migration hash preflight

| Alan | İçerik |
|------|--------|
| Ön koşul | Cutover branch/commit sabitlenmiş |
| İşlem | 024/025 dosya SHA-256 = tablodaki değerler |
| Ön kontrol | `git rev-parse` cutover SHA; dirty forbidden dosyalar commit’te değil |
| PASS | Hash eşleşir |
| FAIL | Hash sapması |
| DUR | Sapma varsa migration **uygulama** |

### A3. Schema preflight (read-only SQL)

| Alan | İçerik |
|------|--------|
| Ön koşul | A1–A2 PASS; açık SQL okuma onayı |
| İşlem | `docs/security/STAGING_SCHEMA_PREFLIGHT_READ_ONLY.sql` (veya prod kopyası) production SQL Editor’de **yalnız SELECT/katalog** |
| Beklenen | 020–023 READY/ALREADY_APPLIED; 024/025 henüz MISSING veya not applied; CONFLICT=0 |
| PASS | Önkoşul migration’lar tamam; CONFLICT yok |
| FAIL | 020–023 eksik / CONFLICT |
| Rollback | N/A |
| DUR | CONFLICT>0 veya 023 üyelik kaynağı yok |

---

## Faz B — Backup ve rollback hazırlığı (zorunlu)

### B1. Fiziksel DB backup (Supabase managed)

| Alan | İçerik |
|------|--------|
| Ön koşul | A PASS; günlük backup’ın **aktif** olduğu teyit |
| İşlem | Cutover öncesi son başarılı fiziksel yedeğin zaman damgasını kaydet; mümkünse manuel snapshot/backup tetikle (panel) |
| Ön kontrol | Yedek listesinde cutover-öncesi kayıt var |
| PASS | ≤24s RPO hedefi içinde taze yedek var |
| FAIL | Yedek yok / çok eski |
| Rollback | N/A (yedek alma) |
| DUR | Taze fiziksel yedek yokken migration **yasak** |

### B2. Database restore kanıtı (policy)

| Alan | İçerik |
|------|--------|
| Ön koşul | Staging restore drill PASS (mevcut) |
| İşlem | Production için: **izole** restore projesi planı hazır (üretim DB’ye restore **yasak**); kriz runbook = `RESTORE_RUNBOOK.md` |
| PASS | İzole restore prosedürü yazılı; RTO hedefi ≤4s (tatbikatla kanıtlanana kadar “hedef”) |
| FAIL | Prosedür yok |
| DUR | “Production’a doğrudan restore” önerisi |

### B3. Storage object backup + manifest/checksum

| Alan | İçerik |
|------|--------|
| Ön koşul | Staging auto Storage backup PASS (`29994737249`) |
| İşlem | Production Storage için: envanter + object-level yedek planı (drill-only değil; **read-only kopya**); manifest SHA-256 |
| PASS | Manifest + checksum prosedürü ve saklama yeri tanımlı |
| FAIL | Storage yedeksiz cutover |
| DUR | Kullanıcı bucket’larında silme/mutate içeren “yedek” |

### B4. İkinci immutable hedef (karar kapısı)

| Alan | İçerik |
|------|--------|
| Staging | **PASS** — `STAGING_IMMUTABLE_S3_BACKUP_2026-07-23.md` (OIDC environment subject; 3 object; COMPLIANCE / 35g) |
| Production kapısı | Staging PASS production sayılmaz; prod eşleniği yapılandırılmalı **veya** yazılı risk kabulü |
| İşlem | Object-lock / WORM S3 + OIDC (access key yok; DeleteObject yok) + cutover sonrası prod eşleniği |
| PASS (prod kapı) | Prod hedef yapılandırıldı **veya** yazılı risk kabulü |
| FAIL | Prod hedef yok ve risk kabulü yok |
| DUR (öneri) | Tam "production-ready DR" ilanı için prod immutable **veya** yazılı risk kabulü olmadan **Go** verme |
| Not | Staging key: `staging/<date>/<run_id>/…`; COMPLIANCE ~35g; access key yok |

### B5. Rollback paketi

| Alan | İçerik |
|------|--------|
| İşlem | (1) Önceki Vercel production deployment’a rollback prosedürü (2) DB: forward-only → geri alma = **izole restore**, schema drop yok (3) Feature flag: `RECOVERY_API_ENABLED` production’da bilinçli |
| PASS | Rollback sahipleri + iletişim kanalı yazılı |
| DUR | Rollback sahibi yok |

---

## Faz C — Migration uygulaması

> **Açık onay + `deploy onayla` (ve SQL onayı) olmadan C başlamaz.**

### C0. Application deploy (kod)

| Alan | İçerik |
|------|--------|
| Ön koşul | B PASS; cutover commit sabit |
| İşlem | Production Vercel’e güvenlik paketi kodunu al (merge/deploy stratejisi ayrı onay) |
| Beklenen | Build hash = cutover Git SHA; `ANNVERO build: [hash]` eşleşir |
| PASS | Production build yeşil; hash eşleşir |
| FAIL | Build fail / hash sapması |
| Rollback | Önceki Vercel deployment |
| DUR | Build fail iken migration’a geçme |

### C1. Migration 024

| Alan | İçerik |
|------|--------|
| Ön koşul | C0 PASS; A3 PASS; B1 PASS; dosya SHA eşleşir |
| İşlem | SQL Editor Role `postgres`; tek transaction `BEGIN` … 024 gövdesi … `COMMIT` |
| Ön kontrol | Ref = `ttxigznwcjvrlzuppbro`; yanlış projede **DUR** |
| Beklenen | Success / COMMIT; hata yok |
| PASS | COMMIT; postflight 024 applied |
| FAIL | Exception / ROLLBACK |
| Rollback | Transaction COMMIT olmadıysa otomatik yok; COMMIT sonrası → izole restore planı |
| DUR | 42883 veya herhangi EXCEPTION; ikinci kör deneme yok (önce kök neden) |

### C2. Migration 025

| Alan | İçerik |
|------|--------|
| Ön koşul | C1 PASS |
| İşlem | Aynı yöntemle 025 |
| PASS | COMMIT; postflight 025 applied; CONFLICT=0 MISSING=0 |
| FAIL / DUR | C1 ile aynı kurallar |

### C3. Postflight

| Alan | İçerik |
|------|--------|
| İşlem | Preflight SQL yeniden; 024/025 ALREADY_APPLIED; restrictive deny sayımı; rate-limit RPC var |
| PASS | CONFLICT=0 MISSING=0 |
| FAIL | CONFLICT/MISSING |
| DUR | Postflight FAIL → smoke’a geçme; incident kanalı |

---

## Faz D — Güvenlik doğrulamaları

### D1. Production admin AND-gate

Staging kanıtı production sayılmaz. Plan:

| Adım | Negatif | Pozitif |
|------|---------|---------|
| 1 | Trusted `app_metadata.role=admin` + **allowlist yok/yanlış** → `GET /api/admin/users` **403** | Allowlist (yalnız production Vercel server env) + trusted `app_metadata.admin` → **200** |
| 2 | `user_metadata.role=admin` tek başına → **403** | Body loglanmaz / kaydedilmez |
| 3 | DB `role=admin` tek başına → **403** | Logout/login sonrası tekrar |

| PASS | Negatif 403 + pozitif 200; truth = allowlist AND trusted app_metadata |
| FAIL | OR davranışı / 500 / allowlist sızıntısı |
| DUR | Pozitif test için production allowlist’e yanlış e-posta yazmak; test sonrası gereksiz adres bırakmak |
| Guard | Yalnız onaylı proof admin e-postası; değerleri chat’e yazma |

### D2. Tenant izolasyon (Firma A / Firma B)

| Actor | Kurulum |
|-------|---------|
| Proof user | `goruntuleme` + yalnız Firma A membership |
| Firma A | Mevcut gerçek veya önceden tanımlı test firması (**silinmez**) |
| Firma B | Mümkünse **sentetik** firm + **membership yok**; bitişte sentetik satırlar silinir; A’ya dokunulmaz |

Kontroller (same-origin, authenticated):

| # | Kontrol | PASS |
|---|---------|------|
| 1 | `/api/auth/me` | A ∈ companyIds; B ∉ |
| 2 | GİB `companyId=B` | **403** (tenant guard encryption/DB’den önce) |
| 3 | company-export B | **403** |
| 4 | admin (non-admin user) | **403** |
| 5 | RLS: A görünür, B görünmez | visible A≥1, B=0 |
| 6 | Anon select kritik tablolar | grant yok / fail-closed |
| 7 | Cleanup | Yalnız sentetik B; A membership korunur; CASCADE yok |

| DUR | Gerçek müşteri firmasını “B” olarak kullanıp silmeye kalkmak |

### D3. Kontroller sırası (minimum)

| Sıra | Alan | Nasıl | PASS |
|------|------|-------|------|
| 1 | CSRF / Origin | State-changing POST without origin | 403/fail-closed |
| 2 | Security headers | Production response | headers mevcut (`next.config`) |
| 3 | Webhook | Secret yok / bad HMAC | fail-closed (401/403); raw secret log yok |
| 4 | Rate limit | GİB/export burst | 429 veya durable deny; memory fallback production’da yok |
| 5 | RLS | D2 + policy envanteri spot check | restrictive deny mevcut |
| 6 | Audit | Örnek admin/restore denemesi | `request_id` / immutable policy |
| 7 | Recovery | `RECOVERY_API_ENABLED` unset | 503 fail-closed |
| 8 | Export masking | Company export | GİB ciphertext düz export yok; redaksiyon |
| 9 | GİB tenant guard | Cross-tenant | 403; sıra: access → encryption → DB |

---

## Faz E — Production smoke (minimum, geri alınabilir)

| # | Smoke | Yan etki | PASS |
|---|-------|----------|------|
| 1 | Login + `/api/auth/me` | Yok | authenticated=true; membership kaynağı |
| 2 | Firma seçici A | Yok | A listelenir |
| 3 | Unauth kritik API | Yok | 401 |
| 4 | Cross-tenant B | Yok | 403 |
| 5 | Admin AND (D1) | Allowlist geçici ise geri al | 403/200 planı |
| 6 | Health/build badge | Yok | hash = cutover |
| 7 | Soft-delete **yapma** | — | Bu smoke’ta silme yok |
| 8 | Recovery restore **yapma** | — | Yalnız gate 503 kontrolü |

| DUR | Canlı muhasebe verisi yazan “test” fişi; gerçek evrak silme |

---

## Faz F — İzleme

| Pencere | Ne |
|---------|-----|
| T+0–2s | Vercel error rate, 5xx, build hash |
| T+0–24s | Auth fail spike, webhook rejects, rate-limit 429 oranı |
| T+24s | Fiziksel DB backup başarısı; Storage yedek job (varsa) |
| Kanal | Ops sahibi + rollback kararı |

---

## Faz G — Go / No-Go

### Go (hepsi gerekir)

- [ ] A–F kritik maddeler PASS
- [ ] 024+025 postflight CONFLICT=0
- [ ] Admin AND + tenant A/B PASS
- [ ] Recovery default-off doğrulandı
- [ ] Fiziksel DB backup taze
- [ ] Storage yedek politikası tanımlı
- [ ] Production immutable ikinci hedef **veya** yazılı risk kabulü
  (staging S3 PASS production sayılmaz)
- [ ] PITR kararı belgelendi (etkin **veya** erteleme + maliyet onayı)
- [ ] `deploy onayla` + SQL onayları kayıtlı

### No-Go / DUR

- Yanlış Supabase ref
- Migration EXCEPTION
- Admin OR davranışı
- Cross-tenant 200
- Secret log sızıntısı
- Kullanıcı verisi silindi/değişti (beklenmeyen)
- Build hash uyuşmazlığı

---

## 3. PITR (maliyetli karar — şimdi etkinleştirme yok)

| Madde | Değer |
|-------|--------|
| Staging | Kapalı; ~100 USD/ay/proje nedeniyle bilinçli ertelendi |
| Production | **Bu plan PITR’yi otomatik açmaz** |
| Karar | Ürün sahibi: (a) Production PITR aç + bütçe onayı (b) Kapalı bırak + risk kabulü + fiziksel yedek/RPO belgesi |
| Go etkisi | Tam “DR production-ready” için PITR veya eşdeğer RPO yazılı kabul şart |

---

## 4. İkinci immutable Storage hedefi (karar kapısı)

| Madde | Değer |
|-------|--------|
| Staging | **PASS** (live S3; Object Lock COMPLIANCE / 35g; OIDC; delete yok) |
| Production | **Açık** — staging kanıtı production sayılmaz |
| Minimum (prod) | Object-lock bucket + OIDC write-only rol + Environment vars (`BACKUP_SECONDARY_S3_*`) |
| Olmadan (prod) | Production “complete immutable backup” **ilan edilmez** (yazılı risk kabulü yoksa) |
| İlk staging FAIL | Trust sub/ref → environment subject + Environment branch restriction ile düzeltildi |

---

## 5. Kullanıcı verisi koruma guard’ları

1. Production’da **yalnız sentetik** tenant B; gerçek müşteri firması silinmez.
2. Storage drill bucket prefix: production’da ayrı `annvero-prod-security-drill-*` (kullanıcı bucket’larına yazma/silme yok).
3. Migration’larda `DROP TABLE` / destructive SQL yok (024/025 sözleşmesi).
4. Soft-delete / recovery smoke’ta **yazma yok** (gate kontrolü).
5. Export testinde PII/secret body kaydedilmez.
6. Cleanup fail-closed: şüphede abort; CASCADE yok.

---

## 6. Onay matrisi

| Onay | Ne için |
|------|---------|
| `deploy onayla` | Her production deploy / cutover uygulama turu |
| SQL/migration açık onay | 024, 025, REMEDIATION |
| Merge/`main` açık onay | **PR** `security/staging-hardening` → `main` + diff + kontrollü merge (**doğrudan push yok**) |
| PITR bütçe onayı | ~100 USD/ay/proje; production etkinleştirme ayrı — staging PITR açılmayacak (risk kabulü) |
| Immutable S3 onayı | Production ikinci hedef kurulumu (staging PASS production sayılmaz) |
| Risk kabulü | Production PITR veya immutable ertelenirse yazılı |

**Deploy hook’unun genel kirli-dosya kuyruğu yok sayılır; allowlist dışı commit yasak.**

---

## 7. Tahmini süre (operatör)

| Faz | Süre (tahmini) |
|-----|----------------|
| A Preflight | 30–60 dk |
| B Backup/rollback | 45–90 dk |
| C Deploy + 024/025 | 60–120 dk |
| D Güvenlik | 60–90 dk |
| E Smoke | 30–45 dk |
| F İzleme | 2–24 s (paralel) |
| **Toplam aktif** | **~4–7 saat** (+ karar beklemeleri) |

---

## 8. Risk özeti

| Risk | Seviye | Azaltma |
|------|--------|---------|
| Yanlış projeye SQL | P0 | Ref checklist + DUR |
| 024 type/cast regress | P1 | SHA pin + staging kanıtı |
| Admin allowlist hatası | P0 | Negatif test önce |
| Cross-tenant regress | P0 | A/B drill |
| Storage RPO gaps | P1 | Immutable karar kapısı |
| PITR kapalı | P1 | Yazılı kabul veya etkinleştirme |
| Rollback karmaşıklığı | P1 | Forward-only + izole restore |

---

## 9. Non-claims

- Bu runbook production-ready ilanı **değildir**.
- Staging PASS ≠ production PASS.
- PITR ve **production** immutable S3 bu belgede **otomatik açılmaz**.
  Staging immutable S3 live kanıtı ayrı raporda PASS.
- Commit/push/deploy/SQL bu turda **yok**.
