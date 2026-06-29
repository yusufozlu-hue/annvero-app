import { normalizeAccountPlanForMatching } from "@/src/utils/companyCenter";
import {
  buildCariSearchCandidates,
  normalizeCariNameCore,
  resolveCariAccountMatch,
} from "@/src/utils/cariAccountMatcher";
import { extractSeriesPrefix, MEMORY_MATCH_LABEL } from "@/src/utils/previewRowEdit";
import { normalizeParserText } from "@/src/utils/textNormalize";

export const ESLESME_YONTEMI = {
  OGRENEN_HAFIZA: "Öğrenen Hafıza",
  CARI_ESLESME: "Cari Eşleşme",
  HESAP_PLANI: "Hesap Planı",
  BELGE_TURU: "Belge Türü",
  MANUEL: "Manuel düzenleme",
};

const SMM_PERSON_RULES = [
  { phrase: "BATUHAN BULUT", label: "BATUHAN BULUT" },
  { phrase: "YUSUF OZLU", label: "YUSUF ÖZLÜ" },
  { phrase: "YUSUF ÖZLÜ", label: "YUSUF ÖZLÜ" },
];

const MATCH_FAILURE = {
  hesapKodu: "",
  kontrolNotu: "Hesap kodu bulunamadı",
  riskDurumu: "HESAP_EKSIK",
};

export function normalizeMatchText(value) {
  return normalizeCariNameCore(normalizeParserText(value));
}

function compactAccount(value) {
  return normalizeMatchText(value).replace(/\s+/g, "");
}

function getAccountCode(account) {
  return account?.accountCode || account?.hesapKodu || account?.code || "";
}

function getAccountName(account) {
  return account?.accountName || account?.hesapAdi || account?.name || "";
}

function accountExistsInPlan(companyPlans, code) {
  if (!code) return false;
  const wanted = compactAccount(code);
  return (companyPlans || []).some(
    (account) =>
      account?.isActive !== false &&
      compactAccount(getAccountCode(account)) === wanted
  );
}

function getActivePlanAccounts(companyPlans = []) {
  return companyPlans.filter((account) => account?.isActive !== false);
}

function uniqueNonEmpty(values = []) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    const key = normalizeMatchText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }

  return result;
}

export function buildElektrawebCompanyMappings(company = {}) {
  return {
    documentSeriesRules: company.documentSeriesRules || [],
    accountingRules: company.accountingRules || {},
    employees: company.employees || [],
  };
}

export function buildElektrawebCombinedSearchText(row = {}) {
  return uniqueNonEmpty([
    row.fisAciklama,
    row.detayAciklama,
    row.aciklama,
    row.cariUnvan,
    row.belgeAciklama,
  ]).join(" ");
}

export function collectElektrawebSearchCandidates(row = {}) {
  const fieldTexts = uniqueNonEmpty([
    row.fisAciklama,
    row.detayAciklama,
    row.aciklama,
    row.cariUnvan,
    row.belgeAciklama,
  ]);

  const candidates = new Set();

  for (const text of fieldTexts) {
    candidates.add(text);
    candidates.add(normalizeMatchText(text));

    for (const cariCandidate of buildCariSearchCandidates({ description: text })) {
      candidates.add(cariCandidate);
      candidates.add(normalizeMatchText(cariCandidate));
    }
  }

  return [...candidates].filter((value) => normalizeMatchText(value).length >= 3);
}

function buildRowDebug(row, selectedCompanyAccountPlan, nedenBos = "") {
  const aciklama = buildElektrawebCombinedSearchText(row);
  const detayAciklama = String(
    row.detayAciklama || row.aciklama || row.fisAciklama || ""
  ).trim();

  return {
    aciklama,
    detayAciklama,
    normalizeAciklama: normalizeMatchText(aciklama),
    hesapPlaniSatirSayisi: selectedCompanyAccountPlan?.length || 0,
    bulunanHesapKodu: "",
    eslesmeYontemi: "",
    nedenBos,
  };
}

function buildMatchSuccess({
  hesapKodu,
  eslesmeYontemi,
  hafizaEslesme = false,
  kontrolNotu = "",
  debug,
}) {
  return {
    hesapKodu,
    eslesmeYontemi,
    kontrolNotu,
    riskDurumu: "",
    hafizaEslesme,
    hesapEslesmeNotlari: [],
    debug: {
      ...debug,
      bulunanHesapKodu: hesapKodu,
      eslesmeYontemi,
      nedenBos: "",
    },
  };
}

function buildMatchFailure(debug, nedenBos) {
  return {
    ...MATCH_FAILURE,
    hafizaEslesme: false,
    eslesmeYontemi: "",
    hesapEslesmeNotlari: [],
    debug: {
      ...debug,
      bulunanHesapKodu: "",
      eslesmeYontemi: "",
      nedenBos,
    },
  };
}

