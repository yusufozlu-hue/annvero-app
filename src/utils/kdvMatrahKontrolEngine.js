import {
  KDV_KAYNAK,
  KDV_KONTROL_DURUM,
  KDV_KONTROL_GRUP,
  VALID_KDV_ORANLARI,
  riskBandFromScore,
} from "@/src/config/kdvMatrahKontrolDefaults";
import { formatDateTR, parseDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { normalizeParserText } from "@/src/utils/textNormalize";

const NEAR_DATE_DAYS = 3;
const KDV_TOLERANCE = 0.05;

function compactText(value) {
  return normalizeParserText(value).replace(/\s+/g, "");
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function findHeaderIndex(rows) {
  return rows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return (
      (text.includes("MATRAH") || text.includes("TUTAR")) &&
      (text.includes("KDV") || text.includes("BELGE") || text.includes("TARIH"))
    );
  });
}

function getSheetCell(row, headers, names) {
  const list = Array.isArray(names) ? names : [names];

  for (const name of list) {
    const wanted = compactText(name);
    const index = headers.findIndex((header) => {
      const current = compactText(header);
      return current === wanted || current.includes(wanted);
    });

    if (index >= 0) return row[index];
  }

  return "";
}

function normalizeKdvOrani(value) {
  const parsed = parseMoneyTR(value);
  if (parsed > 0 && parsed < 1) return roundMoney(parsed * 100);
  return roundMoney(parsed);
}

function parseInvoiceRow(row, headers, index, kaynak) {
  const tarih =
    getSheetCell(row, headers, ["TARİH", "TARIH", "FATURA TARİHİ", "FIS TARIHI"]) || "";

  const belgeNo = String(
    getSheetCell(row, headers, ["BELGE NO", "FATURA NO", "EVRAK NO", "FIS NO"]) || ""
  ).trim();

  const cariUnvan = String(
    getSheetCell(row, headers, ["CARİ ÜNVAN", "CARI UNVAN", "UNVAN", "FİRMA", "FIRMA"]) || ""
  ).trim();

  const vergiNo = String(
    getSheetCell(row, headers, ["VERGİ NO", "VERGI NO", "VKN", "TCKN", "VERGI DAIRESI NO"]) || ""
  ).trim();

  const matrah = parseMoneyTR(
    getSheetCell(row, headers, ["MATRAH", "KDV MATRAHI", "NET TUTAR", "ARA TOPLAM"])
  );

  const kdvOrani = normalizeKdvOrani(
    getSheetCell(row, headers, ["KDV ORANI", "KDV ORAN", "ORAN", "KDV %"])
  );

  const kdvTutari = parseMoneyTR(
    getSheetCell(row, headers, ["KDV TUTARI", "KDV TUTAR", "HESAPLANAN KDV", "KDV"])
  );

  const toplamTutar = parseMoneyTR(
    getSheetCell(row, headers, ["TOPLAM TUTAR", "GENEL TOPLAM", "FATURA TUTARI", "TOPLAM"])
  );

  const tevkifat = parseMoneyTR(
    getSheetCell(row, headers, ["TEVKİFAT", "TEVKIFAT", "KDV TEVKIFAT", "STOPAJ"])
  );

  const istisnaKodu = String(
    getSheetCell(row, headers, ["İSTİSNA", "ISTISNA", "İSTİSNA KODU", "ISTISNA KODU"]) || ""
  ).trim();

  const aciklama = String(
    getSheetCell(row, headers, ["AÇIKLAMA", "ACIKLAMA", "NOT"]) || ""
  ).trim();

  if (!tarih && !belgeNo && !matrah && !toplamTutar) return null;

  return {
    id: `${kaynak}-${index + 1}`,
    kaynak,
    tarih: formatDateTR(tarih),
    belgeNo,
    cariUnvan,
    vergiNo,
    matrah,
    kdvOrani,
    kdvTutari,
    toplamTutar,
    tevkifat,
    istisnaKodu,
    aciklama,
    kontrolDurumu: "",
    disaridaBirak: false,
    manuallyEdited: false,
  };
}

export function parseFaturaListSheet(sheetRows = [], kaynak = KDV_KAYNAK.ALIS) {
  if (!sheetRows.length) return [];

  const headerIndex = findHeaderIndex(sheetRows);
  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => parseInvoiceRow(row, headers, index, kaynak))
    .filter(Boolean);
}

