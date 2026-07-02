import {
  ARAC_SAHIPLIK,
  ARAC_TIPI,
  DEFAULT_BINEK_KISIT_ORANI,
  DEFAULT_GELECEK_DONEM_HESABI,
  DEFAULT_GIDER_HESABI,
  DEFAULT_KKEG_HESAP,
  GIDERLESTIRME_TIPI,
  KDV_DURUMU,
  buildBinekKkegFisAciklama,
  buildGiderlestirmeFisAciklama,
} from "@/src/config/policeGiderlestirmeDefaults";
import { formatDateTR, parseDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { finalizeStandardLucaRow } from "@/src/utils/standardLucaRow";
import { normalizeParserText } from "@/src/utils/textNormalize";

function compactText(value) {
  return normalizeParserText(value).replace(/\s+/g, "");
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function normalizeAracTipi(value) {
  const text = compactText(value);
  if (text.includes("TICARI") || text.includes("KAMYON") || text.includes("TIR")) {
    return ARAC_TIPI.TICARI;
  }
  if (text.includes("BINEK") || text.includes("OTOMOBIL") || text.includes("ARABA")) {
    return ARAC_TIPI.BINEK;
  }
  return ARAC_TIPI.BINEK;
}

function normalizeSahiplik(value) {
  const text = compactText(value);
  if (text.includes("KIRALIK") || text.includes("KIRALAMA")) return ARAC_SAHIPLIK.KIRALIK;
  return ARAC_SAHIPLIK.SAHIP;
}

function findHeaderIndex(rows, tokens = []) {
  return rows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return tokens.every((token) => text.includes(token));
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

function daysBetweenInclusive(start, end) {
  const startDate = parseDateTR(start);
  const endDate = parseDateTR(end);
  if (!startDate || !endDate || endDate < startDate) return 0;
  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
}

function normalizeKdvAmount(tutar, kdvDurumu) {
  const amount = roundMoney(tutar);
  if (kdvDurumu === KDV_DURUMU.HARIC) return amount;
  return roundMoney(amount / 1.2);
}

function formatDonemLabel(year, month) {
  return `${year}/${String(month).padStart(2, "0")}`;
}

function formatQuarterLabel(year, quarter) {
  return `${year}/Q${quarter}`;
}

function getQuarter(month) {
  return Math.ceil(month / 3);
}

function intersectDaysInMonth(policyStart, policyEnd, year, month) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const startDate = parseDateTR(policyStart);
  const endDate = parseDateTR(policyEnd);

  if (!startDate || !endDate) return 0;

  const rangeStart = startDate > monthStart ? startDate : monthStart;
  const rangeEnd = endDate < monthEnd ? endDate : monthEnd;

  if (rangeEnd < rangeStart) return 0;

  return Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 86400000) + 1;
}

export function parsePoliceListSheet(sheetRows = []) {
  if (!sheetRows.length) return [];

  const headerIndex = findHeaderIndex(sheetRows, ["PLAKA"]);
  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      const policeNo = String(
        getSheetCell(row, headers, ["POLİÇE NO", "POLICE NO", "POLİÇE", "POLICE"]) || ""
      ).trim();

      const plaka = String(
        getSheetCell(row, headers, ["PLAKA", "ARAÇ PLAKA", "ARAC PLAKA"]) || ""
      ).trim();

      const baslangic =
        getSheetCell(row, headers, ["BAŞLANGIÇ", "BASLANGIC", "POLİÇE BAŞLANGIÇ", "BASLAMA"]) ||
        "";

      const bitis =
        getSheetCell(row, headers, ["BİTİŞ", "BITIS", "POLİÇE BİTİŞ", "SON"]) || "";

      const toplamTutar = parseMoneyTR(
        getSheetCell(row, headers, ["TUTAR", "TOPLAM TUTAR", "POLİÇE TUTARI", "PRIM"])
      );

      const kdvText = String(
        getSheetCell(row, headers, ["KDV", "KDV DURUMU", "KDV DAHİL"]) || ""
      ).toLowerCase();

      const kdvDurumu = kdvText.includes("HARIC") || kdvText.includes("HARİÇ")
        ? KDV_DURUMU.HARIC
        : KDV_DURUMU.DAHIL;

      const giderHesabi = String(
        getSheetCell(row, headers, ["GİDER HESABI", "GIDER HESABI", "HESAP KODU"]) || ""
      ).trim();

      const gelecekDonemHesabi = String(
        getSheetCell(row, headers, ["GELECEK DÖNEM", "GELECEK DONEM", "180"]) || ""
      ).trim();

      const aracTipi = normalizeAracTipi(
        getSheetCell(row, headers, ["ARAÇ TİPİ", "ARAC TIPI", "TİP", "TIP"]) || ""
      );

      const aciklama = String(
        getSheetCell(row, headers, ["AÇIKLAMA", "ACIKLAMA", "POLİÇE TİPİ", "TUR"]) || ""
      ).trim();

      if (!plaka || !baslangic || !bitis || !toplamTutar) return null;

      return {
        id: `police-${index + 1}`,
        policeNo: policeNo || `POL-${index + 1}`,
        plaka,
        baslangic: formatDateTR(baslangic),
        bitis: formatDateTR(bitis),
        toplamTutar,
        kdvDurumu,
        giderHesabi,
        gelecekDonemHesabi,
        aracTipi,
        aciklama: aciklama || "sigorta poliçesi",
      };
    })
    .filter(Boolean);
}