function findLearningMemoryAccount(learningMemory, row, companyMappings = {}) {
  const combinedText = normalizeMatchText(buildElektrawebCombinedSearchText(row));
  const fieldTexts = uniqueNonEmpty([
    row.fisAciklama,
    row.detayAciklama,
    row.aciklama,
    row.cariUnvan,
    row.belgeAciklama,
  ]).map((value) => normalizeMatchText(value));

  const seriesPrefix = normalizeMatchText(
    extractSeriesPrefix(combinedText, companyMappings.documentSeriesRules || [])
  );

  const records = (learningMemory || []).filter(
    (record) => record?.is_active !== false
  );

  let best = null;
  let bestScore = 0;

  for (const record of records) {
    const keyword = normalizeMatchText(record.keyword);
    if (!keyword) continue;

    const matchedInCombined = combinedText.includes(keyword);
    const matchedInField = fieldTexts.some(
      (field) => field.includes(keyword) || keyword.includes(field)
    );

    if (!matchedInCombined && !matchedInField) continue;

    let score = keyword.length;
    const recordSource = normalizeMatchText(record.source_module || "");
    const recordDocumentType = normalizeMatchText(record.document_type || "");
    const rowDocumentType = normalizeMatchText(row.belgeTuru || "");

    if (recordSource === "ELEKTRAWEB") score += 25;
    if (seriesPrefix && combinedText.includes(seriesPrefix)) score += 10;
    if (recordDocumentType && rowDocumentType && recordDocumentType === rowDocumentType) {
      score += 8;
    }
    if (matchedInField) score += 5;

    if (!best || score > bestScore) {
      best = record;
      bestScore = score;
    }
  }

  if (!best?.account_code) return null;

  return {
    code: String(best.account_code).trim(),
    label: MEMORY_MATCH_LABEL,
  };
}

function findPlanExactMatch(companyPlans, searchCandidates = []) {
  for (const candidate of searchCandidates) {
    const target = normalizeMatchText(candidate);
    if (!target || target.length < 3) continue;

    for (const account of getActivePlanAccounts(companyPlans)) {
      const name = normalizeMatchText(getAccountName(account));
      if (name === target) {
        return getAccountCode(account);
      }
    }
  }

  return "";
}

function findPlanContainsMatch(companyPlans, searchCandidates = []) {
  let bestCode = "";
  let bestScore = 0;

  for (const candidate of searchCandidates) {
    const target = normalizeMatchText(candidate);
    if (!target || target.length < 3) continue;

    for (const account of getActivePlanAccounts(companyPlans)) {
      const name = normalizeMatchText(getAccountName(account));
      if (!name) continue;

      let score = 0;

      if (name.includes(target)) {
        score = 800 + target.length;
      } else if (target.includes(name) && name.length >= 5) {
        score = 650 + name.length;
      }

      if (score > bestScore) {
        bestScore = score;
        bestCode = getAccountCode(account);
      }
    }
  }

  return bestCode;
}

function findEmployeeAccountMatch(employees = [], combinedText = "") {
  const text = normalizeMatchText(combinedText);
  if (!text) return null;

  for (const employee of employees) {
    if (employee?.isActive === false) continue;

    const fullName = normalizeMatchText(employee.fullName);
    if (fullName.length < 3 || !text.includes(fullName)) continue;

    const code = String(
      employee.salaryAccountCode || employee.advanceAccountCode || ""
    ).trim();

    if (!code) continue;

    return { code, label: employee.fullName };
  }

  return null;
}

function findNoterAccountMatch(companyPlans, combinedText = "") {
  const text = normalizeMatchText(combinedText);
  if (!text.includes("NOTER")) return null;

  for (const account of getActivePlanAccounts(companyPlans)) {
    const name = normalizeMatchText(getAccountName(account));
    if (name.includes("NOTER")) {
      return { code: getAccountCode(account), label: "NOTER", found: true };
    }
  }

  for (const account of getActivePlanAccounts(companyPlans)) {
    const code = compactAccount(getAccountCode(account));
    const name = normalizeMatchText(getAccountName(account));
    if (
      code.startsWith("770") &&
      (name.includes("NOTER") || name.includes("GENEL GIDER"))
    ) {
      return { code: getAccountCode(account), label: "NOTER gider", found: true };
    }
  }

  return { code: "", label: "NOTER", found: false };
}

