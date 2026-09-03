/**
 * Muhasebe Hafızası V1 — tek yetkili firma öğrenme zinciri.
 *
 * Yetkili kaynak: server `learning_memory` (document_type = BANK_STATEMENT_ACCOUNTING)
 * Tarayıcı Account Memory V2: tenant/user bağlı süreli cache
 *
 * Migration gerekmez — mevcut learning_memory kolonları (keyword, bank_name,
 * transaction_type, document_type, account_code, counter_account_code, status,
 * user_correction) yeterlidir.
 */

import { canonicalizeBankId } from "@/src/utils/bankIdentity";
import { normalizeParserText } from "@/src/utils/textNormalize";
import { buildSafeLearningMemoryPayload } from "@/src/utils/learningMemorySafePayload";
import {
  saveAccountMemoryV2Decision,
  loadAccountMemoryV2Records,
  persistAccountMemoryV2Records,
  resolveAccountMemoryV2Decision,
  buildCariMemoryCanonicalKey,
  fingerprintCariMemoryKey,
  MEMORY_DECISION_CODE,
} from "@/src/utils/accountMemoryV2";
import { isForbiddenVadeliMemorySuggestion } from "@/src/utils/vadeliMevduatLifecycle";

export const BANK_STATEMENT_ACCOUNTING_DOC = "BANK_STATEMENT_ACCOUNTING";
export const ACCOUNTING_MEMORY_SCHEMA_VERSION = 1;
export const ACCOUNTING_MEMORY_SOURCE = "user_confirmed";

export const ACCOUNTING_MEMORY_PERSIST_WARNING =
  "Hesap uygulandı; kalıcı firma hafızası yazılamadı. Bu oturumda devam edilir, sonraki ekstrede yeniden öğretilmesi gerekebilir.";

const SIGNATURE_PREFIX = "bsa";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 saat

/** IBAN / tutar / uzun hesap no / e-posta — fingerprint’e girmez */
const SENSITIVE_TOKEN_RE =
  /\b(?:TR\d{2}\s?(?:\d{4}\s?){5}\d{0,2}|\d{10,}|\d+[.,]\d{2}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi;

function nowIso() {
  return new Date().toISOString();
}

function normalizeDirection(value = "") {
  const d = String(value || "")
    .trim()
    .toUpperCase();
  if (d === "CIKIS" || d === "GIDEN" || d === "BORC" || d === "DEBIT" || d === "OUT") {
    return "CIKIS";
  }
  if (d === "GIRIS" || d === "GELEN" || d === "ALACAK" || d === "CREDIT" || d === "IN") {
    return "GIRIS";
  }
  return d || "";
}

function normalizeCurrency(value = "") {
  const c = String(value || "")
    .trim()
    .toUpperCase()
    .replace("TL", "TRY");
  return c || "TRY";
}

function normalizeTransactionType(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_") || "UNKNOWN";
}

/**
 * Hassas token’ları at; yalnız güvenli kategori/token bırak.
 */
export function stripSensitiveDescriptionTokens(text = "") {
  return normalizeParserText(String(text || "").replace(SENSITIVE_TOKEN_RE, " "));
}

/**
 * Güvenli açıklama parmak izi — tam metin/IBAN/tutar persist edilmez.
 */
export function buildSafeDescriptionFingerprint(text = "") {
  const cleaned = stripSensitiveDescriptionTokens(text);
  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 12);
  const body = tokens.join(" ") || "EMPTY";
  return fingerprintCariMemoryKey(body);
}

/**
 * İmza: banka + yön + tip + para birimi + güvenli fingerprint.
 * companyId imzada değil (tenant ayrı kolon); tutar/tarih/IBAN/dosya yok.
 */
export function buildAccountingMemorySignature({
  bankId = "",
  direction = "",
  transactionType = "",
  currency = "TRY",
  descriptionFingerprint = "",
} = {}) {
  const bank = canonicalizeBankId(bankId) || "UNKNOWN_BANK";
  const dir = normalizeDirection(direction) || "NA";
  const type = normalizeTransactionType(transactionType);
  const cur = normalizeCurrency(currency);
  const fp = String(descriptionFingerprint || "").trim() || "fp:00000000";
  return `${SIGNATURE_PREFIX}|${bank}|${dir}|${type}|${cur}|${fp}`;
}

