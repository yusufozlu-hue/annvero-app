/**
 * Fiş Kontrol → Muhasebe Hafızası V1 adapter (Faz 2).
 *
 * Salt kullanıcı onaylı firma öğrenmesi. Yeni tablo/API yok;
 * persistUserConfirmedAccountingMemory → /api/learning-memory.
 */

import {
  persistUserConfirmedAccountingMemory,
  BANK_STATEMENT_ACCOUNTING_DOC,
} from "@/src/utils/accountingMemoryV1";
import {
  createLearningMemoryRecordDetailed,
  updateLearningMemoryRecordDetailed,
  fetchLearningMemoryForCompanyDetailed,
} from "@/src/utils/learningMemory";
import {
  loadAccountPlansFromStorage,
  getCompanyAccountPlansWithDiagnostics,
} from "@/src/utils/companyCenter";

export const FIS_KONTROL_SOURCE_MODULE = "FIS_KONTROL";
export const FIS_KONTROL_MEMORY_SOURCE = "fis-kontrol";

export const FIS_KONTROL_LEARN_MSG = {
  SAVED:
    "Hesap düzeltildi ve firma hafızasına kaydedildi.",
  EDIT_ONLY: "Hesap düzeltildi.",
  EDIT_MEMORY_FAILED:
    "Hesap düzeltildi; firma hafızasına kaydedilemedi.",
};

function compactCode(value = "") {
  return String(value || "").trim().replace(/\s+/g, "");
}

function resolveDirection(row = {}, draft = {}) {
  const raw = String(
    draft.direction || row.direction || row.yon || ""
  )
    .trim()
    .toUpperCase();
  if (raw === "GIRIS" || raw === "CIKIS") return raw;
  if (raw === "GELEN" || raw === "IN" || raw === "ALACAK") return "GIRIS";
  if (raw === "GIDEN" || raw === "OUT" || raw === "BORC") return "CIKIS";
  return "";
}

function resolveBankName(row = {}, payload = {}, bankName = "") {
  return (
    String(bankName || "").trim() ||
    String(row.kaynakAdi || row.bankName || row.banka || "").trim() ||
    String(payload?.kaynakAdi || payload?.bankName || "").trim() ||
    "UNKNOWN_BANK"
  );
}

function resolveDescriptionKey(row = {}, draft = {}) {
  return String(
    draft.analysisKey ||
      row.analysisKey ||
      draft.detayAciklama ||
      row.detayAciklama ||
      draft.fisAciklama ||
      row.fisAciklama ||
      row.aciklama ||
      ""
  ).trim();
}

function isDocumentOnlyDecision(row = {}, draft = {}) {
  const scope = String(
    draft.memoryScope ||
      draft.decisionScope ||
      row.memoryScope ||
      row.decisionScope ||
      row.accountingDecisionScope ||
      ""
  )
    .trim()
    .toUpperCase();
  if (scope === "DOCUMENT_ONLY") return true;
  if (row.documentOnly === true || draft.documentOnly === true) return true;
  if (row.learnForCompany === false && row.documentResolution === true) {
    return true;
  }
  return false;
}

function didAccountCodeChange(currentRow = {}, updatedRow = {}, draft = {}) {
  const before = compactCode(
    draft.originalAccountCode || currentRow.hesapKodu || currentRow.accountCode
  );
  const after = compactCode(
    updatedRow.hesapKodu || updatedRow.accountCode || draft.accountCode
  );
  return Boolean(after) && before !== after;
}

function isOnlyNonAccountEdit(currentRow = {}, updatedRow = {}, draft = {}) {
  if (didAccountCodeChange(currentRow, updatedRow, draft)) return false;
  const beforeDoc = String(currentRow.belgeTuru || "").trim().toUpperCase();
  const afterDoc = String(
    updatedRow.belgeTuru || draft.documentType || ""
  )
    .trim()
    .toUpperCase();
  const beforeNote = String(currentRow.kontrolNotu || "").trim();
  const afterNote = String(
    updatedRow.kontrolNotu || draft.controlNote || ""
  ).trim();
  const beforeDesc = String(
    currentRow.detayAciklama || currentRow.fisAciklama || ""
  ).trim();
  const afterDesc = String(
    updatedRow.detayAciklama ||
      updatedRow.fisAciklama ||
      draft.detayAciklama ||
      draft.fisAciklama ||
      ""
  ).trim();
  // Hesap aynı; yalnız belge türü / not / açıklama değiştiyse firma hafızasına yazma
  return (
    beforeDoc !== afterDoc || beforeNote !== afterNote || beforeDesc !== afterDesc
  );
}

