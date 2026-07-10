import { formatDateTime } from "@/src/utils/companyCenter";
import { normalizeParserText } from "@/src/utils/textNormalize";
import { buildStandardLucaDescription } from "@/src/utils/muhasebeDescriptionStandards";

export const ACCOUNTING_RULE_STORAGE_KEY = "annvero_accounting_rules_v1";

export const KAYNAK_TIPLERI = [
  "Banka",
  "Elektraweb",
  "Kredi Kartı",
  "Manuel",
  "XML/e-Fatura",
];

export const SAMPLE_ACCOUNTING_RULES = [
  {
    kaynakTipi: "Banka",
    aramaMetni: "GOOGLE",
    useRegex: false,
    hesapKodu: "760",
    belgeTuru: "DK",
    fisAciklamaSablonu: "GOOGLE GİDERİ",
    oncelik: 10,
  },
  {
    kaynakTipi: "Banka",
    aramaMetni: "SPOTIFY",
    useRegex: false,
    hesapKodu: "770",
    belgeTuru: "DK",
    fisAciklamaSablonu: "SPOTIFY GİDERİ",
    oncelik: 10,
  },
  {
    kaynakTipi: "Elektraweb",
    aramaMetni: "BATUHAN BULUT",
    useRegex: false,
    hesapKodu: "",
    belgeTuru: "SMM",
    fisAciklamaSablonu: "SMM - {ACIKLAMA}",
    oncelik: 20,
  },
  {
    kaynakTipi: "Banka",
    aramaMetni: "NOTER",
    useRegex: false,
    hesapKodu: "",
    belgeTuru: "NM",
    fisAciklamaSablonu: "NOTER GİDERİ",
    oncelik: 20,
  },
  {
    kaynakTipi: "XML/e-Fatura",
    aramaMetni: "^GIB",
    useRegex: true,
    hesapKodu: "",
    belgeTuru: "EA",
    fisAciklamaSablonu: "{ACIKLAMA}",
    oncelik: 5,
  },
  {
    kaynakTipi: "Elektraweb",
    aramaMetni: "MRT|MR1",
    useRegex: true,
    hesapKodu: "",
    belgeTuru: "EF",
    fisAciklamaSablonu: "{ACIKLAMA}",
    oncelik: 15,
  },
];

export function createEmptyAccountingRule(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    companyId: "",
    kaynakTipi: "Banka",
    aramaMetni: "",
    useRegex: false,
    hesapKodu: "",
    belgeTuru: "DK",
    fisAciklamaSablonu: "",
    oncelik: 100,
    isActive: true,
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function normalizeAccountingRule(rule = {}) {
  return {
    id: rule.id || crypto.randomUUID(),
    companyId: String(rule.companyId || "").trim(),
    kaynakTipi: String(rule.kaynakTipi || "Banka").trim(),
    aramaMetni: String(rule.aramaMetni || rule.searchText || "").trim(),
    useRegex: Boolean(rule.useRegex),
    hesapKodu: String(rule.hesapKodu || rule.accountCode || "").trim(),
    belgeTuru: String(rule.belgeTuru || rule.documentType || "DK")
      .trim()
      .toUpperCase(),
    fisAciklamaSablonu: String(
      rule.fisAciklamaSablonu || rule.descriptionTemplate || ""
    ).trim(),
    oncelik: Number(rule.oncelik ?? rule.priority ?? 100),
    isActive: rule.isActive !== false,
    updatedAt: rule.updatedAt || Date.now(),
  };
}

export function loadAccountingRulesFromStorage() {
  if (typeof window === "undefined") return [];

  try {
    const saved = localStorage.getItem(ACCOUNTING_RULE_STORAGE_KEY);
    if (!saved) return [];

    const parsed = JSON.parse(saved);
    const rules = Array.isArray(parsed?.rules) ? parsed.rules : Array.isArray(parsed) ? parsed : [];
    return rules.map(normalizeAccountingRule);
  } catch {
    return [];
  }
}

export function saveAccountingRulesToStorage(rules = []) {
  if (typeof window === "undefined") return;

  localStorage.setItem(
    ACCOUNTING_RULE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      rules: rules.map(normalizeAccountingRule),
    })
  );
}

export function formatAccountingRuleTemplate(template, description) {
  const text = String(template || "").trim();
  if (!text) return "";

  return text
    .replaceAll("{ACIKLAMA}", description)
    .replaceAll("{aciklama}", description);
}

function normalizeKaynakTipi(value) {
  return normalizeParserText(value || "");
}

