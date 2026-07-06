import { finalizeStandardLucaRow } from "@/src/utils/standardLucaRow";
import { isLikelyBankGlAccount } from "@/src/utils/transactionMemoryEngine";
import { normalizeParserText } from "@/src/utils/textNormalize";

export const BEYANNAME_TAHAKKUK_STORAGE_KEY = "annvero_beyanname_tahakkuk_v1";
export const BEYANNAME_ACCOUNT_MAPPING_STORAGE_KEY =
  "annvero_beyanname_account_mappings_v1";

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
  code: "770.01.900",
  name: "Gecikme Zammı / Faiz Gideri",
};

export const DEFAULT_DECLARATION_DISTRIBUTIONS = {
  KDV: [
    { accountCode: "360.01.010", accountName: "Ödenecek KDV", amount: "", description: "KDV", isLateFee: false },
    { accountCode: "770.01.900", accountName: "Gecikme Zammı / Faiz Gideri", amount: "", description: "Gecikme zammı", isLateFee: true },
  ],
  KDV2: [
    { accountCode: "360.01.011", accountName: "Ödenecek KDV2", amount: "", description: "KDV2", isLateFee: false },
    { accountCode: "770.01.900", accountName: "Gecikme Zammı / Faiz Gideri", amount: "", description: "Gecikme zammı", isLateFee: true },
  ],
  MUHSGK: [
    { accountCode: "360.01.001", accountName: "Ücret Gelir Vergisi", amount: "", description: "Ücret gelir vergisi", isLateFee: false },
    { accountCode: "360.01.002", accountName: "Ücret Damga Vergisi", amount: "", description: "Ücret damga vergisi", isLateFee: false },
    { accountCode: "360.01.003", accountName: "Kira Stopajı", amount: "", description: "Kira stopajı", isLateFee: false },
    { accountCode: "360.01.004", accountName: "SMM Stopajı", amount: "", description: "SMM stopajı", isLateFee: false },
    { accountCode: "360.01.005", accountName: "Diğer Stopajlar", amount: "", description: "Diğer stopajlar", isLateFee: false },
    { accountCode: "770.01.900", accountName: "Gecikme Zammı / Faiz Gideri", amount: "", description: "Gecikme zammı", isLateFee: true },
  ],
  SGK: [
    { accountCode: "361.01.001", accountName: "Ödenecek SGK Primleri", amount: "", description: "SGK primi", isLateFee: false },
    { accountCode: "361.01.002", accountName: "Ödenecek İşsizlik Primleri", amount: "", description: "İşsizlik primi", isLateFee: false },
    { accountCode: "361.03.001", accountName: "Ödenecek SGDP Primleri", amount: "", description: "SGDP primi", isLateFee: false },
    { accountCode: "770.01.900", accountName: "Gecikme Zammı / Faiz Gideri", amount: "", description: "Gecikme zammı", isLateFee: true },
  ],
  "Konaklama Vergisi": [
    { accountCode: "360.01.020", accountName: "Ödenecek Konaklama Vergisi", amount: "", description: "Konaklama vergisi", isLateFee: false },
    { accountCode: "770.01.900", accountName: "Gecikme Zammı / Faiz Gideri", amount: "", description: "Gecikme zammı", isLateFee: true },
  ],
  "Turizm Payı": [
    { accountCode: "360.01.021", accountName: "Ödenecek Turizm Payı", amount: "", description: "Turizm payı", isLateFee: false },
    { accountCode: "770.01.900", accountName: "Gecikme Zammı / Faiz Gideri", amount: "", description: "Gecikme zammı", isLateFee: true },
  ],
  "Damga Vergisi": [
    { accountCode: "360.01.030", accountName: "Ödenecek Damga Vergisi", amount: "", description: "Damga vergisi", isLateFee: false },
    { accountCode: "770.01.900", accountName: "Gecikme Zammı / Faiz Gideri", amount: "", description: "Gecikme zammı", isLateFee: true },
  ],
};

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function parseDeclarationAmount(value) {
  if (typeof value === "string") {
    const normalized = value
      .replaceAll("TL", "")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");
    return Number(normalized) || 0;
  }

  return Number(value) || 0;
}