export function collectAccountPlanCodes({
  companyId = "",
  company = null,
  accountPlanCodes = null,
  accountPlans = null,
} = {}) {
  if (Array.isArray(accountPlanCodes) && accountPlanCodes.length) {
    return accountPlanCodes
      .map((c) =>
        typeof c === "string"
          ? compactCode(c)
          : compactCode(c?.code || c?.hesapKodu || c?.accountCode)
      )
      .filter(Boolean);
  }
  const plans =
    accountPlans ||
    (typeof window !== "undefined" ? loadAccountPlansFromStorage() : {});
  const diag = getCompanyAccountPlansWithDiagnostics(
    plans,
    company || companyId
  );
  return (diag?.plans || [])
    .map((p) => compactCode(p.accountCode || p.code || p.hesapKodu))
    .filter(Boolean);
}

/**
 * Server yazma kapıları — UI öncesi / adapter içi.
 */
export function shouldPersistFisKontrolAccountingDecision({
  learnForCompany = false,
  companyId = "",
  accountCode = "",
  accountPlanCodes = null,
  direction = "",
  descriptionOrKey = "",
  isDocumentOnly = false,
  accountChanged = false,
  onlyNonAccountEdit = false,
  autoAnalysis = false,
} = {}) {
  if (autoAnalysis) {
    return { ok: false, reason: "auto_analysis" };
  }
  if (!learnForCompany) {
    return { ok: false, reason: "remember_not_checked" };
  }
  if (isDocumentOnly) {
    return { ok: false, reason: "document_only" };
  }
  const firmaId = String(companyId || "").trim();
  if (!firmaId) {
    return { ok: false, reason: "missing_company" };
  }
  const code = compactCode(accountCode);
  if (!code) {
    return { ok: false, reason: "missing_account_code" };
  }
  if (!String(direction || "").trim()) {
    return { ok: false, reason: "missing_direction" };
  }
  if (!String(descriptionOrKey || "").trim()) {
    return { ok: false, reason: "missing_signature_key" };
  }
  if (!accountChanged && onlyNonAccountEdit) {
    return { ok: false, reason: "non_account_edit_only" };
  }
  if (!accountChanged && !onlyNonAccountEdit) {
    // Hesap değişmedi ve öğrenilecek anlamlı alan yok
    return { ok: false, reason: "account_unchanged" };
  }
  const plan = Array.isArray(accountPlanCodes) ? accountPlanCodes : [];
  if (plan.length && !plan.includes(code)) {
    return { ok: false, reason: "account_not_in_plan" };
  }
  return { ok: true, reason: "" };
}

/**
 * Fiş Kontrol satır düzeltmesi → canonical USER_LEARNED persist.
 */