export function parseAracListSheet(sheetRows = []) {
  if (!sheetRows.length) return [];

  const headerIndex = findHeaderIndex(sheetRows, ["PLAKA"]);
  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      const plaka = String(getSheetCell(row, headers, ["PLAKA"]) || row[0] || "").trim();
      const aracAdi = String(
        getSheetCell(row, headers, ["ARAÇ ADI", "ARAC ADI", "MODEL", "MARKA MODEL"]) || row[1] || ""
      ).trim();

      const aracTipi = normalizeAracTipi(
        getSheetCell(row, headers, ["ARAÇ TİPİ", "ARAC TIPI", "TİP", "TIP"]) || row[2] || ""
      );

      const sahiplik = normalizeSahiplik(
        getSheetCell(row, headers, ["SAHİPLİK", "SAHIPLIK", "DURUM"]) || ""
      );

      const kisitTabiText = String(
        getSheetCell(row, headers, ["KISIT", "KISIT TABI", "GIDER KISIT"]) || ""
      ).toLowerCase();

      const giderHesabi = String(
        getSheetCell(row, headers, ["GİDER HESABI", "GIDER HESABI", "HESAP"]) || ""
      ).trim();

      if (!plaka) return null;

      const kisitTabi =
        aracTipi === ARAC_TIPI.BINEK &&
        !kisitTabiText.includes("HAYIR") &&
        !kisitTabiText.includes("DEGIL");

      return {
        id: `arac-${index + 1}`,
        plaka,
        aracAdi,
        aracTipi,
        sahiplik,
        kisitTabi,
        giderHesabi,
      };
    })
    .filter(Boolean);
}

export function buildAracMap(aracList = []) {
  const map = new Map();

  for (const arac of aracList) {
    map.set(compactText(arac.plaka), arac);
  }

  return map;
}

export function enrichPoliceWithArac(policeList = [], aracMap = new Map(), defaults = {}) {
  return policeList.map((police) => {
    const arac = aracMap.get(compactText(police.plaka));
    const aracTipi = police.aracTipi || arac?.aracTipi || ARAC_TIPI.BINEK;

    return {
      ...police,
      aracAdi: arac?.aracAdi || "",
      aracTipi,
      sahiplik: arac?.sahiplik || ARAC_SAHIPLIK.SAHIP,
      kisitTabi:
        aracTipi === ARAC_TIPI.TICARI
          ? false
          : arac?.kisitTabi !== undefined
            ? arac.kisitTabi
            : true,
      giderHesabi: police.giderHesabi || arac?.giderHesabi || defaults.giderHesabi || DEFAULT_GIDER_HESABI,
      gelecekDonemHesabi:
        police.gelecekDonemHesabi ||
        defaults.gelecekDonemHesabi ||
        DEFAULT_GELECEK_DONEM_HESABI,
    };
  });
}