export function parseKdvListSheet(sheetRows = []) {
  return parseFaturaListSheet(sheetRows, KDV_KAYNAK.KDV_LISTE);
}

export function parseMuavinKdvSheet(sheetRows = []) {
  if (!sheetRows.length) return [];

  const headerIndex = sheetRows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return text.includes("HESAP") && (text.includes("BORC") || text.includes("ALACAK"));
  });

  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      const tarih =
        getSheetCell(row, headers, ["TARİH", "TARIH", "FİŞ TARİHİ", "FIS TARIHI"]) || "";
      const belgeNo = String(
        getSheetCell(row, headers, ["EVRAK NO", "BELGE NO", "FİŞ NO", "FIS NO"]) || ""
      ).trim();
      const cariUnvan = String(
        getSheetCell(row, headers, ["AÇIKLAMA", "ACIKLAMA", "CARİ", "CARI"]) || ""
      ).trim();
      const borc = parseMoneyTR(getSheetCell(row, headers, ["BORÇ", "BORC"]));
      const alacak = parseMoneyTR(getSheetCell(row, headers, ["ALACAK"]));

      if (!tarih || (!borc && !alacak)) return null;

      return {
        id: `muavin-${index + 1}`,
        kaynak: KDV_KAYNAK.MUAVIN,
        tarih: formatDateTR(tarih),
        belgeNo,
        cariUnvan,
        vergiNo: "",
        matrah: roundMoney(Math.max(borc, alacak)),
        kdvOrani: 0,
        kdvTutari: 0,
        toplamTutar: roundMoney(Math.max(borc, alacak)),
        tevkifat: 0,
        istisnaKodu: "",
        aciklama: cariUnvan,
        kontrolDurumu: "",
        disaridaBirak: false,
        manuallyEdited: false,
      };
    })
    .filter(Boolean);
}

function daysBetween(left, right) {
  const leftDate = parseDateTR(left);
  const rightDate = parseDateTR(right);
  if (!leftDate || !rightDate) return 999;
  return Math.abs(Math.round((leftDate.getTime() - rightDate.getTime()) / 86400000));
}

function isValidKdvOrani(oran) {
  return VALID_KDV_ORANLARI.some((valid) => Math.abs(valid - oran) < 0.01);
}

function computeExpectedKdv(matrah, kdvOrani) {
  return roundMoney((matrah * kdvOrani) / 100);
}

function buildIssues(row, allRows = []) {
  const issues = [];
  let riskScore = 0;

  const matrah = roundMoney(row.matrah);
  const kdvOrani = roundMoney(row.kdvOrani);
  const kdvTutari = roundMoney(row.kdvTutari);
  const toplamTutar = roundMoney(row.toplamTutar);
  const tevkifat = roundMoney(row.tevkifat);
  const expectedKdv = computeExpectedKdv(matrah, kdvOrani);
  const kdvFarki = roundMoney(kdvTutari - expectedKdv);
  const expectedToplam = roundMoney(matrah + kdvTutari);

  if (!row.belgeNo) {
    issues.push("Belge no boş.");
    riskScore += 15;
  }

  if (!row.cariUnvan) {
    issues.push("Cari ünvan boş.");
    riskScore += 10;
  }

  if (!row.vergiNo && row.kaynak !== KDV_KAYNAK.MUAVIN) {
    issues.push("Vergi no boş.");
    riskScore += 10;
  }

  if (matrah < 0 || kdvTutari < 0 || toplamTutar < 0) {
    issues.push("Negatif/ters kayıt tespit edildi.");
    riskScore += 25;
  }

  if (row.istisnaKodu && (kdvTutari > 0.01 || kdvOrani > 0.01)) {
    issues.push("İstisna kodu varken KDV olmamalı.");
    riskScore += 30;
  }

  if (!row.istisnaKodu && kdvOrani > 0 && !isValidKdvOrani(kdvOrani)) {
    issues.push(`KDV oranı hatalı: %${kdvOrani}`);
    riskScore += 25;
  }

  if (matrah > 0 && kdvOrani > 0 && Math.abs(kdvFarki) > KDV_TOLERANCE) {
    issues.push(`KDV farkı: ${kdvFarki.toLocaleString("tr-TR")} TL`);
    riskScore += Math.min(35, Math.round(Math.abs(kdvFarki) / 10));
  }

  if (toplamTutar > 0 && Math.abs(toplamTutar - expectedToplam) > KDV_TOLERANCE) {
    issues.push(
      `Toplam tutar farkı: ${roundMoney(toplamTutar - expectedToplam).toLocaleString("tr-TR")} TL`
    );
    riskScore += 20;
  }

  if (tevkifat > 0) {
    if (tevkifat > kdvTutari + KDV_TOLERANCE) {
      issues.push("Tevkifat tutarı KDV tutarından büyük.");
      riskScore += 25;
    } else if (kdvTutari <= 0.01) {
      issues.push("Tevkifat var ancak KDV tutarı yok.");
      riskScore += 20;
    } else {
      issues.push("Tevkifat ayrımı kontrol edilmeli.");
      riskScore += 10;
    }
  }

  const belgeDuplicates = allRows.filter(
    (item) =>
      item.id !== row.id &&
      item.belgeNo &&
      compactText(item.belgeNo) === compactText(row.belgeNo)
  );

  if (belgeDuplicates.length > 0) {
    issues.push("Belge no mükerrer.");
    riskScore += 30;
  }

  const nearDuplicates = allRows.filter((item) => {
    if (item.id === row.id) return false;
    if (roundMoney(item.toplamTutar) !== toplamTutar || !toplamTutar) return false;
    if (compactText(item.cariUnvan) !== compactText(row.cariUnvan) || !row.cariUnvan) {
      return false;
    }
    return daysBetween(item.tarih, row.tarih) <= NEAR_DATE_DAYS;
  });

  if (nearDuplicates.length) {
    issues.push("Aynı cari + tutar + yakın tarih mükerrer riski.");
    riskScore += 25;
  }

  return {
    issues,
    riskScore: Math.min(100, riskScore),
    kdvFarki,
    expectedKdv,
    expectedToplam,
  };
}

