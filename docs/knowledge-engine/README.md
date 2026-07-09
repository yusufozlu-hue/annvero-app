# ANNVERO Muhasebe Bilgi Motoru (Knowledge Engine)

Merkezi muhasebe bilgi omurgası. Tüm modüller (banka parser, öğrenen hafıza, Luca dönüştürücü, GİB, fiş kontrol vb.) aynı entity, pattern, kural ve firma hafızası kaynağını kullanır.

**Görev 1 kapsamı:** veritabanı tabloları, RLS, sınırlı global seed, tip sabitleri. UI ve AI entegrasyonu sonraki görevlerdedir.

---

## Tablolar

| Tablo | Amaç |
|-------|------|
| `knowledge_entities` | Tanınabilir kurum/varlık (Google, SGK, GİB, banka, tedarikçi…) |
| `knowledge_match_patterns` | Açıklama, keyword, regex, IBAN, VKN, SWIFT eşleştirme kalıpları |
| `knowledge_accounting_rules` | Entity için borç/alacak hesap, KDV, belge türü önerileri |
| `knowledge_company_memory` | Firma bazlı kullanıcı öğretimi / öğrenilen eşleşmeler |
| `knowledge_decision_history` | Motorun verdiği kararlar ve kaynak izi |
| `knowledge_rule_versions` | Entity/kural/pattern değişiklik versiyonları |

Kod sabitleri: `src/lib/knowledge-engine/constants.js`  
JSDoc tipleri: `src/lib/knowledge-engine/types.js`

---

## Karar sırası (pipeline)

Bir işlem tanınırken öncelik:

1. **company_memory** — `knowledge_company_memory` (firma öğretimi, confidence ≈ 1.0)
2. **company-specific entity/pattern** — `company_id` dolu kayıtlar
3. **global entity/pattern** — `is_global = true`, `company_id` boş
4. **accounting_rules** — eşleşen entity için muhasebe önerisi
5. **ai_stub** — AI katmanı (Görev 5; şimdilik stub)
6. **manual queue** — tanınmayan işlem kuyruğu / kullanıcı müdahalesi

Her adım `knowledge_decision_history` ve `audit_events` ile izlenir.

---

## Confidence mantığı

| Kaynak | Tipik confidence | Not |
|--------|------------------|-----|
| company_memory | 1.00 | Kullanıcı onaylı öğrenme |
| global pattern | 0.75–0.90 | Keyword / açıklama eşleşmesi |
| global entity | 0.70 | Varsayılan entity güveni |
| accounting_rule | 0.80 | Onaylı global kural |
| seed örnek kurallar | 0.40–0.50 | Hesap kodları doğrulanmalı |
| ai_stub | TBD | Görev 5 |

Düşük confidence → `decision_status: suggested` veya `risky`; yüksek → `recognized`.

---

## Audit ve versioning

- **audit_events** (Faz 1): CREATE/UPDATE/SOFT_DELETE/EXPORT — `entity_type`: `knowledge_entity`, `knowledge_rule`, vb.
- **knowledge_rule_versions**: Her anlamlı değişiklikte `before_state` / `after_state` snapshot (Görev 2 servis katmanı yazar).
- **Soft delete**: `deleted_at` / `deleted_by`; fiziksel silme yok. RLS select politikaları `deleted_at IS NULL` filtreler.

---

## RLS özeti

- **Global kayıtlar** (`is_global = true`, `company_id` boş): tüm authenticated kullanıcılar okuyabilir.
- **Firma kayıtları**: yalnızca `annvero_can_access_company(company_id)` ile.
- **Yazma**: firma kaydı → firma erişimi; global kayıt → `annvero_is_management()`.
- **company_memory**: her zaman firma izolasyonu.
- **rule_versions**: yönetim okur/yazar.
- **service_role**: RLS bypass (API guard ile).

`company_id` tipi: `text` — mevcut `companies.id` ile uyumlu.

---

## Migration

Supabase SQL Editor'da çalıştırın:

```
supabase/migrations/017_knowledge_engine.sql
```

Önkoşul: `015_security_phase1.sql` (`annvero_can_access_company` fonksiyonları).

---

## Sonraki görevler

| Görev | İçerik |
|-------|--------|
| **Görev 2** | Servis katmanı — CRUD API, `apiGuard`, audit/version yazımı |
| **Görev 3** | Karar motoru — pipeline, mevcut `accountingDecisionEngine` ile köprü |
| **Görev 4** | Yönetim ekranı — entity/pattern/kural yönetimi |
| **Görev 5** | AI entegrasyonu — düşük confidence fallback, öneri üretimi |

---

## İlgili dosyalar

- `supabase/migrations/017_knowledge_engine.sql`
- `src/lib/knowledge-engine/constants.js`
- `src/lib/knowledge-engine/types.js`
- `src/lib/knowledge-engine/schema.js`
