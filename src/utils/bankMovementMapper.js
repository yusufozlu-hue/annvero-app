import { resolve102BankAccount } from "@/src/utils/companyCenter";
import {
  buildCreditCardPaymentDescription,
  findCreditCardByText,
  getCreditCardAccount,
} from "@/src/utils/creditCardAccountResolver";

export function normalizeParserText(value) {
  return String(value || "")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ş", "S")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C")
    .replace(/[.,/()\-_*:;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactAccount(value) {
  return normalizeParserText(value).replace(/\s+/g, "");
}

export function formatParserDate(dateText) {
  if (!dateText) return "";

  if (dateText instanceof Date) {
    const day = String(dateText.getDate()).padStart(2, "0");
    const month = String(dateText.getMonth() + 1).padStart(2, "0");
    const year = dateText.getFullYear();
    return `${day}.${month}.${year}`;
  }

  const text = String(dateText);

  if (text.includes("-")) {
    const [year, month, day] = text.split("-");
    return `${day}.${month}.${year}`;
  }

  return text.split(" ")[0];
}

function getDefaultBankLucaCode(bankAccounts = []) {
  const activeBank = bankAccounts.find((bank) => bank.isActive !== false);
  return activeBank?.lucaAccountCode || "102";
}

function findBankRule(companyRules, description) {
  const rules = companyRules?.banka || [];
  const text = normalizeParserText(description);

  return (
    rules.find((rule) => {
      const keyword = normalizeParserText(rule.anahtar);
      return keyword && text.includes(keyword);
    }) || null
  );
}

function findFaturaRule(companyRules, description) {
  const rules = companyRules?.fatura || [];
  const text = normalizeParserText(description);

  return (
    rules.find((rule) => {
      const keyword = normalizeParserText(rule.anahtar);
      return keyword && text.includes(keyword);
    }) || null
  );
}

function findLegacyRule(legacyRules, description) {
  const text = normalizeParserText(description);

  return (
    legacyRules.find((item) =>
      item.anahtarlar?.some((keyword) => text.includes(normalizeParserText(keyword)))
    ) || null
  );
}

function isCreditCardPaymentText(description) {
  const text = normalizeParserText(description);

  return (
    text.includes("K KART") ||
    text.includes("KREDI KART") ||
    text.includes("KREDİ KART") ||
    text.includes("EKSTRE BORC") ||
    text.includes("EKSTRE BORÇ")
  );
}

function accountExistsInPlan(companyPlans, accountCode) {
  if (!accountCode) return false;

  const wanted = compactAccount(accountCode);

  return companyPlans.some((account) => {
    const code = account.accountCode || account.hesapKodu || "";
    return compactAccount(code) === wanted;
  });
}

function isGenericCariAccount(accountCode) {
  const compact = compactAccount(accountCode);
  return compact.startsWith("320") || compact.startsWith("120");
}

function extractCariNames(description) {
  const raw = String(description || "");
  const names = [];

  const pushPart = (part) => {
    const cleaned = normalizeParserText(part);
    if (cleaned) names.push(cleaned);
  };

  // "-" sonrası bölüm (kişi/cari adı genelde sonda olur)
  if (raw.includes("-")) {
    const parts = raw.split("-");
    pushPart(parts[parts.length - 1]);
  }

  // "/" sonrası bölüm
  if (raw.includes("/")) {
    const parts = raw.split("/");
    pushPart(parts[parts.length - 1]);
  }

  // Son kelime grupları (son 2 ve son 3 kelime) ayrıca cari adı adayı
  const words = normalizeParserText(raw).split(" ").filter(Boolean);

  if (words.length >= 2) {
    pushPart(words.slice(-2).join(" "));
  }

  if (words.length >= 3) {
    pushPart(words.slice(-3).join(" "));
  }

  pushPart(raw);

  return [...new Set(names)];
}

export function findCariAccountInPlan(companyPlans, description) {
  if (!companyPlans?.length) return "";

  const fullText = normalizeParserText(description);
  const haystacks = [fullText, ...extractCariNames(description)].filter(Boolean);

  let best = null;

  for (const account of companyPlans) {
    const rawName = account.accountName || account.hesapAdi || "";
    const name = normalizeParserText(rawName);

    if (!name || name.length < 3) continue;

    const nameWords = name.split(" ").filter((word) => word.length >= 2);

    const matched = haystacks.some((hay) => {
      if (!hay) return false;
      if (hay.includes(name)) return true;
      return nameWords.length >= 2 && nameWords.every((word) => hay.includes(word));
    });

    if (!matched) continue;

    const code = account.accountCode || account.hesapKodu || "";
    if (!code) continue;

    if (!best || name.length > best.nameLength) {
      best = { code, nameLength: name.length };
    }
  }

  return best?.code || "";
}

export function buildFallbackLucaDescription(row) {
  const raw = String(row.aciklama || row.description || "");
  const text = normalizeParserText(raw);
  const direction = row.yon || row.direction;

  const temiz = raw
    .replace(/^INT[-\s]*/i, "")
    .replace(/^MOBİL[-\s]*/i, "")
    .replace(/^MOBIL[-\s]*/i, "")
    .replace(/^CEP ŞUBE[-\s]*/i, "")
    .replace(/^CEP SUBE[-\s]*/i, "")
    .trim();

  if (
    text.includes("KESINTI") ||
    text.includes("BKM UCR") ||
    text.includes("MASRAF") ||
    text.includes("KOMISYON")
  ) {
    return "HAVALE/EFT MASRAFI";
  }

  if (text.includes("POS") && direction === "GIRIS") return "POS TAHSİLATI";
  if (text.includes("POS") && direction === "CIKIS") return "POS KOMİSYONU";
  if (text.includes("DOVIZ")) return "DÖVİZ ALIŞ / SATIŞ İŞLEMİ";
  if (text.includes("SGK")) return "SGK ÖDEMESİ";
  if (text.includes("VERGI") || text.includes("VERGİ")) return "VERGİ ÖDEMESİ";
  if (text.includes("KENDI HESABIMIZA")) return "VİRMAN";
  if (direction === "GIRIS") return `GLN. HVL / ${temiz}`;

  return `GÖND. HVL / ${temiz}`;
}

function formatRuleDescription(rule, description) {
  const template = rule?.aciklama || rule?.description || "";

  if (!template) return "";

  return template.replaceAll("{ACIKLAMA}", description).replaceAll("{aciklama}", description);
}

function appendWarning(warnings, message) {
  if (!message) return;
  if (!warnings.includes(message)) warnings.push(message);
}

export function mapParsedRowToStandardMovement(rawRow, context) {
  const {
    selectedCompany,
    companyPlans = [],
    companyRules = {},
    selectedBank,
    legacyRules = [],
  } = context;

  const description = String(rawRow.aciklama || rawRow.description || "").trim();
  const amount = Math.abs(Number(rawRow.tutar ?? rawRow.amount ?? 0));
  const direction = rawRow.yon === "CIKIS" || rawRow.direction === "CIKIS" ? "CIKIS" : "GIRIS";
  const date = formatParserDate(rawRow.tarih || rawRow.date);
  const warnings = [];

  let matchedRule = null;
  let accountCode = "";
  let counterAccountCode = "";
  let lucaDescription = "";
  let documentType = "DK";

  const bankLucaBase = resolve102BankAccount(
    selectedCompany?.bankAccounts || [],
    "102",
    getDefaultBankLucaCode(selectedCompany?.bankAccounts)
  );

  accountCode = bankLucaBase;

  const creditCard =
    findCreditCardByText(selectedCompany?.creditCards || [], description) ||
    (isCreditCardPaymentText(description)
      ? findCreditCardByText(selectedCompany?.creditCards || [], description)
      : null);

  const isCardPaymentRow = !!creditCard || isCreditCardPaymentText(description);

  if (isCardPaymentRow) {
    const card =
      creditCard ||
      (selectedCompany?.creditCards || []).find((item) => item.isActive !== false) ||
      null;

    const resolvedCard = getCreditCardAccount({
      creditCard: card,
      paymentDate: date || new Date(),
      installmentYearShift: false,
    });

    matchedRule = {
      source: "creditCard",
      islem: "KREDI KARTI",
      anahtar: card?.lastFourDigits || card?.cardName || "",
    };

    counterAccountCode = resolvedCard.accountCode || "";
    documentType = "KR";
    lucaDescription = buildCreditCardPaymentDescription({
      creditCard: card,
      paymentDate: date || new Date(),
      rawDescription: description,
    });

    if (resolvedCard.warning) appendWarning(warnings, resolvedCard.warning);
    if (!card) appendWarning(warnings, "Kredi kartı eşleşmedi");
  } else {
    const engineRule = findBankRule(companyRules, description);
    const legacyRule = findLegacyRule(legacyRules, description);

    matchedRule = engineRule || legacyRule || null;

    if (engineRule) {
      lucaDescription =
        formatRuleDescription(engineRule, description) ||
        buildFallbackLucaDescription({ ...rawRow, yon: direction, aciklama: description });

      if (direction === "GIRIS") {
        counterAccountCode = engineRule.alacakHesabi || engineRule.borcHesabi || "";
      } else {
        counterAccountCode = engineRule.borcHesabi || engineRule.alacakHesabi || "";
      }
    } else if (legacyRule) {
      lucaDescription = legacyRule.aciklama || buildFallbackLucaDescription({
        ...rawRow,
        yon: direction,
        aciklama: description,
      });
      counterAccountCode = legacyRule.hesap || "";
    } else {
      appendWarning(warnings, "Kural bulunamadı");
      lucaDescription = buildFallbackLucaDescription({
        ...rawRow,
        yon: direction,
        aciklama: description,
      });

      const cariCode = findCariAccountInPlan(companyPlans, description);

      if (cariCode) {
        counterAccountCode = cariCode;
      } else {
        counterAccountCode = "";
        appendWarning(warnings, "Cari hesap bulunamadı");
      }
    }

    if (
      counterAccountCode &&
      isGenericCariAccount(counterAccountCode) &&
      !accountExistsInPlan(companyPlans, counterAccountCode)
    ) {
      const cariCode = findCariAccountInPlan(companyPlans, description);

      if (cariCode) {
        counterAccountCode = cariCode;
      } else {
        counterAccountCode = "";
        appendWarning(warnings, "Cari hesap bulunamadı");
      }
    }
  }

  const faturaRule = findFaturaRule(companyRules, description);

  if (!isCardPaymentRow && faturaRule?.belgeTuru) {
    documentType = faturaRule.belgeTuru;
  }

  accountCode = resolve102BankAccount(
    selectedCompany?.bankAccounts || [],
    accountCode,
    getDefaultBankLucaCode(selectedCompany?.bankAccounts)
  );

  if (accountCode && !accountExistsInPlan(companyPlans, accountCode)) {
    appendWarning(warnings, "Hesap planında bulunamadı");
  }

  if (counterAccountCode && !accountExistsInPlan(companyPlans, counterAccountCode)) {
    if (!warnings.includes("Hesap planında bulunamadı")) {
      appendWarning(warnings, "Hesap planında bulunamadı");
    }
  }

  return {
    id: crypto.randomUUID(),
    date,
    description,
    amount,
    direction,
    bankName: rawRow.banka || rawRow.bankName || selectedBank,
    rawRow,
    matchedRule,
    accountCode,
    counterAccountCode,
    documentType,
    lucaDescription,
    warning: warnings.join(" | "),
  };
}

export function mapParsedRowsToStandardMovements(parsedRows, context) {
  return parsedRows
    .filter((row) => Math.abs(Number(row.tutar ?? row.amount ?? 0)) > 0)
    .map((row) => mapParsedRowToStandardMovement(row, context));
}

export function standardMovementToLucaPendingRow(movement) {
  const isIncoming = movement.direction === "GIRIS";

  return {
    Tarih: movement.date,
    Aciklama: movement.description,
    Tutar: movement.amount,
    IslemTipi: movement.matchedRule?.islemTipi || movement.matchedRule?.islem || "",
    BorcluHesap: isIncoming ? movement.accountCode : movement.counterAccountCode,
    AlacakliHesap: isIncoming ? movement.counterAccountCode : movement.accountCode,
    LucaBankaHesabi: movement.accountCode,
    BelgeTuru: movement.documentType,
    LucaAciklama: movement.lucaDescription,
    Uyari: movement.warning,
  };
}