export async function persistFisKontrolAccountingDecision({
  learnForCompany = false,
  companyId = "",
  company = null,
  currentRow = null,
  updatedRow = null,
  draft = null,
  payload = null,
  bankName = "",
  accountPlanCodes = null,
  accountPlans = null,
  existingServerRows = null,
  createRecord = createLearningMemoryRecordDetailed,
  updateRecord = updateLearningMemoryRecordDetailed,
  fetchExisting =
    fetchLearningMemoryForCompanyDetailed,
  autoAnalysis = false,
} = {}) {
  const row = updatedRow || currentRow || {};
  const editDraft = draft || {};
  const firmaId = String(
    companyId || payload?.firmaId || payload?.companyId || row.firmaId || ""
  ).trim();
  const code = compactCode(row.hesapKodu || row.accountCode || editDraft.accountCode);
  const direction = resolveDirection(row, editDraft);
  const descriptionOrKey = resolveDescriptionKey(row, editDraft);
  const planCodes = collectAccountPlanCodes({
    companyId: firmaId,
    company,
    accountPlanCodes,
    accountPlans,
  });
  const accountChanged = didAccountCodeChange(currentRow || {}, row, editDraft);
  const onlyNonAccountEdit = isOnlyNonAccountEdit(
    currentRow || {},
    row,
    editDraft
  );
  const isDocumentOnly = isDocumentOnlyDecision(row, editDraft);

  const gate = shouldPersistFisKontrolAccountingDecision({
    learnForCompany,
    companyId: firmaId,
    accountCode: code,
    accountPlanCodes: planCodes,
    direction,
    descriptionOrKey,
    isDocumentOnly,
    accountChanged,
    onlyNonAccountEdit,
    autoAnalysis,
  });

  if (!gate.ok) {
    return {
      ok: false,
      learned: false,
      persisted: false,
      localOk: false,
      skipped: true,
      rejectReason: gate.reason,
      toastKind: learnForCompany ? "edit_memory_skipped" : "edit_only",
      message:
        learnForCompany && gate.reason !== "remember_not_checked"
          ? FIS_KONTROL_LEARN_MSG.EDIT_MEMORY_FAILED
          : FIS_KONTROL_LEARN_MSG.EDIT_ONLY,
    };
  }

  let serverRows = existingServerRows;
  if (!Array.isArray(serverRows)) {
    try {
      const fetched = await fetchExisting(firmaId);
      serverRows = (Array.isArray(fetched?.data) ? fetched.data : []).filter(
        (r) =>
          String(r.document_type || r.documentType || "").toUpperCase() ===
          BANK_STATEMENT_ACCOUNTING_DOC
      );
    } catch {
      serverRows = [];
    }
  }

  const bank = resolveBankName(row, payload, bankName);
  const transactionType = String(
    row.transactionType || editDraft.transactionType || "UNKNOWN"
  ).trim();
  const currency = String(row.currency || row.paraBirimi || "TRY").trim() || "TRY";
  const accountingScenario = String(
    row.accountingScenario || editDraft.accountingScenario || ""
  ).trim();

  const result = await persistUserConfirmedAccountingMemory({
    companyId: firmaId,
    bankId: bank,
    bankName: bank,
    direction,
    transactionType,
    currency,
    descriptionOrKey,
    analysisKey: String(row.analysisKey || editDraft.analysisKey || descriptionOrKey).trim(),
    accountCode: code,
    counterAccountCode: compactCode(
      row.karsiHesapKodu || row.counterAccountCode || editDraft.counterAccountCode
    ),
    accountPlanCodes: planCodes.length ? planCodes : null,
    company,
    statementAccountType: "",
    createdBy: "",
    source: FIS_KONTROL_MEMORY_SOURCE,
    seedRow: {
      accountingScenario,
      sourceModule: FIS_KONTROL_SOURCE_MODULE,
      lucaLeg:
        Number(row.borc) > 0 ? "debit" : Number(row.alacak) > 0 ? "credit" : "",
    },
    existingServerRows: serverRows,
    createRecord,
    updateRecord,
    rememberForCompany: true,
    // Server-first: pending local yazılmaz; başarıda active local güncellenir
    skipLocalSave: true,
    auditReason: "fis_kontrol_user_confirmed",
    sourceModule: FIS_KONTROL_SOURCE_MODULE,
    accountingScenario,
  });

  if (result?.persisted || result?.learned) {
    return {
      ...result,
      ok: true,
      skipped: false,
      toastKind: "saved",
      message: FIS_KONTROL_LEARN_MSG.SAVED,
      sourceModule: FIS_KONTROL_SOURCE_MODULE,
    };
  }

  return {
    ...result,
    ok: false,
    skipped: false,
    toastKind: "edit_memory_failed",
    message: FIS_KONTROL_LEARN_MSG.EDIT_MEMORY_FAILED,
    // Local-only başarıyı canonical öğrenme gibi gösterme
    learned: false,
    localCanonical: false,
  };
}
