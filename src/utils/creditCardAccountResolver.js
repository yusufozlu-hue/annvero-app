export function normalizeMonthlyBaseAccount(baseAccount) {
  const text = String(baseAccount || "").trim();

  if (!text) return "";

  const segments = text.split(".").filter((segment) => segment !== "");

  // Ana hesap 2 segment olmalı (örn: 309.01). Kullanıcı yanlışlıkla ay
  // kırılımı yazdıysa (örn: 309.01.001) son segmenti kaldırıp kökü al.
  if (segments.length >= 3) {
    return segments.slice(0, 2).join(".");
  }

  return segments.join(".");
}

const MONTH_NAMES = [
  "OCAK",
  "ŞUBAT",
  "MART",
  "NİSAN",
  "MAYIS",
  "HAZİRAN",
  "TEMMUZ",
  "AĞUSTOS",
  "EYLÜL",
  "EKİM",
  "KASIM",
  "ARALIK",
];

function normalizeTrText(value) {
  return String(value || "")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ş", "S")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C");
}

export function parseFlexibleDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial date (1899-12-30 epoch)
    const ms = Date.UTC(1899, 11, 30) + value * 86400000;
    const fromSerial = new Date(ms);
    return Number.isNaN(fromSerial.getTime()) ? null : fromSerial;
  }

  const text = String(value || "").trim();
  if (!text) return null;

  // 27.01.2025 veya 27/01/2025
  let match = text.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // 2025-01-27
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Sayısal string (Excel serial)
  if (/^\d+$/.test(text)) {
    return parseFlexibleDate(Number(text));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function findMonthYearInText(text) {
  const norm = normalizeTrText(text);
  if (!norm) return null;

  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (norm.includes(normalizeTrText(MONTH_NAMES[i]))) {
      const yearMatch = norm.match(/(20\d{2})/);
      return { month: i + 1, year: yearMatch ? Number(yearMatch[1]) : null };
    }
  }

  return null;
}

function resolveStatementPeriod(creditCard, date) {
  let month = date.getMonth() + 1;
  let year = date.getFullYear();

  if (creditCard?.statementPeriodRule === "ONCEKI_AY") {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }

  return { month, year };
}

export function getCreditCardAccount({
    creditCard,
    paymentDate,
    installmentYearShift = false,
  }) {
    if (!creditCard) {
      return {
        accountCode: "",
        periodMonth: null,
        warning: "Kredi kartı bilgisi bulunamadı.",
      };
    }
  
    const date = parseFlexibleDate(paymentDate);
  
    if (!date) {
      return {
        accountCode: "",
        periodMonth: null,
        warning: "Geçersiz ödeme tarihi.",
      };
    }
  
    const { month } = resolveStatementPeriod(creditCard, date);
  
    const monthCode = String(month).padStart(3, "0");

    const single =
      creditCard.singleLucaAccountCode ||
      creditCard.lucaAccountCode ||
      "";
    const base309 = normalizeMonthlyBaseAccount(
      creditCard.monthly309BaseAccount ||
        creditCard.monthly309BaseAccountCode ||
        ""
    );
    const base409 = normalizeMonthlyBaseAccount(
      creditCard.monthly409BaseAccount ||
        creditCard.monthly409BaseAccountCode ||
        ""
    );

    const trackingMethod = String(creditCard.trackingMethod || "")
      .toUpperCase()
      .replace(/\s+/g, "_");
  
    if (trackingMethod === "TEK_HESAP") {
      return {
        accountCode: single || "",
        periodMonth: month,
        warning: !single ? "Tek Luca hesabı tanımlı değil." : "",
      };
    }
  
    if (trackingMethod === "AY_BAZLI_309") {
      return {
        accountCode: base309 ? `${base309}.${monthCode}` : "",
        periodMonth: month,
        warning: !base309 ? "309 ana hesap tanımlı değil." : "",
      };
    }
  
    if (trackingMethod === "AY_BAZLI_309_409") {
      const baseAccount = installmentYearShift ? base409 : base309;
  
      return {
        accountCode: baseAccount ? `${baseAccount}.${monthCode}` : "",
        periodMonth: month,
        warning: !baseAccount
          ? installmentYearShift
            ? "409 ana hesap tanımlı değil."
            : "309 ana hesap tanımlı değil."
          : "",
      };
    }

    if (single) {
      return { accountCode: single, periodMonth: month, warning: "" };
    }

    if (base309) {
      return {
        accountCode: `${base309}.${monthCode}`,
        periodMonth: month,
        warning: "",
      };
    }
  
    return {
      accountCode: "",
      periodMonth: month,
      warning: "Kredi kartı takip yöntemi tanımsız.",
    };
  }
  
  export function findCreditCardByText(creditCards = [], text = "") {
    const normalizedText = String(text).toUpperCase();
    const digitsOnly = normalizedText.replace(/\D/g, "");
  
    return creditCards.find((card) => {
      if (card.isActive === false) return false;

      const lastFour = String(card.lastFourDigits || "").trim();
      const cardName = String(card.cardName || "").toUpperCase();
  
      return (
        (lastFour &&
          (normalizedText.includes(lastFour) || digitsOnly.includes(lastFour))) ||
        (cardName && normalizedText.includes(cardName))
      );
    });
  }

  export function buildCreditCardPaymentDescription({
    creditCard,
    paymentDate,
    rawDescription = "",
  }) {
    const lastFour = String(creditCard?.lastFourDigits || "").trim();
    const prefix = lastFour ? `**${lastFour}` : "**";

    const date = parseFlexibleDate(paymentDate);

    // Ödeme tarihinden (varsa önceki ay kuralıyla) dönem hesapla
    let month = null;
    let year = null;

    if (date) {
      const period = resolveStatementPeriod(creditCard, date);
      month = period.month;
      year = period.year;
    }

    // Ham açıklamada ay adı geçiyorsa öncelikli kullan
    const fromText = findMonthYearInText(rawDescription);

    if (fromText) {
      month = fromText.month;
      if (fromText.year) year = fromText.year;
    }

    if (month && year) {
      return `${prefix} ${MONTH_NAMES[month - 1]} ${year} EKSTRESİ ÖDEMESİ`;
    }

    if (month) {
      return `${prefix} ${MONTH_NAMES[month - 1]} EKSTRESİ ÖDEMESİ`;
    }

    return `${prefix} EKSTRESİ ÖDEMESİ`;
  }