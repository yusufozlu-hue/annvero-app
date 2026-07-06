import { finalizeStandardLucaRow } from "@/src/utils/standardLucaRow";
import { isLikelyBankGlAccount } from "@/src/utils/transactionMemoryEngine";
import { normalizeParserText } from "@/src/utils/textNormalize";

export const BEYANNAME_TAHAKKUK_STORAGE_KEY = "annvero_beyanname_tahakkuk_v1";

export const BEYANNAME_TYPES = [
  "KDV",
  "KDV2",
  "MUHSGK",
  "SGK",
  "Konaklama Vergisi",
  "Turizm Payı",
  "Damga Vergisi",
];

export const LATE_FEE_ACCOUNT = {
  code: "689.01.001",
  name: "Gecikme Zammı ve Faiz Giderleri",
};

export const DEFAULT_DECLARATION_DISTRIBUTIONS = {
  KDV: [{ accountCode: "360.02.001", accountName: "Ödenecek KDV", amount: "" }],
  KDV2: [{ accountCode: "360.02.002", accountName: "Ödenecek KDV2", amount: "" }],
  MUHSGK: [
    { accountCode: "360.01.001", accountName: "Ücret Gelir Vergisi", amount: "" },
    { accountCode: "360.01.002", accountName: "Ücret Damga Vergisi", amount: "" },
    { accountCode: "360.01.003", accountName: "Kira Stopajı", amount: "" },
    { accountCode: "360.01.004", accountName: "SMM Stopajı", amount: "" },
    { accountCode: "360.01.005", accountName: "Diğer Stopajlar", amount: "" },
  ],
  SGK: [
    { accountCode: "361.01.001", accountName: "Ödenecek SGK Primleri", amount: "" },
    { accountCode: "361.01.002", accountName: "Ödenecek İşsizlik Primleri", amount: "" },
    { accountCode: "361.03.001", accountName: "Ödenecek SGDP Primleri", amount: "" },
  ],
  "Konaklama Vergisi": [
    { accountCode: "360.03.001", accountName: "Ödenecek Konaklama Vergisi", amount: "" },
  ],
  "Turizm Payı": [
    { accountCode: "360.04.001", accountName: "Ödenecek Turizm Payı", amount: "" },
  ],
  "Damga Vergisi": [
    { accountCode: "360.01.002", accountName: "Ödenecek Damga Vergisi", amount: "" },
  ],
};

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function roundMoney(value) {
  if (typeof value === "string") {
    const normalized = value
      .replaceAll("TL", "")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");
    return Math.round((Number(normalized) || 0) * 100) / 100;
  }

  return Math.round((Number(value) || 0) * 100) / 100;
}