export function buildMonthlyAllocations(police, donemYili) {
  const gunSayisi = daysBetweenInclusive(police.baslangic, police.bitis);
  if (gunSayisi <= 0) return [];

  const netTutar = normalizeKdvAmount(police.toplamTutar, police.kdvDurumu);
  const startDate = parseDateTR(police.baslangic);
  const endDate = parseDateTR(police.bitis);
  if (!startDate || !endDate) return [];

  const allocations = [];
  let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const lastMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (cursor <= lastMonth) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth() + 1;
    const daysInMonth = intersectDaysInMonth(police.baslangic, police.bitis, year, month);

    if (daysInMonth > 0) {
      allocations.push({
        year,
        month,
        quarter: getQuarter(month),
        donem: formatDonemLabel(year, month),
        gunSayisi: daysInMonth,
        giderlesecekTutar: roundMoney((netTutar * daysInMonth) / gunSayisi),
      });
    }

    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  if (donemYili) {
    return allocations.filter((item) => String(item.year) === String(donemYili));
  }

  return allocations;
}

export function aggregateQuarterlyAllocations(monthlyRows = []) {
  const grouped = new Map();

  for (const row of monthlyRows) {
    const key = `${row.year}-Q${row.quarter}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        year: row.year,
        quarter: row.quarter,
        donem: formatQuarterLabel(row.year, row.quarter),
        gunSayisi: 0,
        giderlesecekTutar: 0,
      });
    }

    const bucket = grouped.get(key);
    bucket.gunSayisi += row.gunSayisi;
    bucket.giderlesecekTutar += row.giderlesecekTutar;
  }

  return [...grouped.values()].map((item) => ({
    ...item,
    giderlesecekTutar: roundMoney(item.giderlesecekTutar),
  }));
}

export function applyBinekKisit(row, params = {}) {
  const kisitOrani = roundMoney(params.kisitOrani ?? DEFAULT_BINEK_KISIT_ORANI);
  const limit = roundMoney(params.kisitLimit ?? 0);

  if (!row.kisitTabi || row.aracTipi === ARAC_TIPI.TICARI) {
    return {
      ...row,
      kisitUygulanir: false,
      kabulEdilenGider: roundMoney(row.giderlesecekTutar),
      kkegTutari: 0,
    };
  }

  let kkegTutari = roundMoney(row.giderlesecekTutar * (kisitOrani / 100));

  if (limit > 0 && kkegTutari > limit) {
    kkegTutari = limit;
  }

  return {
    ...row,
    kisitUygulanir: true,
    kabulEdilenGider: roundMoney(row.giderlesecekTutar - kkegTutari),
    kkegTutari,
  };
}

export function buildPolicePreviewRows(policeList = [], params = {}) {
  const {
    donemYili = new Date().getFullYear(),
    giderlestirmeTipi = GIDERLESTIRME_TIPI.AYLIK,
    kisitOrani = DEFAULT_BINEK_KISIT_ORANI,
    kisitLimit = 0,
    defaultGiderHesabi = DEFAULT_GIDER_HESABI,
    defaultGelecekDonemHesabi = DEFAULT_GELECEK_DONEM_HESABI,
  } = params;

  const previewRows = [];

  for (const police of policeList) {
    const allMonthly = [];
    const startDate = parseDateTR(police.baslangic);
    const endDate = parseDateTR(police.bitis);
    if (!startDate || !endDate) continue;

    const gunSayisi = daysBetweenInclusive(police.baslangic, police.bitis);
    const netTutar = normalizeKdvAmount(police.toplamTutar, police.kdvDurumu);

    let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const lastMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

    while (cursor <= lastMonth) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth() + 1;
      const daysInMonth = intersectDaysInMonth(police.baslangic, police.bitis, year, month);

      if (daysInMonth > 0) {
        allMonthly.push({
          year,
          month,
          quarter: getQuarter(month),
          donem: formatDonemLabel(year, month),
          gunSayisi: daysInMonth,
          giderlesecekTutar: roundMoney((netTutar * daysInMonth) / gunSayisi),
        });
      }

      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    const periods =
      giderlestirmeTipi === GIDERLESTIRME_TIPI.Uc_AYLIK
        ? aggregateQuarterlyAllocations(allMonthly)
        : allMonthly;

    for (const period of periods) {
      const baseRow = {
        id: `${police.id}-${period.donem}`,
        policeId: police.id,
        plaka: police.plaka,
        policeNo: police.policeNo,
        baslangic: police.baslangic,
        bitis: police.bitis,
        toplamTutar: police.toplamTutar,
        aracTipi: police.aracTipi,
        aracAdi: police.aracAdi || "",
        kisitTabi: police.kisitTabi,
        donem: period.donem,
        donemYili: period.year,
        giderlesecekTutar: period.giderlesecekTutar,
        giderHesabi: police.giderHesabi || defaultGiderHesabi,
        gelecekDonemHesabi: police.gelecekDonemHesabi || defaultGelecekDonemHesabi,
        aciklama: buildGiderlestirmeFisAciklama(period.donem, police.plaka, police.aciklama),
        kkegDurumu: police.aracTipi === ARAC_TIPI.BINEK && police.kisitTabi,
        manuallyEdited: false,
      };

      previewRows.push(applyBinekKisit(baseRow, { kisitOrani, kisitLimit }));
    }
  }

  if (donemYili) {
    return previewRows.filter((row) => String(row.donemYili) === String(donemYili));
  }

  return previewRows;
}

export function recalculatePolicePreviewRows(rows = [], params = {}) {
  return rows.map((row) => {
    const next = {
      ...row,
      giderlesecekTutar: roundMoney(row.giderlesecekTutar),
    };

    if (row.kkegDurumu === false || row.aracTipi === ARAC_TIPI.TICARI) {
      return applyBinekKisit({ ...next, kisitTabi: false }, params);
    }

    return applyBinekKisit({ ...next, kisitTabi: true }, params);
  });
}

export function recalculatePoliceSummary(previewRows = [], policeList = [], params = {}) {
  const donemYili = String(params.donemYili || new Date().getFullYear());

  let toplamPoliceTutari = 0;
  let buDonemGider = 0;
  let gelecekDonemGider = 0;
  let kabulEdilenGider = 0;
  let kkegTutari = 0;
  let binekPoliceSayisi = 0;
  let ticariPoliceSayisi = 0;

  const seenPolice = new Set();

  for (const police of policeList) {
    toplamPoliceTutari += normalizeKdvAmount(police.toplamTutar, police.kdvDurumu);
    if (seenPolice.has(police.id)) continue;
    seenPolice.add(police.id);
    if (police.aracTipi === ARAC_TIPI.TICARI) ticariPoliceSayisi += 1;
    else binekPoliceSayisi += 1;
  }

  for (const row of previewRows) {
    buDonemGider += roundMoney(row.giderlesecekTutar);
    kabulEdilenGider += roundMoney(row.kabulEdilenGider);
    kkegTutari += roundMoney(row.kkegTutari);
  }

  for (const police of policeList) {
    const allMonthly = buildMonthlyAllocationsForPolice(police);
    for (const item of allMonthly) {
      if (String(item.year) !== donemYili) {
        gelecekDonemGider += item.giderlesecekTutar;
      }
    }
  }

  return {
    toplamPoliceTutari: roundMoney(toplamPoliceTutari),
    buDonemGider: roundMoney(buDonemGider),
    gelecekDonemGider: roundMoney(gelecekDonemGider),
    kabulEdilenGider: roundMoney(kabulEdilenGider),
    kkegTutari: roundMoney(kkegTutari),
    binekPoliceSayisi,
    ticariPoliceSayisi,
  };
}

function buildMonthlyAllocationsForPolice(police) {
  const gunSayisi = daysBetweenInclusive(police.baslangic, police.bitis);
  if (gunSayisi <= 0) return [];

  const netTutar = normalizeKdvAmount(police.toplamTutar, police.kdvDurumu);
  const startDate = parseDateTR(police.baslangic);
  const endDate = parseDateTR(police.bitis);
  if (!startDate || !endDate) return [];

  const allocations = [];
  let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const lastMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (cursor <= lastMonth) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth() + 1;
    const daysInMonth = intersectDaysInMonth(police.baslangic, police.bitis, year, month);

    if (daysInMonth > 0) {
      allocations.push({
        year,
        month,
        giderlesecekTutar: roundMoney((netTutar * daysInMonth) / gunSayisi),
      });
    }

    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return allocations;
}

export function buildAracDistribution(previewRows = []) {
  const grouped = new Map();

  for (const row of previewRows) {
    const key = compactText(row.plaka);
    if (!grouped.has(key)) {
      grouped.set(key, {
        plaka: row.plaka,
        aracAdi: row.aracAdi,
        aracTipi: row.aracTipi,
        toplamGider: 0,
        kabulEdilenGider: 0,
        kkegTutari: 0,
      });
    }

    const bucket = grouped.get(key);
    bucket.toplamGider += roundMoney(row.giderlesecekTutar);
    bucket.kabulEdilenGider += roundMoney(row.kabulEdilenGider);
    bucket.kkegTutari += roundMoney(row.kkegTutari);
  }

  return [...grouped.values()].map((item) => ({
    ...item,
    toplamGider: roundMoney(item.toplamGider),
    kabulEdilenGider: roundMoney(item.kabulEdilenGider),
    kkegTutari: roundMoney(item.kkegTutari),
  }));
}

export function buildGiderlestirmeLucaSuggestion(previewRows = [], params = {}) {
  const rows = [];

  for (const [index, item] of previewRows.entries()) {
    if (item.giderlesecekTutar < 0.01) continue;

    rows.push(
      finalizeStandardLucaRow({
        id: `police-gider-${item.id}`,
        firmaId: params.firmaId || "",
        kaynakAdi: "POLICE_GIDERLESTIRME",
        fisNo: index + 1,
        fisTarihi: params.fisTarihi || `${item.donem}/01`,
        fisAciklama: item.aciklama,
        belgeTuru: "DK",
        hesapKodu: item.giderHesabi,
        detayAciklama: item.aciklama,
        borc: item.kabulEdilenGider || item.giderlesecekTutar,
        alacak: 0,
      }),
      finalizeStandardLucaRow({
        id: `police-gelecek-${item.id}`,
        firmaId: params.firmaId || "",
        kaynakAdi: "POLICE_GIDERLESTIRME",
        fisNo: index + 1,
        fisTarihi: params.fisTarihi || `${item.donem}/01`,
        fisAciklama: item.aciklama,
        belgeTuru: "DK",
        hesapKodu: item.gelecekDonemHesabi,
        detayAciklama: item.aciklama,
        borc: 0,
        alacak: item.giderlesecekTutar,
      })
    );
  }

  return { enabled: rows.length > 0, rows };
}

export function buildKkegLucaSuggestion(previewRows = [], params = {}) {
  const kkegTotal = roundMoney(
    previewRows.reduce((sum, row) => sum + roundMoney(row.kkegTutari), 0)
  );

  if (kkegTotal < 0.01) {
    return { enabled: false, rows: [] };
  }

  const fisAciklama = buildBinekKkegFisAciklama(params.donemYili);
  const kkegHesap = params.kkegHesap || DEFAULT_KKEG_HESAP;

  return {
    enabled: true,
    fisAciklama,
    rows: [
      finalizeStandardLucaRow({
        id: `police-kkeg-1`,
        firmaId: params.firmaId || "",
        kaynakAdi: "POLICE_GIDERLESTIRME",
        fisNo: 1,
        fisTarihi: params.fisTarihi || "",
        fisAciklama,
        belgeTuru: "DK",
        hesapKodu: kkegHesap,
        detayAciklama: fisAciklama,
        borc: kkegTotal,
        alacak: 0,
      }),
      finalizeStandardLucaRow({
        id: `police-kkeg-2`,
        firmaId: params.firmaId || "",
        kaynakAdi: "POLICE_GIDERLESTIRME",
        fisNo: 1,
        fisTarihi: params.fisTarihi || "",
        fisAciklama,
        belgeTuru: "DK",
        hesapKodu: params.karsiHesap || DEFAULT_GIDER_HESABI,
        detayAciklama: fisAciklama,
        borc: 0,
        alacak: kkegTotal,
      }),
    ],
  };
}

export function runPoliceGiderlestirmePipeline({
  policeList = [],
  aracList = [],
  donemYili = "",
  giderlestirmeTipi = GIDERLESTIRME_TIPI.AYLIK,
  kisitOrani = DEFAULT_BINEK_KISIT_ORANI,
  kisitLimit = 0,
  defaultGiderHesabi = DEFAULT_GIDER_HESABI,
  defaultGelecekDonemHesabi = DEFAULT_GELECEK_DONEM_HESABI,
  firmaId = "",
}) {
  const aracMap = buildAracMap(aracList);
  const enrichedPolice = enrichPoliceWithArac(policeList, aracMap, {
    giderHesabi: defaultGiderHesabi,
    gelecekDonemHesabi: defaultGelecekDonemHesabi,
  });

  const params = {
    donemYili,
    giderlestirmeTipi,
    kisitOrani,
    kisitLimit,
    defaultGiderHesabi,
    defaultGelecekDonemHesabi,
  };

  const previewRows = buildPolicePreviewRows(enrichedPolice, params);
  const summary = recalculatePoliceSummary(previewRows, enrichedPolice, params);
  const aracDistribution = buildAracDistribution(previewRows);
  const kkegList = previewRows.filter((row) => row.kkegTutari > 0);

  return {
    policeList: enrichedPolice,
    aracList,
    previewRows,
    summary,
    aracDistribution,
    kkegList,
    donemDagilim: previewRows,
    lucaGiderlestirme: buildGiderlestirmeLucaSuggestion(previewRows, {
      firmaId,
      donemYili,
    }),
    lucaKkeg: buildKkegLucaSuggestion(previewRows, {
      firmaId,
      donemYili,
      kkegHesap: DEFAULT_KKEG_HESAP,
    }),
  };
}

export function createManualPoliceEntry(form = {}) {
  if (!form.plaka || !form.baslangic || !form.bitis || !form.toplamTutar) return null;

  return {
    id: `manual-${Date.now()}`,
    policeNo: form.policeNo || `POL-${Date.now()}`,
    plaka: form.plaka,
    baslangic: formatDateTR(form.baslangic),
    bitis: formatDateTR(form.bitis),
    toplamTutar: parseMoneyTR(form.toplamTutar),
    kdvDurumu: form.kdvDurumu || KDV_DURUMU.DAHIL,
    giderHesabi: form.giderHesabi || "",
    gelecekDonemHesabi: form.gelecekDonemHesabi || "",
    aracTipi: form.aracTipi || ARAC_TIPI.BINEK,
    aciklama: form.aciklama || "sigorta poliçesi",
  };
}