function findSmmPersonMatch(companyPlans, combinedText = "", employees = []) {
  const text = normalizeMatchText(combinedText);

  for (const rule of SMM_PERSON_RULES) {
    const phrase = normalizeMatchText(rule.phrase);
    if (!phrase || !text.includes(phrase)) continue;

    const employeeMatch = (employees || []).find((employee) => {
      if (employee?.isActive === false) return false;
      const fullName = normalizeMatchText(employee.fullName);
      return fullName.includes(phrase) || phrase.includes(fullName);
    });

    if (employeeMatch) {
      const code = String(
        employeeMatch.salaryAccountCode || employeeMatch.advanceAccountCode || ""
      ).trim();
      if (code) {
        return { code, label: rule.label, found: true };
      }
    }

    for (const account of getActivePlanAccounts(companyPlans)) {
      const name = normalizeMatchText(getAccountName(account));
      if (name.includes(phrase)) {
        return { code: getAccountCode(account), label: rule.label, found: true };
      }
    }

    return { code: "", label: rule.label, found: false };
  }

  return null;
}

function getDefaultAccountByBelgeTuru(belgeTuru, accountingRules = {}) {
  const type = String(belgeTuru || "").trim().toUpperCase();

  if (type === "DK") return "";
  if (type === "KR") return String(accountingRules.creditCardAccountCode || "").trim();
  if (type === "SMM") return String(accountingRules.smmAccountCode || "").trim();

  return "";
}

export function matchAccountCode(
  row,
  selectedCompanyAccountPlan = [],
  learningMemory = [],
  companyMappings = {}
) {
  const accountPlan = normalizeAccountPlanForMatching(selectedCompanyAccountPlan);
  const debug = buildRowDebug(row, accountPlan);
  const combinedText = buildElektrawebCombinedSearchText(row);
  const searchCandidates = collectElektrawebSearchCandidates(row);
  const employees = companyMappings.employees || [];

  if (!accountPlan.length) {
    return buildMatchFailure(debug, "hesap_plani_yuklu_degil");
  }

  if (row.manuallyEdited && String(row.hesapKodu || "").trim()) {
    return buildMatchSuccess({
      hesapKodu: String(row.hesapKodu).trim(),
      eslesmeYontemi: row.eslesmeYontemi || ESLESME_YONTEMI.MANUEL,
      hafizaEslesme: Boolean(row.hafizaEslesme),
      kontrolNotu: String(row.kontrolNotu || "").trim(),
      debug,
    });
  }

  const existingCode = String(row.hesapKodu || "").trim();
  if (existingCode && accountExistsInPlan(accountPlan, existingCode)) {
    return buildMatchSuccess({
      hesapKodu: existingCode,
      eslesmeYontemi: "Excel",
      kontrolNotu: String(row.kontrolNotu || "").trim(),
      debug,
    });
  }

  const memoryMatch = findLearningMemoryAccount(
    learningMemory,
    row,
    companyMappings
  );

  if (memoryMatch?.code) {
    return buildMatchSuccess({
      hesapKodu: memoryMatch.code,
      eslesmeYontemi: ESLESME_YONTEMI.OGRENEN_HAFIZA,
      hafizaEslesme: true,
      kontrolNotu: MEMORY_MATCH_LABEL,
      debug,
    });
  }

  const cariMatch = resolveCariAccountMatch(accountPlan, {
    description: combinedText,
    lucaDescription: row.fisAciklama,
    counterpartyName: row.cariUnvan,
  });

  if (cariMatch.code) {
    return buildMatchSuccess({
      hesapKodu: cariMatch.code,
      eslesmeYontemi: ESLESME_YONTEMI.CARI_ESLESME,
      kontrolNotu: cariMatch.note || "Cari hesap eşleşti",
      debug,
    });
  }

  const employeeMatch = findEmployeeAccountMatch(employees, combinedText);
  if (employeeMatch?.code) {
    return buildMatchSuccess({
      hesapKodu: employeeMatch.code,
      eslesmeYontemi: ESLESME_YONTEMI.CARI_ESLESME,
      kontrolNotu: `${employeeMatch.label} personel hesabı eşleşti`,
      debug,
    });
  }

  const noterMatch = findNoterAccountMatch(accountPlan, combinedText);
  if (noterMatch?.found && noterMatch.code) {
    return buildMatchSuccess({
      hesapKodu: noterMatch.code,
      eslesmeYontemi: ESLESME_YONTEMI.CARI_ESLESME,
      kontrolNotu: `${noterMatch.label} hesabı eşleşti`,
      debug,
    });
  }

  const smmMatch = findSmmPersonMatch(
    accountPlan,
    combinedText,
    employees
  );
  if (smmMatch?.found && smmMatch.code) {
    return buildMatchSuccess({
      hesapKodu: smmMatch.code,
      eslesmeYontemi: ESLESME_YONTEMI.CARI_ESLESME,
      kontrolNotu: `${smmMatch.label} hesabı eşleşti`,
      debug,
    });
  }

  const exactCode = findPlanExactMatch(accountPlan, searchCandidates);
  if (exactCode) {
    return buildMatchSuccess({
      hesapKodu: exactCode,
      eslesmeYontemi: ESLESME_YONTEMI.HESAP_PLANI,
      kontrolNotu: "Hesap planında tam unvan eşleşti",
      debug,
    });
  }

  const containsCode = findPlanContainsMatch(
    accountPlan,
    searchCandidates
  );
  if (containsCode) {
    return buildMatchSuccess({
      hesapKodu: containsCode,
      eslesmeYontemi: ESLESME_YONTEMI.HESAP_PLANI,
      kontrolNotu: "Hesap planında içerir eşleşme",
      debug,
    });
  }

  const defaultCode = getDefaultAccountByBelgeTuru(
    row.belgeTuru,
    companyMappings.accountingRules || {}
  );
  if (defaultCode && accountExistsInPlan(accountPlan, defaultCode)) {
    return buildMatchSuccess({
      hesapKodu: defaultCode,
      eslesmeYontemi: ESLESME_YONTEMI.BELGE_TURU,
      kontrolNotu: `${row.belgeTuru} belge türü varsayılan hesabı`,
      debug,
    });
  }

  if (noterMatch && noterMatch.found === false) {
    return buildMatchFailure(debug, "noter_hesabi_bulunamadi");
  }

  if (smmMatch && smmMatch.found === false) {
    return buildMatchFailure(debug, "smm_hesabi_bulunamadi");
  }

  return buildMatchFailure(debug, "eslesme_bulunamadi");
}

