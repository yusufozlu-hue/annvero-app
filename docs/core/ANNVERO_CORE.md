# ANNVERO CORE

Merkezi muhasebe karar servisi. Tüm modüller aynı pipeline üzerinden entity tanıma, hafıza, kural, bilgi tabanı, confidence, risk ve manuel kuyruk adımlarını kullanır.

**Görev 1 kapsamı:** servis omurgası, stub resolver'lar, tipler, dokümantasyon. DB bağlantısı, UI ve AI yok.

---

## Hangi modüller kullanacak?

| Modül | Kullanım |
|-------|----------|
| Banka parser / Banka & Kart Operasyon | Hareket sınıflandırma, hesap önerisi |
| Öğrenen Hafıza / İşlem Hafızası | Company memory katmanı |
| Kural Motoru | Company rules katmanı |
| Luca dönüştürücü | Fiş satırı önerileri |
| GİB / Resmi bildirimler | Entity + risk |
| AI Ofis Asistanı | AI stub → Görev 5 |
| Fiş kontrol / Risk denetim | Risk engine çıktısı |

Mevcut `accountingDecisionEngine.js` **değiştirilmedi**. Görev 3'te banka modülü CORE'a köprülenecek.

---

## Karar pipeline'ı

```
1. Entity Recognition      → entityResolver
2. Company Memory          → memoryResolver
3. Company Rules           → ruleResolver
4. Global Knowledge        → knowledgeResolver.resolveGlobalKnowledge
5. Accounting Rules        → knowledgeResolver.resolveAccountingRules
6. Confidence Engine       → confidenceEngine
7. Risk Engine             → riskEngine
8. AI Stub                 → aiStub (not implemented)
9. Manual Queue            → manualQueue
```

Ana giriş: `resolveAccountingDecision(input, context)` — `src/core/annveroCore.js`

---

## Input formatı

```javascript
{
  source_type: "bank",           // zorunlu
  company_id: "firma-uuid",      // zorunlu
  raw_description: "GOOGLE ADS", // en az bir tanımlayıcı
  amount: -1500,
  currency: "TRY",
  transaction_date: "2026-07-09",
  bank_name: "Garanti",
  counterparty_name: "",
  iban: "",
  tax_no: "",
  document_type: "",
  raw_payload: {}
}
```

## Context formatı (server-only)

```javascript
{
  user_id: "auth-user-id",       // zorunlu
  user_role: "admin",
  company_access: ["firma-id"],  // veya ["*"] admin
  module: "bank_card_ops",       // zorunlu
  request_id: "req-uuid"
}
```

## Output formatı

```javascript
{
  status,                        // recognized | suggested | unknown | manual_review | risky
  decision_source,
  confidence_score,              // 0–1
  matched_entity,
  matched_rule,
  suggested_account_code,
  suggested_account_name,
  suggested_counter_account_code,
  suggested_cari,
  suggested_document_type,
  suggested_vat_rate,
  suggested_description,
  risk_level,
  risk_flags,
  needs_manual_review,
  debug_trace                    // [{ stage, outcome, detail, duration_ms }]
}
```

---

## Güvenlik ilkeleri

1. **CORE doğrudan client'tan çağrılmaz** — yalnızca API route / server action.
2. **`company_id` + `user_id` + `module` zorunlu** — eksikse `manual_review` döner.
3. **`company_access` kontrolü** — yetkisiz firmada karar üretilmez.
4. **Hata = crash yok** — `unknown` / `manual_review` + `debug_trace`.
5. **Audit** — `coreAudit.js` stub; Görev 2'de `audit_events` + `knowledge_decision_history`.

---

## Knowledge Engine ile ilişkisi

| CORE katmanı | Knowledge Engine tablosu (Görev 2) |
|--------------|-------------------------------------|
| Entity Recognition | `knowledge_entities`, `knowledge_match_patterns` |
| Company Memory | `knowledge_company_memory` (+ mevcut `learning_memory` köprüsü) |
| Accounting Rules | `knowledge_accounting_rules` |
| Global Knowledge | `knowledge_entities` (global) |
| Audit | `knowledge_decision_history`, `audit_events` |

Migration: `017_knowledge_engine.sql` (zaten deploy edildi).

---

## Klasör yapısı

```
src/core/
  annveroCore.js          # Ana giriş
  index.js
  types/                  # Input, context, result, constants
  entity/
  memory/
  rules/
  knowledge/
  decision/               # Pipeline + aiStub + manualQueue
  confidence/
  risk/
  audit/
  dev/smokeTest.js
```

---

## Developer test

```bash
node scripts/test-annvero-core.mjs
```

Veya server kodunda:

```javascript
import { runCoreSmokeTest } from "@/src/core/dev/smokeTest";
const summary = await runCoreSmokeTest();
```

---

## Sonraki görevler

| Görev | İçerik |
|-------|--------|
| **Görev 2** | CORE servislerini Knowledge Engine DB'ye bağlama |
| **Görev 3** | Banka modülünü CORE'a bağlama (`accountingDecisionEngine` köprüsü) |
| **Görev 4** | Manual Queue / Öğret ekranı |
| **Görev 5** | AI entegrasyonu (`aiStub` → gerçek servis) |

---

## İlgili dosyalar

- `src/core/annveroCore.js`
- `docs/knowledge-engine/README.md`
- `supabase/migrations/017_knowledge_engine.sql`