function resolvePrimaryGroup(issues = [], row = {}) {
  if (!row.belgeNo || !row.cariUnvan || (!row.vergiNo && row.kaynak !== KDV_KAYNAK.MUAVIN)) {
    return KDV_KONTROL_GRUP.EKSIK_BILGI;
  }

  const text = issues.join(" ").toLowerCase();

  if (text.includes("negatif") || text.includes("ters")) {
    if (text.includes("kdv fark")) return KDV_KONTROL_GRUP.KDV_FARKI;
  }

  if (text.includes("kdv oranı hatalı") || text.includes("oran hatalı")) {
    return KDV_KONTROL_GRUP.ORAN_HATASI;
  }

  if (text.includes("kdv fark")) return KDV_KONTROL_GRUP.KDV_FARKI;
  if (text.includes("mükerrer") || text.includes("mukerrer")) return KDV_KONTROL_GRUP.MUKERRER;
  if (text.includes("tevkifat")) return KDV_KONTROL_GRUP.TEVKIFAT;
  if (text.includes("istisna")) return KDV_KONTROL_GRUP.ISTISNA;
  if (text.includes("boş")) return KDV_KONTROL_GRUP.EKSIK_BILGI;

  return KDV_KONTROL_GRUP.HATASIZ;
}

function resolveDurum(grup) {
  const map = {
    [KDV_KONTROL_GRUP.HATASIZ]: KDV_KONTROL_DURUM.HATASIZ,
    [KDV_KONTROL_GRUP.KDV_FARKI]: KDV_KONTROL_DURUM.KDV_FARKI,
    [KDV_KONTROL_GRUP.ORAN_HATASI]: KDV_KONTROL_DURUM.ORAN_HATASI,
    [KDV_KONTROL_GRUP.MUKERRER]: KDV_KONTROL_DURUM.MUKERRER,
    [KDV_KONTROL_GRUP.TEVKIFAT]: KDV_KONTROL_DURUM.TEVKIFAT,
    [KDV_KONTROL_GRUP.ISTISNA]: KDV_KONTROL_DURUM.ISTISNA,
    [KDV_KONTROL_GRUP.EKSIK_BILGI]: KDV_KONTROL_DURUM.EKSIK_BILGI,
  };

  return map[grup] || KDV_KONTROL_DURUM.HATASIZ;
}

