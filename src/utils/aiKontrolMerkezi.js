import { formatDateTR, parseDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { extractDescriptionKeyword } from "@/src/utils/previewRowEdit";
import { normalizeParserText } from "@/src/utils/textNormalize";

export const AI_KONTROL_TIP = {
  FARKLI_HESAP: "Önceki dönemde farklı hesap",
  OLAGANDISI_TUTAR: "Olağandışı yüksek tutar",
  EKSIK_BELGE_TURU: "Eksik belge türü",
  EKSIK_ACIKLAMA: "Eksik açıklama",
  MUKERRER: "Aynı gün aynı tutar mükerrer",
  NEGATIF_TUTAR: "Negatif borç/alacak",
  DENGESIZ_FIS: "Dengesiz fiş",
  CARI_FARKLI_HESAP: "Aynı cari için farklı hesap",
  VERGI_UYUMSUZ: "Vergi ödeme açıklaması uyumsuz",
  SUPHELI_MASRAF: "Şüpheli banka masrafı",
};

export const AI_RISK = {
  YUKSEK: "Yüksek",
  ORTA: "Orta",
  DUSUK: "Düşük",
};

export const AI_ACCOUNT_HISTORY_KEY = "annvero_ai_account_history_v1";

const VERGI_KEYWORDS = ["VERGI", "GIB", "GIBI", "SGK", "KDV", "MTV", "STOPAJ", "DAMGA", "BEYANNAME"];
const MASRAF_KEYWORDS = ["MASRAF", "KOMISYON", "BSMV", "UCRET", "POS", "HAVALE UCRET", "EFT UCRET"];
const VERGI_ACCOUNT_PREFIXES = ["360", "361", "368", "335", "369"];
const MASRAF_ACCOUNT_PREFIXES = ["780", "770", "689"];

function compactText(value) {
  return normalizeParserText(value).replace(/\s+/g, "");
}

function getRowDescription(row) {
  return String(row.detayAciklama || row.fisAciklama || row.aciklama || "").trim();
}

function getRowAmount(row) {
  const borc = parseMoneyTR(row.borc);
  const alacak = parseMoneyTR(row.alacak);
  return borc > 0 ? borc : alacak;
}

function getRowKeyword(row) {
  return extractDescriptionKeyword(getRowDescription(row));
}

function getRowMonthKey(row) {
  const date = parseDateTR(row.fisTarihi);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getCariKey(row) {
  const cari = String(row.cariUnvan || "").trim();
  if (cari) return compactText(cari);

  const keyword = getRowKeyword(row);
  return keyword ? compactText(keyword) : "";
}


function startsWithAnyPrefix(code, prefixes = []) {
  const normalized = String(code || "").trim();
  return prefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}.`)
  );
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function median(values = []) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function createFinding(base) {
  return {
    id: base.id,
    rowId: base.rowId,
    kontrolTipi: base.kontrolTipi,
    riskSeviyesi: base.riskSeviyesi,
    aiNotu: base.aiNotu,
    onerilenHesap: base.onerilenHesap || "",
    oncekiKullanim: base.oncekiKullanim || "",
    fisNo: base.fisNo ?? "",
    fisTarihi: base.fisTarihi || "",
    kaynakTipi: base.kaynakTipi || "",
    kaynakAdi: base.kaynakAdi || "",
    aciklama: base.aciklama || "",
    hesapKodu: base.hesapKodu || "",
    tutar: base.tutar ?? 0,
    row: base.row,
  };
}

export function loadAccountHistoryFromStorage() {
  if (typeof window === "undefined") return {};

  try {
    const saved = localStorage.getItem(AI_ACCOUNT_HISTORY_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

export function saveAccountHistoryToStorage(history = {}) {
  if (typeof window === "undefined") return;
  localStorage.setItem(AI_ACCOUNT_HISTORY_KEY, JSON.stringify(history));
}

function mergeLearningMemoryHistory(history, learningMemory = [], companyId = "") {
  const next = { ...(history[companyId] || {}) };

  learningMemory.forEach((record) => {
    if (record.is_active === false) return;

    const keyword = compactText(record.keyword || "");
    const account = String(record.account_code || "").trim();
    if (!keyword || !account) return;

    next[keyword] = {
      hesapKodu: account,
      kaynak: "Öğrenen hafıza",
      guncelleme: record.updated_at || record.created_at || "",
    };
  });

  return next;
}

function buildBaselineFromRows(rows = []) {
  const baseline = new Map();

  rows.forEach((row) => {
    const keyword = compactText(getRowKeyword(row));
    const account = String(row.hesapKodu || "").trim();
    const month = getRowMonthKey(row);

    if (!keyword || !account) return;

    const current = baseline.get(keyword) || {
      accounts: new Map(),
      latestMonth: "",
      latestAccount: account,
    };

    const monthAccounts = current.accounts.get(month) || new Set();
    monthAccounts.add(account);
    current.accounts.set(month, monthAccounts);

    if (!current.latestMonth || month >= current.latestMonth) {
      current.latestMonth = month;
      current.latestAccount = account;
    }

    baseline.set(keyword, current);
  });

  return baseline;
}

function getPreviousAccountForKeyword(keyword, baselineMap, storedHistory = {}) {
  const compactKeyword = compactText(keyword);
  const fromStorage = storedHistory[compactKeyword];

  if (fromStorage?.hesapKodu) {
    return {
      hesapKodu: fromStorage.hesapKodu,
      kaynak: fromStorage.kaynak || "Geçmiş kayıt",
    };
  }

  const baseline = baselineMap.get(compactKeyword);
  if (!baseline?.latestAccount) return null;

  return {
    hesapKodu: baseline.latestAccount,
    kaynak: baseline.latestMonth
      ? `${baseline.latestMonth} dönemi`
      : "Önceki satırlar",
  };
}

function rowMatchesDateRange(row, dateFrom, dateTo) {
  const date = parseDateTR(row.fisTarihi);
  if (!date) return true;

  const from = dateFrom ? parseDateTR(dateFrom) : null;
  const to = dateTo ? parseDateTR(dateTo) : null;

  if (from && date < from) return false;
  if (to && date > to) return false;

  return true;
}

export function analyzeAiKontrolRows(rows = [], context = {}) {
  const {
    learningMemory = [],
    companyId = "",
    accountHistory = {},
    dateFrom = "",
    dateTo = "",
  } = context;

  const allRows = rows.map((row, index) => ({
    ...row,
    id: row.id || `ai-row-${index + 1}`,
  }));

  const storedHistory = mergeLearningMemoryHistory(
    { [companyId]: accountHistory },
    learningMemory,
    companyId
  );

  const baselineRows = allRows.filter((row) => !rowMatchesDateRange(row, dateFrom, dateTo));
  const targetRows = allRows.filter((row) => rowMatchesDateRange(row, dateFrom, dateTo));
  const baselineMap = buildBaselineFromRows(baselineRows.length ? baselineRows : allRows);

  const findings = [];
  let findingIndex = 1;

  const pushFinding = (row, payload) => {
    findings.push(
      createFinding({
        id: `ai-finding-${findingIndex++}`,
        rowId: row.id,
        row,
        fisNo: row.fisNo,
        fisTarihi: row.fisTarihi,
        kaynakTipi: row.kaynakTipi,
        kaynakAdi: row.kaynakAdi,
        aciklama: getRowDescription(row),
        hesapKodu: row.hesapKodu,
        tutar: getRowAmount(row),
        ...payload,
      })
    );
  };

  const duplicateKeys = new Map();
  const cariAccounts = new Map();
  const amountBaseline = new Map();

  baselineRows.forEach((row) => {
    const keyword = compactText(getRowKeyword(row));
    const amount = getRowAmount(row);
    if (!keyword || !amount) return;

    const list = amountBaseline.get(keyword) || [];
    list.push(amount);
    amountBaseline.set(keyword, list);
  });

  allRows.forEach((row) => {
    const keyword = compactText(getRowKeyword(row));
    const amount = getRowAmount(row);
    if (!keyword || !amount) return;

    const list = amountBaseline.get(keyword) || [];
    list.push(amount);
    amountBaseline.set(keyword, list);
  });

  targetRows.forEach((row) => {
    const description = getRowDescription(row);
    const keyword = getRowKeyword(row);
    const amount = getRowAmount(row);
    const hesapKodu = String(row.hesapKodu || "").trim();

    if (!String(row.belgeTuru || "").trim()) {
      pushFinding(row, {
        kontrolTipi: AI_KONTROL_TIP.EKSIK_BELGE_TURU,
        riskSeviyesi: AI_RISK.ORTA,
        aiNotu: "Belge türü alanı boş. Fiş türü netleştirilmeli.",
        onerilenHesap: hesapKodu,
        oncekiKullanim: "-",
      });
    }

    if (!description) {
      pushFinding(row, {
        kontrolTipi: AI_KONTROL_TIP.EKSIK_ACIKLAMA,
        riskSeviyesi: AI_RISK.ORTA,
        aiNotu: "Açıklama alanı boş. Manuel kontrol önerilir.",
        onerilenHesap: hesapKodu,
        oncekiKullanim: "-",
      });
    }

    if (Number(row.borc) < 0 || Number(row.alacak) < 0) {
      pushFinding(row, {
        kontrolTipi: AI_KONTROL_TIP.NEGATIF_TUTAR,
        riskSeviyesi: AI_RISK.YUKSEK,
        aiNotu: "Negatif borç/alacak değeri tespit edildi.",
        onerilenHesap: hesapKodu,
        oncekiKullanim: "-",
      });
    }

    const duplicateKey = [
      compactText(row.fisTarihi),
      amount.toFixed(2),
      compactText(description),
    ].join("|");

    if (duplicateKey.replace(/\|/g, "")) {
      const previous = duplicateKeys.get(duplicateKey);
      if (previous) {
        pushFinding(row, {
          kontrolTipi: AI_KONTROL_TIP.MUKERRER,
          riskSeviyesi: AI_RISK.ORTA,
          aiNotu: `Aynı gün, tutar ve açıklama ${previous}. satırla tekrar ediyor.`,
          onerilenHesap: hesapKodu,
          oncekiKullanim: previous,
        });
      } else {
        duplicateKeys.set(duplicateKey, row.id);
      }
    }

    const previousAccount = getPreviousAccountForKeyword(keyword, baselineMap, storedHistory);
    if (
      previousAccount?.hesapKodu &&
      hesapKodu &&
      previousAccount.hesapKodu !== hesapKodu
    ) {
      pushFinding(row, {
        kontrolTipi: AI_KONTROL_TIP.FARKLI_HESAP,
        riskSeviyesi: AI_RISK.ORTA,
        aiNotu: `"${keyword}" için hesap değişimi tespit edildi.`,
        onerilenHesap: previousAccount.hesapKodu,
        oncekiKullanim: `${previousAccount.kaynak}: ${previousAccount.hesapKodu}`,
      });
    }

    const keywordAmounts = amountBaseline.get(compactText(keyword)) || [];
    const typicalAmount = median(keywordAmounts.filter((value) => value !== amount));
    if (typicalAmount > 0 && amount >= Math.max(typicalAmount * 5, typicalAmount + 50000)) {
      pushFinding(row, {
        kontrolTipi: AI_KONTROL_TIP.OLAGANDISI_TUTAR,
        riskSeviyesi: AI_RISK.YUKSEK,
        aiNotu: `Normal ${formatMoney(typicalAmount)} iken ${formatMoney(amount)} tutarı olağandışı.`,
        onerilenHesap: hesapKodu,
        oncekiKullanim: `Tipik tutar: ${formatMoney(typicalAmount)}`,
      });
    }

    const cariKey = getCariKey(row);
    if (cariKey && hesapKodu) {
      const accounts = cariAccounts.get(cariKey) || new Set();
      accounts.add(hesapKodu);
      cariAccounts.set(cariKey, accounts);
    }

    const normalizedDescription = normalizeParserText(description);
    const hasTaxKeyword = VERGI_KEYWORDS.some((item) => normalizedDescription.includes(item));
    if (hasTaxKeyword && hesapKodu && !startsWithAnyPrefix(hesapKodu, VERGI_ACCOUNT_PREFIXES)) {
      pushFinding(row, {
        kontrolTipi: AI_KONTROL_TIP.VERGI_UYUMSUZ,
        riskSeviyesi: AI_RISK.ORTA,
        aiNotu: "Vergi/SGK açıklaması var ancak hesap vergi sınıfında görünmüyor.",
        onerilenHesap: "360",
        oncekiKullanim: hesapKodu,
      });
    }

    const hasMasrafKeyword = MASRAF_KEYWORDS.some((item) => normalizedDescription.includes(item));
    if (hasMasrafKeyword && hesapKodu) {
      if (startsWithAnyPrefix(hesapKodu, ["102"]) && !hesapKodu.includes(".")) {
        pushFinding(row, {
          kontrolTipi: AI_KONTROL_TIP.SUPHELI_MASRAF,
          riskSeviyesi: AI_RISK.YUKSEK,
          aiNotu: "Masraf açıklaması yalnızca 102 banka hesabına işlenmiş olabilir.",
          onerilenHesap: "780.01.001",
          oncekiKullanim: hesapKodu,
        });
      } else if (!startsWithAnyPrefix(hesapKodu, MASRAF_ACCOUNT_PREFIXES)) {
        pushFinding(row, {
          kontrolTipi: AI_KONTROL_TIP.SUPHELI_MASRAF,
          riskSeviyesi: AI_RISK.ORTA,
          aiNotu: "Banka masraf/komisyon açıklaması şüpheli hesapta.",
          onerilenHesap: "780.01.001",
          oncekiKullanim: hesapKodu,
        });
      }
    }
  });

  cariAccounts.forEach((accounts, cariKey) => {
    if (accounts.size <= 1) return;

    targetRows
      .filter((row) => getCariKey(row) === cariKey)
      .forEach((row) => {
        pushFinding(row, {
          kontrolTipi: AI_KONTROL_TIP.CARI_FARKLI_HESAP,
          riskSeviyesi: AI_RISK.ORTA,
          aiNotu: "Aynı cari/unvan için farklı hesap kodları kullanılmış.",
          onerilenHesap: [...accounts][0] || "",
          oncekiKullanim: [...accounts].join(", "),
        });
      });
  });

  const fisTotals = new Map();

  targetRows.forEach((row) => {
    const fisKey = String(row.fisNo ?? row.id);
    const current = fisTotals.get(fisKey) || {
      borc: 0,
      alacak: 0,
      sampleRow: row,
    };
    current.borc += parseMoneyTR(row.borc);
    current.alacak += parseMoneyTR(row.alacak);
    fisTotals.set(fisKey, current);
  });

  fisTotals.forEach((total) => {
    const diff = Math.abs(total.borc - total.alacak);
    if (diff <= 0.01) return;

    pushFinding(total.sampleRow, {
      kontrolTipi: AI_KONTROL_TIP.DENGESIZ_FIS,
      riskSeviyesi: AI_RISK.YUKSEK,
      aiNotu: `Fiş ${total.sampleRow.fisNo ?? "-"} dengede değil. Fark ${formatMoney(diff)}.`,
      onerilenHesap: total.sampleRow.hesapKodu || "",
      oncekiKullanim: `Borç ${formatMoney(total.borc)} / Alacak ${formatMoney(total.alacak)}`,
    });
  });

  const summary = {
    totalRows: targetRows.length,
    totalFindings: findings.length,
    yuksekRisk: findings.filter((item) => item.riskSeviyesi === AI_RISK.YUKSEK).length,
    ortaRisk: findings.filter((item) => item.riskSeviyesi === AI_RISK.ORTA).length,
    dusukRisk: findings.filter((item) => item.riskSeviyesi === AI_RISK.DUSUK).length,
  };

  return {
    findings,
    summary,
    targetRows,
    baselineRows,
  };
}

export function filterAiKontrolFindings(
  findings = [],
  { risk = "", kaynakTipi = "", search = "" } = {}
) {
  const query = search.trim().toLocaleLowerCase("tr");
  const kaynakFilter = normalizeParserText(kaynakTipi);

  return findings.filter((finding) => {
    if (risk && finding.riskSeviyesi !== risk) return false;

    if (kaynakFilter && kaynakFilter !== "TUMU") {
      if (normalizeParserText(finding.kaynakTipi) !== kaynakFilter) return false;
    }

    if (!query) return true;

    const haystack = [
      finding.kontrolTipi,
      finding.aiNotu,
      finding.onerilenHesap,
      finding.oncekiKullanim,
      finding.aciklama,
      finding.hesapKodu,
      finding.kaynakTipi,
      finding.kaynakAdi,
      finding.fisTarihi,
    ]
      .join(" ")
      .toLocaleLowerCase("tr");

    return haystack.includes(query);
  });
}

export function buildAiKontrolExcelRows(findings = []) {
  return findings.map((finding) => ({
    "Kontrol Tipi": finding.kontrolTipi,
    "Risk Seviyesi": finding.riskSeviyesi,
    "AI Notu": finding.aiNotu,
    "Önerilen Hesap": finding.onerilenHesap,
    "Önceki Kullanım": finding.oncekiKullanim,
    "Fiş No": finding.fisNo,
    Tarih: finding.fisTarihi,
    "Kaynak Tipi": finding.kaynakTipi,
    "Kaynak Adı": finding.kaynakAdi,
    Açıklama: finding.aciklama,
    "Hesap Kodu": finding.hesapKodu,
    Tutar: finding.tutar,
  }));
}

export function updateAccountHistoryFromRows(rows = [], companyId = "", history = {}) {
  if (!companyId) return history;

  const companyHistory = { ...(history[companyId] || {}) };

  rows.forEach((row) => {
    const keyword = compactText(getRowKeyword(row));
    const account = String(row.hesapKodu || "").trim();
    if (!keyword || !account) return;

    companyHistory[keyword] = {
      hesapKodu: account,
      kaynak: getRowMonthKey(row) || "Son kullanım",
      guncelleme: new Date().toISOString(),
    };
  });

  return {
    ...history,
    [companyId]: companyHistory,
  };
}

export function parseDateInputValue(value) {
  if (!value) return "";
  const parsed = parseDateTR(value);
  return parsed ? formatDateTR(parsed) : value;
}