function roundMoney(value) {
  return Math.round(parseDeclarationAmount(value) * 100) / 100;
}

function normalizeDistributionLine(row = {}) {
  return {
    accountCode: String(row.accountCode || "").trim(),
    accountName: String(row.accountName || "").trim(),
    amount: row.amount === "" || row.amount === null || row.amount === undefined ? "" : roundMoney(row.amount),
    description: String(row.description || row.accountName || "").trim(),
    isLateFee: Boolean(row.isLateFee),
  };
}

export function getDefaultDeclarationDistributions(type, mappings = {}, companyId = "") {
  const companyMappings = mappings?.[companyId]?.[type];
  const source = companyMappings?.length
    ? companyMappings
    : DEFAULT_DECLARATION_DISTRIBUTIONS[type] || [];
  return source.map((row) => ({ ...normalizeDistributionLine(row), amount: "" }));
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
    .map(normalizeDistributionLine)
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

export function loadDeclarationAccountMappings() {
  if (typeof window === "undefined") return {};
  return safeParseJson(
    window.localStorage.getItem(BEYANNAME_ACCOUNT_MAPPING_STORAGE_KEY) || "{}",
    {}
  );
}

export function saveDeclarationAccountMappings(mappings = {}) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BEYANNAME_ACCOUNT_MAPPING_STORAGE_KEY, JSON.stringify(mappings));
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

function getLateFeeLine(declaration = {}) {
  return (
    (declaration.distributions || []).find((row) => row.isLateFee) || {
      accountCode: LATE_FEE_ACCOUNT.code,
      accountName: LATE_FEE_ACCOUNT.name,
      description: "Gecikme zammı",
    }
  );
}