export function formatPeriodFromPaymentDate(value) {
  const text = String(value || "").trim();
  let date = null;
  const tr = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (tr) {
    date = new Date(Number(tr[3]), Number(tr[2]) - 1, Number(tr[1]));
  } else {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }

  if (!date) {
    const now = new Date();
    date = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function buildDeclarationPaymentDescription(period, type) {
  return `${period} ${String(type || "").toLocaleUpperCase("tr")} ÖDEMESİ`;
}

export function detectDeclarationPaymentType(description = "") {
  const text = normalizeParserText(description);
  if (!text) return "";
  if (/\bKDV2\b|\bKDV\s*2\b/.test(text)) return "KDV2";
  if (/\bMUHSGK\b/.test(text)) return "MUHSGK";
  if (/\bSGK\b|\bSOSYAL\s+GUVENLIK\b/.test(text)) return "SGK";
  if (/\bKONAKLAMA\b/.test(text)) return "Konaklama Vergisi";
  if (/\bTURIZM\s+PAYI\b|\bTURIZM\b/.test(text)) return "Turizm Payı";
  if (/\bDAMGA\s+VERGISI\b|\bDAMGA\b/.test(text)) return "Damga Vergisi";
  if (/\bKDV\b/.test(text)) return "KDV";
  return "";
}

export function buildDeclarationRecord(input = {}) {
  const type = input.type || "KDV";
  const distributions = (input.distributions || DEFAULT_DECLARATION_DISTRIBUTIONS[type] || [])
    .map((row) => ({
      accountCode: String(row.accountCode || "").trim(),
      accountName: String(row.accountName || "").trim(),
      amount: roundMoney(row.amount),
    }))
    .filter((row) => row.accountCode && row.amount > 0);
  const totalPayment =
    roundMoney(input.totalPayment) ||
    roundMoney(distributions.reduce((sum, row) => sum + Number(row.amount || 0), 0));

  return {
    id: input.id || `decl-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    companyId: input.companyId || "",
    period: String(input.period || "").trim(),
    type,
    totalPayment,
    distributions,
    description: String(input.description || "").trim(),
    dueDate: input.dueDate || "",
    isPaid: Boolean(input.isPaid),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function loadDeclarationAccrualRecords() {
  if (typeof window === "undefined") return [];
  return safeParseJson(
    window.localStorage.getItem(BEYANNAME_TAHAKKUK_STORAGE_KEY) || "[]",
    []
  );
}

export function saveDeclarationAccrualRecords(records = []) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BEYANNAME_TAHAKKUK_STORAGE_KEY, JSON.stringify(records));
}

export function getDeclarationRecordsForCompany(records = [], companyId = "") {
  return (records || []).filter((record) => !companyId || record.companyId === companyId);
}

function getRowAmount(row = {}) {
  const borc = Number(row.borc || 0);
  const alacak = Number(row.alacak || 0);
  return Math.abs(borc || alacak || 0);
}

function getGroupKey(row = {}) {
  return row._movementId || `${row.fisNo}-${row.fisTarihi}-${row.evrakNo}`;
}

function findMatchingDeclaration(records = [], { companyId, period, type }) {
  return (records || []).find(
    (record) =>
      record.companyId === companyId &&
      record.period === period &&
      record.type === type &&
      record.isPaid !== true
  );
}

function appendNote(note, addition) {
  return [note, addition].filter(Boolean).join(" | ");
}

function buildDistributedRows({ baseRow, declaration, amount, period, type }) {
  const description = buildDeclarationPaymentDescription(period, type);
  const rows = [];

  declaration.distributions.forEach((distribution, index) => {
    rows.push(
      finalizeStandardLucaRow({
        ...baseRow,
        id: `${baseRow.id || "decl"}-dist-${index + 1}`,
        hesapKodu: distribution.accountCode,
        hesapAdi: distribution.accountName,
        borc: distribution.amount,
        alacak: "",
        fisAciklama: description,
        detayAciklama: description,
        aciklama: description,
        kontrolNotu: appendNote(baseRow.kontrolNotu, "Beyanname/tahakkuk dağılımı uygulandı"),
      })
    );
  });

  const difference = roundMoney(amount - Number(declaration.totalPayment || 0));
  if (difference > 0.01) {
    rows.push(
      finalizeStandardLucaRow({
        ...baseRow,
        id: `${baseRow.id || "decl"}-late-fee`,
        hesapKodu: LATE_FEE_ACCOUNT.code,
        hesapAdi: LATE_FEE_ACCOUNT.name,
        borc: difference,
        alacak: "",
        fisAciklama: description,
        detayAciklama: `${description} GECİKME ZAMMI`,
        aciklama: `${description} GECİKME ZAMMI`,
        kontrolNotu: appendNote(baseRow.kontrolNotu, "Gecikme zammı farkı dağıtıldı"),
      })
    );
  }

  return rows;
}

export function applyDeclarationAccrualDistributionToRows(rows = [], records = [], context = {}) {
  if (!rows.length) return { rows, summary: buildDeclarationDashboardStats(records) };

  const grouped = new Map();
  rows.forEach((row) => {
    const key = getGroupKey(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  const output = [];
  const appliedDeclarationIds = new Set();
  let matchedCount = 0;
  let unknownCount = 0;
  let lateFeeCount = 0;
  let underpaidCount = 0;
  const lateFeeDeclarationIds = new Set();
  const underpaidDeclarationIds = new Set();

  for (const groupRows of grouped.values()) {
    const text = groupRows.map((row) => `${row.fisAciklama} ${row.detayAciklama}`).join(" ");
    const type = detectDeclarationPaymentType(text);
    if (!type) {
      output.push(...groupRows);
      continue;
    }

    const sampleRow = groupRows[0] || {};
    const period = formatPeriodFromPaymentDate(sampleRow.fisTarihi || sampleRow.evrakTarihi);
    const amount = Math.max(...groupRows.map(getRowAmount));
    const declaration = findMatchingDeclaration(records, {
      companyId: context.companyId || sampleRow.firmaId || "",
      period,
      type,
    });
    const bankRows = groupRows.filter((row) => isLikelyBankGlAccount(row.hesapKodu));
    const counterRows = groupRows.filter((row) => !isLikelyBankGlAccount(row.hesapKodu));
    const baseCounterRow = counterRows[0] || groupRows[0];

    if (!declaration) {
      unknownCount += 1;
      output.push(
        ...groupRows.map((row) =>
          isLikelyBankGlAccount(row.hesapKodu)
            ? row
            : finalizeStandardLucaRow({
                ...row,
                hesapKodu: "",
                hesapAdi: "",
                riskDurumu: "HESAP_EKSIK",
                kontrolNotu: appendNote(row.kontrolNotu, `${type} tahakkuk kaydı bulunamadı`),
              })
        )
      );
      continue;
    }

    const total = Number(declaration.totalPayment || 0);
    if (amount + 0.01 < total) {
      underpaidCount += 1;
      underpaidDeclarationIds.add(declaration.id);
      output.push(
        ...groupRows.map((row) =>
          finalizeStandardLucaRow({
            ...row,
            kontrolNotu: appendNote(row.kontrolNotu, `${type} eksik ödeme uyarısı`),
          })
        )
      );
      continue;
    }

    const description = buildDeclarationPaymentDescription(period, type);
    output.push(
      ...bankRows.map((row) =>
        finalizeStandardLucaRow({
          ...row,
          fisAciklama: description,
          detayAciklama: description,
          aciklama: description,
        })
      )
    );
    output.push(
      ...buildDistributedRows({
        baseRow: baseCounterRow,
        declaration,
        amount,
        period,
        type,
      })
    );

    matchedCount += 1;
    if (amount - total > 0.01) lateFeeCount += 1;
    if (amount - total > 0.01) lateFeeDeclarationIds.add(declaration.id);
    appliedDeclarationIds.add(declaration.id);
  }

  return {
    rows: output,
    summary: {
      ...buildDeclarationDashboardStats(records),
      matchedCount,
      unknownCount,
      lateFeeCount,
      underpaidCount,
      appliedDeclarationIds: Array.from(appliedDeclarationIds),
      lateFeeDeclarationIds: Array.from(lateFeeDeclarationIds),
      underpaidDeclarationIds: Array.from(underpaidDeclarationIds),
    },
  };
}

export function buildDeclarationDashboardStats(records = []) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return {
    pending: records.filter((record) => !record.isPaid).length,
    paidThisMonth: records.filter(
      (record) => record.isPaid && String(record.updatedAt || "").startsWith(currentMonth)
    ).length,
    underpaidWarnings: records.filter((record) => record.underpaidWarning).length,
    lateFeeFindings: records.filter((record) => record.lateFeeDetected).length,
  };
}

export function runDeclarationAccrualDistributionScenario() {
  const record = buildDeclarationRecord({
    companyId: "test-company",
    period: "2026/05",
    type: "KDV",
    totalPayment: 50000,
    distributions: [
      { accountCode: "360.02.001", accountName: "Ödenecek KDV", amount: 50000 },
    ],
  });

  const rows = [
    finalizeStandardLucaRow({
      id: "kdv-bank",
      firmaId: "test-company",
      kaynakTipi: "BANKA",
      kaynakAdi: "VAKIFBANK",
      fisNo: "1",
      fisTarihi: "10.06.2026",
      hesapKodu: "102.01.001",
      hesapAdi: "Banka",
      alacak: 50250,
      detayAciklama: "KDV ÖDEMESİ",
      fisAciklama: "KDV ÖDEMESİ",
      _movementId: "kdv-payment",
    }),
    finalizeStandardLucaRow({
      id: "kdv-counter",
      firmaId: "test-company",
      kaynakTipi: "BANKA",
      kaynakAdi: "VAKIFBANK",
      fisNo: "1",
      fisTarihi: "10.06.2026",
      hesapKodu: "360",
      hesapAdi: "Ödenecek Vergiler",
      borc: 50250,
      detayAciklama: "KDV ÖDEMESİ",
      fisAciklama: "KDV ÖDEMESİ",
      _movementId: "kdv-payment",
    }),
  ];

  const result = applyDeclarationAccrualDistributionToRows(rows, [record], {
    companyId: "test-company",
  });

  return {
    inputPayment: 50250,
    declarationTotal: 50000,
    outputRows: result.rows.length,
    kdvAccountAmount:
      result.rows.find((row) => row.hesapKodu === "360.02.001")?.borc || 0,
    lateFeeAmount:
      result.rows.find((row) => row.hesapKodu === LATE_FEE_ACCOUNT.code)?.borc || 0,
    description:
      result.rows.find((row) => row.hesapKodu === "360.02.001")?.detayAciklama || "",
  };
}