export function applyMatchResultToRow(row, match) {
  return {
    ...row,
    hesapKodu: match.hesapKodu,
    kontrolNotu: match.kontrolNotu,
    riskDurumu: match.riskDurumu || (match.hesapKodu ? "" : "HESAP_EKSIK"),
    hafizaEslesme: Boolean(match.hafizaEslesme),
    eslesmeYontemi: match.eslesmeYontemi || "",
    hesapEslesmeNotlari: match.hesapEslesmeNotlari || [],
  };
}

export function applyElektrawebAccountMatching(rows = [], context = {}) {
  const selectedCompanyAccountPlan = normalizeAccountPlanForMatching(
    context.selectedCompanyAccountPlan ||
      context.companyPlans ||
      context.accountPlan ||
      []
  );
  const learningMemory = context.learningMemory || [];
  const companyMappings =
    context.companyMappings ||
    buildElektrawebCompanyMappings({
      documentSeriesRules: context.documentSeriesRules,
      accountingRules: context.accountingRules,
      employees: context.employees,
    });

  const debugRows = [];

  const matchedRows = rows.map((row) => {
    const match = matchAccountCode(
      row,
      selectedCompanyAccountPlan,
      learningMemory,
      companyMappings
    );
    debugRows.push(match.debug);
    return applyMatchResultToRow(row, match);
  });

  logElektrawebAccountMatchReport(
    debugRows,
    selectedCompanyAccountPlan.length
  );

  return matchedRows;
}

export function logElektrawebAccountMatchReport(debugRows = [], planRowCount = 0, limit = 20) {
  const matched = debugRows.filter((row) => row.bulunanHesapKodu).length;
  const unmatched = debugRows.length - matched;
  const hesapPlaniSatirSayisi =
    planRowCount || debugRows[0]?.hesapPlaniSatirSayisi || 0;

  console.log("[elektraweb-account-match] özet", {
    hesapPlaniSatirSayisi,
    toplamSatir: debugRows.length,
    eslesen: matched,
    eslesmeyen: unmatched,
  });

  debugRows.slice(0, limit).forEach((row, index) => {
    console.log(`[elektraweb-account-match] satir-${index + 1}`, {
      aciklama: row.aciklama,
      detayAciklama: row.detayAciklama,
      normalizeAciklama: row.normalizeAciklama,
      hesapPlaniSatirSayisi: row.hesapPlaniSatirSayisi,
      bulunanHesapKodu: row.bulunanHesapKodu,
      eslesmeYontemi: row.eslesmeYontemi,
      nedenBos: row.nedenBos,
    });
  });

  return { toplamSatir: debugRows.length, eslesen: matched, eslesmeyen: unmatched };
}

export function getElektrawebEslesmeYontemiLabel(method) {
  return String(method || "").trim();
}

// Geriye dönük uyumluluk
export const normalizeElektrawebMatchText = normalizeMatchText;

export function resolveElektrawebAccountCode(row, context = {}) {
  const match = matchAccountCode(
    row,
    context.companyPlans || context.accountPlan || [],
    context.learningMemory || [],
    context.companyMappings ||
      buildElektrawebCompanyMappings({
        documentSeriesRules: context.documentSeriesRules,
        accountingRules: context.accountingRules,
        employees: context.employees,
      })
  );

  return {
    ...match,
    debug: match.debug,
  };
}