function filterRulesForContext(rules = [], context = {}) {
  const companyId = String(context.companyId || context.firmaId || "").trim();
  const kaynakTipi = String(context.kaynakTipi || "").trim();

  return (rules || [])
    .filter((rule) => rule.isActive !== false)
    .filter((rule) => !companyId || rule.companyId === companyId)
    .filter((rule) => {
      if (!kaynakTipi) return true;
      return normalizeKaynakTipi(rule.kaynakTipi) === normalizeKaynakTipi(kaynakTipi);
    })
    .sort(
      (left, right) =>
        Number(left.oncelik ?? 999) - Number(right.oncelik ?? 999) ||
        String(left.aramaMetni || "").localeCompare(String(right.aramaMetni || ""), "tr")
    );
}

export function ruleMatchesText(rule, text) {
  const source = String(text || "");
  const pattern = String(rule?.aramaMetni || "").trim();
  if (!pattern || !source) return false;

  if (rule.useRegex) {
    try {
      return new RegExp(pattern, "i").test(source);
    } catch {
      return false;
    }
  }

  return normalizeParserText(source).includes(normalizeParserText(pattern));
}

export function getMatchingAccountingRules(text, context = {}) {
  const rules = filterRulesForContext(context.rules || [], context);
  return rules.filter((rule) => ruleMatchesText(rule, text));
}

export function matchAccountingRule(text, context = {}) {
  const matches = getMatchingAccountingRules(text, context);
  return matches[0] || null;
}

export function testAccountingRule(text, context = {}) {
  const matches = getMatchingAccountingRules(text, context);

  return {
    matched: matches[0] || null,
    candidates: matches,
  };
}

export function applyAccountingRuleToBankMovement(rule, description, direction) {
  const lucaDescription =
    formatAccountingRuleTemplate(rule.fisAciklamaSablonu, description) ||
    buildStandardLucaDescription({
      aciklama: description,
      description,
      yon: direction,
      direction,
    });

  return {
    counterAccountCode: String(rule.hesapKodu || "").trim(),
    documentType: String(rule.belgeTuru || "DK").trim().toUpperCase(),
    lucaDescription,
    ruleAciklama: lucaDescription,
  };
}

export function mapAccountingRuleToListRow(rule, companyName = "") {
  return {
    id: rule.id,
    companyId: rule.companyId,
    firmaAdi: companyName || rule.companyId || "-",
    kaynakTipi: rule.kaynakTipi,
    aramaMetni: rule.aramaMetni,
    belgeTuru: rule.belgeTuru,
    hesapKodu: rule.hesapKodu,
    fisAciklamaSablonu: rule.fisAciklamaSablonu,
    oncelik: rule.oncelik,
    isActive: rule.isActive !== false,
    useRegex: Boolean(rule.useRegex),
    sonGuncelleme: rule.updatedAt,
    raw: rule,
  };
}

export function filterAccountingRuleRows(
  rows = [],
  { search = "", companyId = "", kaynakTipi = "" } = {}
) {
  const query = search.trim().toLocaleLowerCase("tr");
  const kaynakFilter = normalizeKaynakTipi(kaynakTipi);

  return rows.filter((row) => {
    if (companyId && row.companyId !== companyId) return false;

    if (kaynakFilter && kaynakFilter !== "TUMU") {
      if (normalizeKaynakTipi(row.kaynakTipi) !== kaynakFilter) return false;
    }

    if (!query) return true;

    const haystack = [
      row.firmaAdi,
      row.kaynakTipi,
      row.aramaMetni,
      row.belgeTuru,
      row.hesapKodu,
      row.fisAciklamaSablonu,
      String(row.oncelik),
    ]
      .join(" ")
      .toLocaleLowerCase("tr");

    return haystack.includes(query);
  });
}

export function formatAccountingRuleDate(value) {
  if (!value) return "-";
  return formatDateTime(value);
}

export function buildSampleRulesForCompany(companyId) {
  return SAMPLE_ACCOUNTING_RULES.map((sample) =>
    normalizeAccountingRule({
      ...createEmptyAccountingRule(),
      ...sample,
      companyId,
      updatedAt: Date.now(),
    })
  );
}

export function buildAccountingRuleFormDraft(rule) {
  return {
    companyId: rule.companyId || "",
    kaynakTipi: rule.kaynakTipi || "Banka",
    aramaMetni: rule.aramaMetni || "",
    useRegex: Boolean(rule.useRegex),
    hesapKodu: rule.hesapKodu || "",
    belgeTuru: rule.belgeTuru || "DK",
    fisAciklamaSablonu: rule.fisAciklamaSablonu || "",
    oncelik: rule.oncelik ?? 100,
    isActive: rule.isActive !== false,
  };
}

export function buildAccountingRuleFromDraft(draft, existingRule = null) {
  return normalizeAccountingRule({
    ...(existingRule || createEmptyAccountingRule()),
    ...draft,
    updatedAt: Date.now(),
  });
}