function buildDistributedRows({ baseRow, declaration, amount, period, type }) {
  const description = buildDeclarationPaymentDescription(period, type);
  const rows = [];

  declaration.distributions.forEach((distribution, index) => {
    const lineDescription = distribution.description
      ? `${description} - ${distribution.description}`
      : description;
    rows.push(
      finalizeStandardLucaRow({
        ...baseRow,
        id: `${baseRow.id || "decl"}-dist-${index + 1}`,
        hesapKodu: distribution.accountCode,
        hesapAdi: distribution.accountName,
        borc: distribution.amount,
        alacak: "",
        fisAciklama: description,
        detayAciklama: lineDescription,
        aciklama: lineDescription,
        kontrolNotu: appendNote(baseRow.kontrolNotu, "Beyanname/tahakkuk dağılımı uygulandı"),
      })
    );
  });

  const distributedTotal = roundMoney(
    (declaration.distributions || []).reduce(
      (sum, row) => sum + Number(row.amount || 0),
      0
    )
  );
  const allocatedTotal = Math.max(Number(declaration.totalPayment || 0), distributedTotal);
  const difference = roundMoney(amount - allocatedTotal);
  if (difference > 0.01) {
    const lateFeeLine = getLateFeeLine(declaration);
    rows.push(
      finalizeStandardLucaRow({
        ...baseRow,
        id: `${baseRow.id || "decl"}-late-fee`,
        hesapKodu: lateFeeLine.accountCode,
        hesapAdi: lateFeeLine.accountName,
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
  function buildPaymentRows({ id, type, amount, date = "10.06.2026" }) {
    return [
    finalizeStandardLucaRow({
        id: `${id}-bank`,
      firmaId: "test-company",
      kaynakTipi: "BANKA",
      kaynakAdi: "VAKIFBANK",
        fisNo: id,
        fisTarihi: date,
      hesapKodu: "102.01.001",
      hesapAdi: "Banka",
        alacak: amount,
        detayAciklama: `${type} ÖDEMESİ`,
        fisAciklama: `${type} ÖDEMESİ`,
        _movementId: `${id}-payment`,
    }),
    finalizeStandardLucaRow({
        id: `${id}-counter`,
      firmaId: "test-company",
      kaynakTipi: "BANKA",
      kaynakAdi: "VAKIFBANK",
        fisNo: id,
        fisTarihi: date,
      hesapKodu: "360",
      hesapAdi: "Ödenecek Vergiler",
        borc: amount,
        detayAciklama: `${type} ÖDEMESİ`,
        fisAciklama: `${type} ÖDEMESİ`,
        _movementId: `${id}-payment`,
    }),
  ];
  }

  const records = [
    buildDeclarationRecord({
      companyId: "test-company",
      period: "2026/05",
      type: "KDV",
      totalPayment: 50000,
      distributions: [
        { accountCode: "360.01.010", accountName: "Ödenecek KDV", amount: 50000 },
      ],
    }),
    buildDeclarationRecord({
      companyId: "test-company",
      period: "2026/05",
      type: "MUHSGK",
      totalPayment: 30000,
      distributions: [
        { accountCode: "360.01.001", accountName: "Ücret Gelir Vergisi", amount: 18000 },
        { accountCode: "360.01.002", accountName: "Ücret Damga Vergisi", amount: 2000 },
        { accountCode: "360.01.003", accountName: "Kira Stopajı", amount: 10000 },
      ],
    }),
    buildDeclarationRecord({
      companyId: "test-company",
      period: "2026/05",
      type: "SGK",
      totalPayment: 42000,
      distributions: [
        { accountCode: "361.01.001", accountName: "Ödenecek SGK Primleri", amount: 35000 },
        { accountCode: "361.01.002", accountName: "Ödenecek İşsizlik Primleri", amount: 5000 },
        { accountCode: "361.03.001", accountName: "Ödenecek SGDP Primleri", amount: 2000 },
      ],
    }),
  ];

  const kdvFull = applyDeclarationAccrualDistributionToRows(
    buildPaymentRows({ id: "kdv-full", type: "KDV", amount: 50000 }),
    [records[0]],
    { companyId: "test-company" }
  );
  const kdvLateFee = applyDeclarationAccrualDistributionToRows(
    buildPaymentRows({ id: "kdv-late", type: "KDV", amount: 50250 }),
    [records[0]],
    { companyId: "test-company" }
  );
  const muhsgk = applyDeclarationAccrualDistributionToRows(
    buildPaymentRows({ id: "muhsgk", type: "MUHSGK", amount: 30000 }),
    [records[1]],
    { companyId: "test-company" }
  );
  const sgk = applyDeclarationAccrualDistributionToRows(
    buildPaymentRows({ id: "sgk", type: "SGK", amount: 42000 }),
    [records[2]],
    { companyId: "test-company" }
  );
  const underpaid = applyDeclarationAccrualDistributionToRows(
    buildPaymentRows({ id: "kdv-underpaid", type: "KDV", amount: 49000 }),
    [records[0]],
    { companyId: "test-company" }
  );
  const overpaid = applyDeclarationAccrualDistributionToRows(
    buildPaymentRows({ id: "kdv-overpaid", type: "KDV", amount: 51000 }),
    [records[0]],
    { companyId: "test-company" }
  );

  return {
    kdvFullPayment: {
      matchedCount: kdvFull.summary.matchedCount,
      amount: kdvFull.rows.find((row) => row.hesapKodu === "360.01.010")?.borc || 0,
    },
    kdvLateFeePayment: {
      matchedCount: kdvLateFee.summary.matchedCount,
      lateFeeCount: kdvLateFee.summary.lateFeeCount,
      lateFeeAmount: kdvLateFee.rows.find((row) => row.hesapKodu === LATE_FEE_ACCOUNT.code)?.borc || 0,
      description: kdvLateFee.rows.find((row) => row.hesapKodu === "360.01.010")?.detayAciklama || "",
    },
    muhsgkMultiAccountRows: muhsgk.rows.filter((row) => String(row.hesapKodu || "").startsWith("360.01.")).length,
    sgkMultiAccountRows: sgk.rows.filter((row) => String(row.hesapKodu || "").startsWith("361.")).length,
    underpaidWarnings: underpaid.summary.underpaidCount,
    excessivePaymentWarnings: overpaid.summary.lateFeeCount,
  };
}