export function analyzeKdvMatrahRow(row, allRows = []) {
  if (row.disaridaBirak) {
    return {
      ...row,
      issues: ["Kontrol dışı bırakıldı."],
      riskScore: 0,
      riskBand: riskBandFromScore(0),
      grup: KDV_KONTROL_GRUP.HATASIZ,
      durum: row.kontrolDurumu || "Kontrol dışı",
      kdvFarki: 0,
    };
  }

  const analysis = buildIssues(row, allRows);
  const grup = resolvePrimaryGroup(analysis.issues, row);
  const durum = row.kontrolDurumu || resolveDurum(grup);

  return {
    ...row,
    matrah: roundMoney(row.matrah),
    kdvOrani: roundMoney(row.kdvOrani),
    kdvTutari: roundMoney(row.kdvTutari),
    toplamTutar: roundMoney(row.toplamTutar),
    tevkifat: roundMoney(row.tevkifat),
    issues: analysis.issues,
    riskScore: grup === KDV_KONTROL_GRUP.HATASIZ ? 0 : analysis.riskScore,
    riskBand: riskBandFromScore(grup === KDV_KONTROL_GRUP.HATASIZ ? 0 : analysis.riskScore),
    grup,
    durum,
    kdvFarki: analysis.kdvFarki,
    expectedKdv: analysis.expectedKdv,
    expectedToplam: analysis.expectedToplam,
  };
}

export function analyzeKdvMatrahRows(rows = []) {
  return rows.map((row) => analyzeKdvMatrahRow(row, rows));
}

export function recalculateKdvMatrahSummary(rows = []) {
  const activeRows = rows.filter((row) => !row.disaridaBirak);

  let toplamBelge = activeRows.length;
  let hatasizBelge = 0;
  let riskliBelge = 0;
  let kdvFarkiToplami = 0;
  let mukerrerRiskSayisi = 0;
  let eksikBilgiSayisi = 0;

  for (const row of activeRows) {
    if (row.grup === KDV_KONTROL_GRUP.HATASIZ) hatasizBelge += 1;
    if (row.riskScore >= 31) riskliBelge += 1;
    kdvFarkiToplami += Math.abs(roundMoney(row.kdvFarki));
    if (row.grup === KDV_KONTROL_GRUP.MUKERRER) mukerrerRiskSayisi += 1;
    if (row.grup === KDV_KONTROL_GRUP.EKSIK_BILGI) eksikBilgiSayisi += 1;
  }

  return {
    toplamBelge,
    hatasizBelge,
    riskliBelge,
    kdvFarkiToplami: roundMoney(kdvFarkiToplami),
    mukerrerRiskSayisi,
    eksikBilgiSayisi,
  };
}

export function filterKdvMatrahRows(rows = [], { grup = "", search = "" } = {}) {
  let result = rows;

  if (grup) {
    result = result.filter((row) => row.grup === grup);
  }

  const query = search.trim().toLocaleLowerCase("tr");
  if (query) {
    result = result.filter((row) =>
      [
        row.belgeNo,
        row.cariUnvan,
        row.vergiNo,
        row.durum,
        row.grup,
        row.aciklama,
        ...(row.issues || []),
      ]
        .join(" ")
        .toLocaleLowerCase("tr")
        .includes(query)
    );
  }

  return result;
}

export function groupKdvMatrahCounts(rows = []) {
  const counts = Object.fromEntries(Object.values(KDV_KONTROL_GRUP).map((grup) => [grup, 0]));

  for (const row of rows.filter((item) => !item.disaridaBirak)) {
    counts[row.grup] = (counts[row.grup] || 0) + 1;
  }

  return Object.entries(counts).map(([grup, count]) => ({ grup, count }));
}

export function runKdvMatrahKontrolPipeline({
  alisRows = [],
  satisRows = [],
  kdvListRows = [],
  muavinRows = [],
}) {
  const mergedRows = [...alisRows, ...satisRows, ...kdvListRows, ...muavinRows];
  const analyzedRows = analyzeKdvMatrahRows(mergedRows);
  const summary = recalculateKdvMatrahSummary(analyzedRows);
  const groupCounts = groupKdvMatrahCounts(analyzedRows);

  return {
    rows: analyzedRows,
    summary,
    groupCounts,
    integrationMeta: {
      source: "kdv-matrah-kontrol-v1",
      belgeNolar: analyzedRows.map((row) => row.belgeNo).filter(Boolean),
      vergiNolar: analyzedRows.map((row) => row.vergiNo).filter(Boolean),
      lucaFisKontrolReady: true,
      eDefterKontrolReady: true,
    },
  };
}

export function recalculateKdvMatrahRows(rows = []) {
  const analyzed = analyzeKdvMatrahRows(rows);
  return {
    rows: analyzed,
    summary: recalculateKdvMatrahSummary(analyzed),
    groupCounts: groupKdvMatrahCounts(analyzed),
  };
}