export function parseAccountingMemorySignature(keyword = "") {
  const parts = String(keyword || "").split("|");
  if (parts[0] !== SIGNATURE_PREFIX || parts.length < 6) return null;
  return {
    bankId: parts[1] || "",
    direction: parts[2] || "",
    transactionType: parts[3] || "",
    currency: parts[4] || "TRY",
    descriptionFingerprint: parts.slice(5).join("|"),
  };
}

export function isAccountingMemoryServerRow(row = {}) {
  return (
    String(row.document_type || row.documentType || "").toUpperCase() ===
    BANK_STATEMENT_ACCOUNTING_DOC
  );
}

/**
 * Hard safety — hafıza bunları asla ezemez.
 */
export function evaluateAccountingMemoryHardRules({
  accountCode = "",
  counterAccountCode = "",
  company = null,
  statementAccountType = "",
  accountPlanCodes = null,
} = {}) {
  const code = String(accountCode || "").trim();
  const counter = String(counterAccountCode || "").trim();
  const reasons = [];

  if (!code) {
    reasons.push("missing_account_code");
  }
  if (code && counter && code === counter) {
    reasons.push("self_counter_forbidden");
  }
  if (
    isForbiddenVadeliMemorySuggestion({
      statementAccountType,
      suggestedAccountCode: code,
      company,
    })
  ) {
    reasons.push("vadeli_to_vadeli_forbidden");
  }

  // Yabancı banka 102: firma kartındaki banka kodları dışındaki 102.* reddedilir
  if (/^102(\.|$)/.test(code) && company) {
    const banks = Array.isArray(company.bankAccounts)
      ? company.bankAccounts
      : Array.isArray(company.banks)
        ? company.banks
        : [];
    const active = banks.filter((b) => b && b.isActive !== false);
    if (active.length) {
      const known = new Set(
        active
          .map((b) =>
            String(
              b.lucaAccountCode || b.lucaCode || b.accountCode || b.code || ""
            ).trim()
          )
          .filter(Boolean)
      );
      if (known.size && !known.has(code)) {
        reasons.push("foreign_bank_102_forbidden");
      }
    }
  }

  if (Array.isArray(accountPlanCodes) && accountPlanCodes.length && code) {
    const set = new Set(
      accountPlanCodes.map((c) => String(c || "").trim()).filter(Boolean)
    );
    if (!set.has(code)) {
      reasons.push("account_not_in_plan");
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    blocked: reasons.length > 0,
  };
}

export function buildServerAccountingMemoryPayload({
  companyId = "",
  bankId = "",
  bankName = "",
  direction = "",
  transactionType = "",
  currency = "TRY",
  descriptionOrKey = "",
  analysisKey = "",
  canonicalAnalysisKey = "",
  accountCode = "",
  counterAccountCode = "",
  accountPlanFingerprint = "",
  createdBy = "",
  auditReason = "user_confirmed_firm_learn",
  sourceModule = "",
  accountingScenario = "",
} = {}) {
  const firmaId = String(companyId || "").trim();
  const code = String(accountCode || "").trim();
  const dir = normalizeDirection(direction);
  const type = normalizeTransactionType(transactionType);
  const cur = normalizeCurrency(currency);
  const bank = canonicalizeBankId(bankId || bankName) || String(bankName || "").trim();
  const localKeyRaw = String(analysisKey || descriptionOrKey || "").trim();
  const fp = buildSafeDescriptionFingerprint(localKeyRaw);
  const signature = buildAccountingMemorySignature({
    bankId: bank,
    direction: dir,
    transactionType: type,
    currency: cur,
    descriptionFingerprint: fp,
  });
  const localKeySafe = (() => {
    if (!localKeyRaw) return "";
    if (localKeyRaw.startsWith("cm:") || localKeyRaw.startsWith("bsa|")) {
      return localKeyRaw;
    }
    // Ham açıklama PII taşıyabilir — meta'da yalnız strip edilmiş kısa özet
    const stripped = stripSensitiveDescriptionTokens(localKeyRaw);
    const remnantPii =
      /\bTR\d{2}/i.test(stripped) ||
      /\d{10,}/.test(stripped) ||
      /@/.test(stripped) ||
      /\d+[.,]\d{2}/.test(stripped);
    if (remnantPii || !stripped.trim()) {
      return signature;
    }
    return stripped.slice(0, 80);
  })();
  const canon =
    String(canonicalAnalysisKey || "").trim() ||
    buildCariMemoryCanonicalKey(localKeySafe || signature, dir);

  if (!firmaId || !code || !dir || !bank) return null;

  const moduleTag = String(sourceModule || "").trim().toUpperCase();
  const scenarioTag = String(accountingScenario || "").trim();
  const userCorrection = JSON.stringify({
    schemaVersion: ACCOUNTING_MEMORY_SCHEMA_VERSION,
    source: ACCOUNTING_MEMORY_SOURCE,
    status: "active",
    direction: dir,
    currency: cur,
    bankId: bank,
    descriptionFingerprint: fp,
    analysisKey: localKeySafe || signature,
    canonicalAnalysisKey: (() => {
      if (canon.startsWith("cm:") || canon.startsWith("bsa|")) return canon;
      return buildCariMemoryCanonicalKey(localKeySafe || signature, dir);
    })(),
    accountPlanFingerprint: String(accountPlanFingerprint || "").trim() || null,
    confidence: 95,
    createdBy: String(createdBy || "").trim() || null,
    auditReason,
    counterAccountCode: String(counterAccountCode || "").trim() || null,
    sourceModule: moduleTag || null,
    accountingScenario: scenarioTag || null,
  });

  return buildSafeLearningMemoryPayload({
    company_id: firmaId,
    keyword: signature,
    clean_description: signature,
    raw_description: signature,
    account_code: code,
    document_type: BANK_STATEMENT_ACCOUNTING_DOC,
    transaction_type: type,
    bank_name: bank,
    user_correction: userCorrection,
    learned_at: nowIso(),
    status: "active",
    // Kolon mevcut (007a); SAFE allowlist dışındaysa düşer — user_correction yedek
    source_module: moduleTag || undefined,
  });
}

export function parseUserCorrectionMeta(row = {}) {
  const raw = row.user_correction ?? row.userCorrection ?? "";
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

export function mapServerAccountingRowToV2(row = {}) {
  if (!isAccountingMemoryServerRow(row)) return null;
  const companyId = String(row.company_id || row.companyId || "").trim();
  const meta = parseUserCorrectionMeta(row);
  const parsed = parseAccountingMemorySignature(row.keyword || row.clean_description || "");
  const direction = normalizeDirection(
    meta.direction || parsed?.direction || ""
  );
  const bankId = String(
    meta.bankId || parsed?.bankId || row.bank_name || row.bankName || ""
  ).trim();
  const transactionType = normalizeTransactionType(
    meta.transactionType || parsed?.transactionType || row.transaction_type || ""
  );
  const currency = normalizeCurrency(meta.currency || parsed?.currency || "TRY");
  const accountCode = String(row.account_code || row.accountCode || "").trim();
  const fp =
    meta.descriptionFingerprint ||
    parsed?.descriptionFingerprint ||
    fingerprintCariMemoryKey(row.keyword || "");
  const signature = buildAccountingMemorySignature({
    bankId,
    direction,
    transactionType,
    currency,
    descriptionFingerprint: fp,
  });
  // Hot path: cm:* korunur; aksi halde imza (PII-safe) analysisKey olur
  const metaKey = String(meta.analysisKey || "").trim();
  const analysisKey =
    metaKey.startsWith("cm:") || metaKey.startsWith("bsa|")
      ? metaKey
      : signature;
  const canonicalAnalysisKey =
    String(meta.canonicalAnalysisKey || "").trim().startsWith("cm:")
      ? String(meta.canonicalAnalysisKey).trim()
      : buildCariMemoryCanonicalKey(analysisKey, direction);

  if (!companyId || !accountCode || !direction) return null;

  const status = String(row.status || meta.status || "active").toLowerCase();
  const isActive =
    row.is_active !== false &&
    !row.deleted_at &&
    status !== "passive" &&
    status !== "deleted" &&
    status !== "disabled" &&
    status !== "superseded";

  return {
    id: `srv:${row.id || analysisKey}`,
    serverId: row.id || null,
    companyId,
    analysisKey,
    canonicalAnalysisKey,
    normalizedDescription: analysisKey,
    accountCode,
    counterAccountCode: String(
      meta.counterAccountCode || row.counter_account_code || ""
    ).trim(),
    direction,
    transactionType,
    bankId,
    bankName: bankId,
    currency,
    descriptionFingerprint: fp,
    accountPlanFingerprint: meta.accountPlanFingerprint || "",
    confidence: Number(meta.confidence) || 95,
    isActive,
    status: isActive ? "active" : status || "disabled",
    source: "user-learn",
    memorySource: ACCOUNTING_MEMORY_SOURCE,
    documentType: BANK_STATEMENT_ACCOUNTING_DOC,
    schemaVersion: ACCOUNTING_MEMORY_SCHEMA_VERSION,
    serverPersisted: true,
    createdAt: row.learned_at || row.created_at || nowIso(),
    updatedAt: row.updated_at || nowIso(),
    lastUsedAt: row.last_used_at || null,
    usageCount: Number(row.usage_count || row.match_count || 0),
    successCount: Number(row.usage_count || 0),
    correctionCount: 0,
    createdBy: meta.createdBy || row.created_by || null,
  };
}

/**
 * Server satırlarını V2 cache’e hydrate et — yetkili snapshot reconcile.
 * Firma için BANK_STATEMENT_ACCOUNTING local/pending kayıtları silinir;
 * yalnız server-confirmed aktif satırlar kalır. Diğer firmalara dokunulmaz.
 */
export function hydrateFirmAccountingMemoryCache(
  serverRows = [],
  companyId = "",
  { userId = "", now = Date.now() } = {}
) {
  const firmaId = String(companyId || "").trim();
  if (!firmaId) return { merged: 0, removed: 0, records: loadAccountMemoryV2Records() };

  const mapped = (serverRows || [])
    .map(mapServerAccountingRowToV2)
    .filter(Boolean)
    .filter((r) => r.companyId === firmaId && r.isActive !== false && r.serverPersisted);

  const existing = loadAccountMemoryV2Records();
  let removed = 0;
  const keepOthers = existing.filter((r) => {
    if (r.companyId !== firmaId) return true;
    const isBsa =
      String(r.documentType || "").toUpperCase() === BANK_STATEMENT_ACCOUNTING_DOC ||
      String(r.id || "").startsWith("srv:") ||
      r.serverId ||
      r.status === "pending";
    if (isBsa) {
      removed += 1;
      return false;
    }
    return true;
  });

  const stamped = mapped.map((r) => ({
    ...r,
    status: "active",
    serverPersisted: true,
    cacheUserId: String(userId || "").trim() || null,
    cacheExpiresAt: new Date(now + CACHE_TTL_MS).toISOString(),
  }));

  const next = [...keepOthers, ...stamped];
  persistAccountMemoryV2Records(next);
  return { merged: stamped.length, removed, records: next };
}

/**
 * Logout / kullanıcı değişimi: cache uygulanmaz.
 */
export function purgeAccountingMemoryCacheForUserChange({
  previousUserId = "",
  nextUserId = "",
  companyId = "",
} = {}) {
  const prev = String(previousUserId || "").trim();
  const next = String(nextUserId || "").trim();
  if (prev && next && prev === next) return { purged: 0 };

  const records = loadAccountMemoryV2Records();
  const firmaId = String(companyId || "").trim();
  const filtered = records.filter((r) => {
    if (firmaId && r.companyId === firmaId) return false;
    if (r.cacheUserId && prev && r.cacheUserId === prev) return false;
    if (r.cacheExpiresAt && Date.parse(r.cacheExpiresAt) < Date.now()) return false;
    if (r.status === "pending") return false;
    return true;
  });
  const purged = records.length - filtered.length;
  if (purged > 0) persistAccountMemoryV2Records(filtered);
  return { purged };
}

function findExistingServerAccountingRow(existingRows = [], signature = "", companyId = "") {
  const sig = String(signature || "").trim();
  const cid = String(companyId || "").trim();
  return (existingRows || []).find((row) => {
    if (!isAccountingMemoryServerRow(row)) return false;
    if (cid && String(row.company_id || row.companyId || "") !== cid) return false;
    const status = String(row.status || "active").toLowerCase();
    if (
      status === "deleted" ||
      status === "passive" ||
      status === "superseded" ||
      row.is_active === false
    ) {
      return false;
    }
    return String(row.keyword || "") === sig || String(row.clean_description || "") === sig;
  });
}

function removePendingLocalAccountingRecords({
  companyId = "",
  analysisKey = "",
  signature = "",
  localId = "",
} = {}) {
  const firmaId = String(companyId || "").trim();
  const records = loadAccountMemoryV2Records();
  const next = records.filter((r) => {
    if (firmaId && r.companyId !== firmaId) return true;
    const sameId = localId && r.id === localId;
    const sameKey =
      (analysisKey && r.analysisKey === analysisKey) ||
      (signature && r.analysisKey === signature);
    const pendingLike =
      r.status === "pending" ||
      (String(r.documentType || "").toUpperCase() === BANK_STATEMENT_ACCOUNTING_DOC &&
        r.serverPersisted !== true);
    if ((sameId || sameKey) && pendingLike) return false;
    return true;
  });
  if (next.length !== records.length) {
    persistAccountMemoryV2Records(next);
  }
  return { removed: records.length - next.length };
}

/**
 * Açık kullanıcı onayı → server yetkili yazım → local cache activate.
 *
 * Sıra (zorunlu):
 * 1) İsteğe bağlı pending local (auto-apply’a girmez)
 * 2) Server persist
 * 3) SUCCESS → active + serverPersisted → “Öğrenildi”
 * 4) FAIL → pending silinir; active index’e girmez; uyarı
 */
export async function persistUserConfirmedAccountingMemory({
  companyId = "",
  bankId = "",
  bankName = "",
  direction = "",
  transactionType = "",
  currency = "TRY",
  descriptionOrKey = "",
  analysisKey = "",
  accountCode = "",
  counterAccountCode = "",
  accountPlanFingerprint = "",
  accountPlanCodes = null,
  company = null,
  statementAccountType = "",
  createdBy = "",
  source = "user-learn",
  seedRow = {},
  existingServerRows = [],
  createRecord = null,
  updateRecord = null,
  rememberForCompany = true,
  skipLocalSave = false,
  auditReason = "user_confirmed_firm_learn",
  sourceModule = "",
  accountingScenario = "",
} = {}) {
  if (!rememberForCompany) {
    return {
      ok: false,
      learned: false,
      localOk: false,
      persisted: false,
      serverWriteCount: 0,
      serverWriteAttempt: 0,
      activeCache: 0,
      warning: null,
      rejectReason: "remember_not_checked",
    };
  }

  const hard = evaluateAccountingMemoryHardRules({
    accountCode,
    counterAccountCode,
    company,
    statementAccountType,
    accountPlanCodes,
  });
  if (hard.blocked) {
    return {
      ok: false,
      learned: false,
      localOk: false,
      persisted: false,
      serverWriteCount: 0,
      serverWriteAttempt: 0,
      activeCache: 0,
      warning: null,
      rejectReason: hard.reasons[0] || "hard_rule_blocked",
      hardRules: hard.reasons,
    };
  }

  const payload = buildServerAccountingMemoryPayload({
    companyId,
    bankId: bankId || bankName,
    bankName,
    direction,
    transactionType,
    currency,
    descriptionOrKey: descriptionOrKey || analysisKey,
    analysisKey: analysisKey || descriptionOrKey,
    canonicalAnalysisKey: buildCariMemoryCanonicalKey(
      analysisKey || descriptionOrKey,
      direction
    ),
    accountCode,
    counterAccountCode,
    accountPlanFingerprint,
    // createdBy client’tan güvenilmez — server oturumu yazar; burada yalnız cache meta
    createdBy: "",
    auditReason,
    sourceModule:
      sourceModule ||
      seedRow?.sourceModule ||
      (source === "fis-kontrol" ? "FIS_KONTROL" : ""),
    accountingScenario:
      accountingScenario || seedRow?.accountingScenario || "",
  });
  if (!payload) {
    return {
      ok: false,
      learned: false,
      localOk: false,
      persisted: false,
      serverWriteCount: 0,
      serverWriteAttempt: 0,
      activeCache: 0,
      warning: null,
      rejectReason: "invalid_payload",
    };
  }

  const dir = normalizeDirection(direction);
  const bank = canonicalizeBankId(bankId || bankName) || String(bankName || "").trim();
  const localAnalysisKey = String(analysisKey || descriptionOrKey || payload.keyword).trim();
  const localCanon = buildCariMemoryCanonicalKey(localAnalysisKey, dir);
  let local = null;
  let pendingId = "";

  if (!skipLocalSave) {
    // Optimistic pending — resolver / auto-apply bu kaydı kullanmaz
    local = saveAccountMemoryV2Decision(
      {
        ...seedRow,
        hesapKodu: accountCode,
        accountCode,
        analysisKey: localAnalysisKey,
        canonicalAnalysisKey: localCanon,
        direction: dir,
        transactionType: normalizeTransactionType(transactionType),
        bankId: bank,
        bankName: bank,
        currency: normalizeCurrency(currency),
        normalizedDescription: localAnalysisKey,
        documentType: BANK_STATEMENT_ACCOUNTING_DOC,
        source,
        confidence: 95,
        serverPersisted: false,
        status: "pending",
        isActive: false,
      },
      { firmaId: companyId, companyId, bankId: bank, bankName: bank, source }
    );
    pendingId = local?.id || "";
    if (!local) {
      return {
        ok: false,
        learned: false,
        localOk: false,
        persisted: false,
        serverWriteCount: 0,
        serverWriteAttempt: 0,
        activeCache: 0,
        warning: null,
        rejectReason: "local_save_failed",
      };
    }
  }

  const existing = findExistingServerAccountingRow(
    existingServerRows,
    payload.keyword,
    companyId
  );
  const existingCode = String(
    existing?.account_code || existing?.accountCode || ""
  ).trim();

  let serverRecord = null;
  let serverWriteCount = 0;
  let serverWriteAttempt = 0;
  let reused = false;
  let superseded = false;
  let error = null;

  try {
    if (existing?.id && existingCode === String(accountCode).trim()) {
      reused = true;
      serverWriteCount = 0;
      serverRecord = existing;
      if (typeof updateRecord === "function") {
        serverWriteAttempt = 1;
        await updateRecord(existing.id, {
          ...payload,
          status: "active",
        }).catch(() => null);
      }
    } else if (existing?.id && existingCode && existingCode !== String(accountCode).trim()) {
      superseded = true;
      if (typeof updateRecord === "function") {
        await updateRecord(existing.id, {
          status: "passive",
          user_correction: JSON.stringify({
            ...parseUserCorrectionMeta(existing),
            status: "superseded",
            supersededAt: nowIso(),
            supersededByAccount: String(accountCode).trim(),
          }),
        });
      }
      if (typeof createRecord === "function") {
        serverWriteAttempt = 1;
        const result = await createRecord(payload);
        if (result?.error || !result?.data) {
          error = result?.error || "learning_memory yazılamadı.";
        } else {
          serverRecord = result.data;
          serverWriteCount = 1;
        }
      } else {
        error = "learning_memory yazıcı bağlı değil.";
      }
    } else if (typeof createRecord === "function") {
      serverWriteAttempt = 1;
      const result = await createRecord(payload);
      if (result?.error || !result?.data) {
        error = result?.error || "learning_memory yazılamadı.";
      } else {
        serverRecord = result.data;
        serverWriteCount = 1;
      }
    } else {
      error = "learning_memory yazıcı bağlı değil.";
    }
  } catch (err) {
    error = err?.message || String(err);
  }

  if (error || !serverRecord) {
    removePendingLocalAccountingRecords({
      companyId,
      analysisKey: localAnalysisKey,
      signature: payload.keyword,
      localId: pendingId,
    });
    return {
      ok: false,
      learned: false,
      localOk: false,
      persisted: false,
      serverWriteCount: 0,
      serverWriteAttempt,
      activeCache: 0,
      warning: ACCOUNTING_MEMORY_PERSIST_WARNING,
      error,
      rejectReason: "server_persist_failed",
      localRecord: null,
      signature: payload.keyword,
    };
  }

  // SUCCESS → pending kaldır, server-confirmed active yaz
  removePendingLocalAccountingRecords({
    companyId,
    analysisKey: localAnalysisKey,
    signature: payload.keyword,
    localId: pendingId,
  });

  const activated = saveAccountMemoryV2Decision(
    {
      ...seedRow,
      id: `srv:${serverRecord.id}`,
      serverId: serverRecord.id,
      hesapKodu: accountCode,
      accountCode,
      analysisKey: localAnalysisKey,
      canonicalAnalysisKey: localCanon,
      direction: dir,
      transactionType: normalizeTransactionType(transactionType),
      bankId: bank,
      bankName: bank,
      currency: normalizeCurrency(currency),
      normalizedDescription: localAnalysisKey,
      documentType: BANK_STATEMENT_ACCOUNTING_DOC,
      source,
      confidence: 95,
      serverPersisted: true,
      status: "active",
      isActive: true,
      createdBy: String(createdBy || "").trim() || null,
    },
    { firmaId: companyId, companyId, bankId: bank, bankName: bank, source }
  );

  const activeCache = loadAccountMemoryV2Records().filter(
    (r) =>
      r.companyId === companyId &&
      r.serverPersisted === true &&
      r.isActive !== false &&
      String(r.status || "active") === "active" &&
      (r.analysisKey === localAnalysisKey ||
        r.analysisKey === payload.keyword ||
        r.serverId === serverRecord.id)
  ).length;

  return {
    ok: true,
    learned: true,
    localOk: Boolean(activated),
    persisted: true,
    reused,
    superseded,
    serverWriteCount,
    serverWriteAttempt: reused ? serverWriteAttempt : Math.max(serverWriteAttempt, 1),
    activeCache,
    warning: null,
    error: null,
    localRecord: activated,
    serverRecord,
    signature: payload.keyword,
  };
}

/**
 * Tüketim: tenant + hard-rule + plan + yön/banka/para birimi.
 */
export function consumeFirmAccountingMemory({
  companyId = "",
  bankId = "",
  bankName = "",
  direction = "",
  transactionType = "",
  currency = "TRY",
  descriptionOrKey = "",
  analysisKey = "",
  accountMemoryIndex = null,
  accountPlanCodes = null,
  company = null,
  statementAccountType = "",
  allowAuto = true,
  cacheUserId = "",
  currentUserId = "",
} = {}) {
  // Kullanıcı değiştiyse cache uygulanmaz
  if (
    cacheUserId &&
    currentUserId &&
    String(cacheUserId) !== String(currentUserId)
  ) {
    return {
      mode: "none",
      autoApply: false,
      decisionCode: MEMORY_DECISION_CODE.TENANT_DENIED,
      rejectReason: "user_cache_mismatch",
      record: null,
    };
  }

  const bank = canonicalizeBankId(bankId || bankName) || String(bankName || "").trim();
  const dir = normalizeDirection(direction);
  const type = normalizeTransactionType(transactionType);
  const cur = normalizeCurrency(currency);
  const fp = buildSafeDescriptionFingerprint(analysisKey || descriptionOrKey);
  const signature = buildAccountingMemorySignature({
    bankId: bank,
    direction: dir,
    transactionType: type,
    currency: cur,
    descriptionFingerprint: fp,
  });
  const localKey = String(analysisKey || descriptionOrKey || "").trim();

  const tryResolve = (key) =>
    resolveAccountMemoryV2Decision(
      {
        companyId,
        analysisKey: key,
        direction: dir,
        transactionType: type,
        bankId: bank,
        bankName: bank,
        currency: cur,
        normalizedDescription: key,
      },
      accountMemoryIndex,
      { allowAuto }
    );

  let hit = tryResolve(signature);
  if (!hit?.record && localKey && localKey !== signature) {
    hit = tryResolve(localKey);
  }
  if (!hit?.record && localKey) {
    const canon = buildCariMemoryCanonicalKey(localKey, dir);
    if (canon && canon !== localKey) hit = tryResolve(canon);
  }

  if (!hit?.record) {
    // Kısmi: yalnız yön+banka+fp ile analysisKey eski format fallback yok — güvenli
    return {
      ...hit,
      signature,
      mode: hit?.mode || "none",
      autoApply: false,
      rejectReason: hit?.rejectReason || "no_matching_memory_record",
    };
  }

  const rec = hit.record;
  // Banka / yön / para birimi sıkı
  if (rec.bankId && bank && canonicalizeBankId(rec.bankId) !== canonicalizeBankId(bank)) {
    return {
      mode: "none",
      autoApply: false,
      record: null,
      rejectReason: "bank_mismatch",
      signature,
    };
  }
  if (rec.direction && dir && normalizeDirection(rec.direction) !== dir) {
    return {
      mode: "none",
      autoApply: false,
      record: null,
      rejectReason: "direction_mismatch",
      signature,
    };
  }
  if (rec.currency && cur && normalizeCurrency(rec.currency) !== cur) {
    return {
      mode: "none",
      autoApply: false,
      record: null,
      rejectReason: "currency_mismatch",
      signature,
    };
  }
  if (rec.companyId && companyId && rec.companyId !== companyId) {
    return {
      mode: "none",
      autoApply: false,
      record: null,
      decisionCode: MEMORY_DECISION_CODE.TENANT_DENIED,
      rejectReason: "tenant_mismatch",
      signature,
    };
  }
  if (rec.isActive === false || rec.status === "disabled" || rec.status === "superseded") {
    return {
      mode: "none",
      autoApply: false,
      record: null,
      rejectReason: "memory_disabled",
      signature,
    };
  }
  if (rec.cacheExpiresAt && Date.parse(rec.cacheExpiresAt) < Date.now()) {
    return {
      mode: "none",
      autoApply: false,
      record: null,
      rejectReason: "cache_expired",
      signature,
    };
  }

  const hard = evaluateAccountingMemoryHardRules({
    accountCode: rec.accountCode,
    counterAccountCode: rec.counterAccountCode,
    company,
    statementAccountType,
    accountPlanCodes,
  });
  if (hard.blocked) {
    return {
      mode: "review",
      autoApply: false,
      record: rec,
      decisionCode: MEMORY_DECISION_CODE.CORE_OVERRIDE,
      rejectReason: hard.reasons[0] || "hard_rule_blocked",
      hardRules: hard.reasons,
      signature,
      decisionSource: "Öğrenen Hafıza",
      reviewRequired: true,
      reason: `Hard kural engeli: ${hard.reasons.join(", ")}`,
    };
  }

  if (rec.serverPersisted !== true) {
    return {
      mode: "none",
      autoApply: false,
      record: null,
      rejectReason: "server_not_confirmed",
      signature,
    };
  }

  return {
    ...hit,
    signature,
    decisionSource: "Öğrenen Hafıza",
    confidence: hit.confidence ?? rec.confidence,
    matchedSignal: "exact_user_confirmed_signature",
  };
}

/**
 * UI güvenli satır — PII / fingerprint / createdBy UUID yok.
 */
export function mapServerAccountingRowToUiSafe(row = {}) {
  if (!isAccountingMemoryServerRow(row)) return null;
  const companyId = String(row.company_id || row.companyId || "").trim();
  const meta = parseUserCorrectionMeta(row);
  const parsed = parseAccountingMemorySignature(
    row.keyword || row.clean_description || ""
  );
  const statusRaw = String(row.status || meta.status || "active").toLowerCase();
  let status = "active";
  if (
    row.is_active === false ||
    row.deleted_at ||
    statusRaw === "passive" ||
    statusRaw === "disabled" ||
    statusRaw === "deleted"
  ) {
    status = "disabled";
  } else if (statusRaw === "superseded") {
    status = "superseded";
  }

  return {
    id: String(row.id || "").trim(),
    companyId,
    decisionSource: "Kullanıcı onaylı",
    bankId: String(meta.bankId || parsed?.bankId || row.bank_name || "").trim(),
    direction: String(meta.direction || parsed?.direction || "").trim(),
    transactionType: String(
      meta.transactionType || parsed?.transactionType || row.transaction_type || ""
    ).trim(),
    currency: String(meta.currency || parsed?.currency || "TRY")
      .trim()
      .toUpperCase()
      .replace("TL", "TRY"),
    accountCode: String(row.account_code || row.accountCode || "").trim(),
    confidence: Number(meta.confidence) || 95,
    status,
    createdAt: row.learned_at || row.created_at || null,
    lastUsedAt: row.last_used_at || row.last_matched_at || null,
    usageCount: Number(row.usage_count || row.match_count || 0),
    successCount: Number(row.usage_count || row.match_count || 0),
    correctionCount: Number(meta.correctionCount || 0),
  };
}

export function filterFirmAccountingMemoryUiRows(
  rows = [],
  { status = "TUMU", bankId = "", search = "" } = {}
) {
  const bank = String(bankId || "").trim().toUpperCase();
  const q = String(search || "").trim().toUpperCase();
  return (rows || []).filter((row) => {
    if (!row?.id) return false;
    if (status !== "TUMU" && row.status !== status) return false;
    if (bank && String(row.bankId || "").toUpperCase() !== bank) return false;
    if (q) {
      const hay = `${row.accountCode} ${row.bankId} ${row.transactionType} ${row.direction}`
        .toUpperCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function buildFirmAccountingMemoryStats(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    active: list.filter((r) => r.status === "active").length,
    disabled: list.filter((r) => r.status === "disabled").length,
    superseded: list.filter((r) => r.status === "superseded").length,
  };
}

/** Preview FAIL metinleri — UI’da bulunmamalı */
export const FORBIDDEN_LOCAL_MEMORY_UI_PHRASES = Object.freeze([
  "Tarayıcı deposunda tutulur",
  "Firma Karar Hafızası V2",
  "Bu filtrede V2 kayıt yok",
]);
