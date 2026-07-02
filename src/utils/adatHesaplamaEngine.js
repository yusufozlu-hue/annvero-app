import {
  DEFAULT_FAIZ_GELIR_HESAP,
  DEFAULT_FAIZ_GIDER_HESAP,
  FAIZ_YONU,
  HESAPLAMA_MODU,
  buildAdatFisAciklama,
  buildKasaAdatFisAciklama,
  buildOrtakAdatFisAciklama,
} from "@/src/config/adatHesaplamaDefaults";
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

function accountMatchesPrefixes(accountCode, prefixes = []) {
  const compact = compactText(accountCode).replace(/\./g, "");
  if (!compact) return false;

  return prefixes.some((prefix) => {
    const wanted = String(prefix.prefix || prefix.id || prefix).replace(/\./g, "");
    return compact.startsWith(wanted);
  });
}

function getAccountPrefix(accountCode) {
  return compactText(accountCode).replace(/\./g, "").substring(0, 3);
}

function eachDayInRange(baslangic, bitis) {
  const start = parseDateTR(baslangic);
  const end = parseDateTR(bitis);
  if (!start || !end || end < start) return [];

  const days = [];
  const cursor = new Date(start.getTime());

  while (cursor <= end) {
    days.push(formatDateTR(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function formatMonthDonem(dateText) {
  const parsed = parseDateTR(dateText);
  if (!parsed) return dateText;
  return `${parsed.getFullYear()}/${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}

export function parseAdatMuavinSheet(sheetRows = []) {
  if (!sheetRows.length) return [];

  const headerIndex = findHeaderIndex(sheetRows, ["HESAP"]);
  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      const hesapKodu = String(
        getSheetCell(row, headers, ["HESAP KODU", "HESAPKODU", "HESAP"]) || ""
      ).trim();

      const hesapAdi = String(
        getSheetCell(row, headers, ["HESAP ADI", "HESAP AD", "HESAPADI"]) || ""
      ).trim();

      const tarih =
        getSheetCell(row, headers, [
          "FİŞ TARİHİ",
          "FIS TARIHI",
          "TARİH",
          "TARIH",
          "EVRAK TARİHİ",
        ]) || "";

      const fisNo = String(getSheetCell(row, headers, ["FİŞ NO", "FIS NO"]) || "").trim();

      const aciklama = String(
        getSheetCell(row, headers, [
          "DETAY AÇIKLAMA",
          "DETAY ACIKLAMA",
          "AÇIKLAMA",
          "ACIKLAMA",
          "FİŞ AÇIKLAMA",
        ]) || ""
      ).trim();

      const borc = parseMoneyTR(getSheetCell(row, headers, ["BORÇ", "BORC"]));
      const alacak = parseMoneyTR(getSheetCell(row, headers, ["ALACAK"]));
      const bakiyeRaw = getSheetCell(row, headers, ["BAKİYE", "BAKIYE", "TL BAKIYE"]);

      if (!hesapKodu || !tarih) return null;

      return {
        id: `muavin-${index + 1}`,
        hesapKodu,
        hesapAdi,
        tarih: formatDateTR(tarih),
        fisNo,
        aciklama,
        borc,
        alacak,
        bakiye: bakiyeRaw !== "" ? parseMoneyTR(bakiyeRaw) : null,
      };
    })
    .filter(Boolean);
}

export function parseAdatMizanSheet(sheetRows = []) {
  if (!sheetRows.length) return [];

  const headerIndex = findHeaderIndex(sheetRows, ["HESAP"]);
  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .map((row, index) => {
      const hesapKodu = String(
        getSheetCell(row, headers, ["HESAP KODU", "HESAPKODU", "HESAP"]) || row[0] || ""
      ).trim();
      const hesapAdi = String(
        getSheetCell(row, headers, ["HESAP ADI", "HESAP AD"]) || row[1] || ""
      ).trim();
      const borc = parseMoneyTR(getSheetCell(row, headers, ["BORÇ", "BORC"]));
      const alacak = parseMoneyTR(getSheetCell(row, headers, ["ALACAK"]));
      const bakiye = parseMoneyTR(getSheetCell(row, headers, ["BAKİYE", "BAKIYE"]));

      if (!hesapKodu) return null;

      return {
        id: `mizan-${index + 1}`,
        hesapKodu,
        hesapAdi,
        borc,
        alacak,
        bakiye: bakiye || roundMoney(borc - alacak),
      };
    })
    .filter(Boolean);
}

export function resolveDefaultFaizYonu(hesapKodu, bakiye) {
  const prefix = getAccountPrefix(hesapKodu);

  if (prefix === "331" || prefix === "295") {
    return FAIZ_YONU.GIDER;
  }

  if (prefix === "100" && bakiye < 0) {
    return FAIZ_YONU.GIDER;
  }

  if (bakiye < 0) {
    return FAIZ_YONU.GIDER;
  }

  return FAIZ_YONU.GELIR;
}

export function resolveFaizHesap(faizYonu, params = {}) {
  if (faizYonu === FAIZ_YONU.GIDER) {
    return params.faizGiderHesap || DEFAULT_FAIZ_GIDER_HESAP;
  }

  return params.faizGelirHesap || DEFAULT_FAIZ_GELIR_HESAP;
}

export function buildDefaultAdatAciklama(hesapKodu, hesapAdi, donem) {
  const prefix = getAccountPrefix(hesapKodu);

  if (prefix === "131" || prefix === "331") {
    return buildOrtakAdatFisAciklama(donem);
  }

  if (prefix === "100") {
    return buildKasaAdatFisAciklama(donem);
  }

  return buildAdatFisAciklama(donem, hesapAdi || hesapKodu);
}

function calculateDailyInterest(bakiye, yillikFaizOrani, gunBazi) {
  const basis = Number(gunBazi) === 365 ? 365 : 360;
  return roundMoney((Math.abs(bakiye) * (yillikFaizOrani / 100)) / basis);
}

function buildOpeningBalance(movements, donemBaslangic) {
  const startDate = parseDateTR(donemBaslangic);
  if (!startDate) return 0;

  let balance = 0;
  let lastKnownBalance = null;

  for (const move of movements) {
    const moveDate = parseDateTR(move.tarih);
    if (!moveDate) continue;

    if (moveDate < startDate) {
      balance += roundMoney((move.borc || 0) - (move.alacak || 0));
      if (move.bakiye !== null && move.bakiye !== undefined) {
        lastKnownBalance = move.bakiye;
      }
    }
  }

  return lastKnownBalance !== null ? lastKnownBalance : balance;
}

export function buildDailyBalanceSeries(accountMovements = [], params = {}) {
  const {
    donemBaslangic = "",
    donemBitis = "",
    yillikFaizOrani = 0,
    gunBazi = 360,
    negatifHaric = false,
    sifirGizle = false,
  } = params;

  const days = eachDayInRange(donemBaslangic, donemBitis);
  if (!days.length) return [];

  const sortedMoves = [...accountMovements].sort((left, right) => {
    const leftDate = parseDateTR(left.tarih);
    const rightDate = parseDateTR(right.tarih);
    if (!leftDate || !rightDate) return 0;
    return leftDate.getTime() - rightDate.getTime();
  });

  let balance = buildOpeningBalance(sortedMoves, donemBaslangic);
  const rows = [];

  for (const day of days) {
    const dayMoves = sortedMoves.filter((move) => formatDateTR(move.tarih) === day);

    for (const move of dayMoves) {
      balance = roundMoney(balance + (move.borc || 0) - (move.alacak || 0));
      if (move.bakiye !== null && move.bakiye !== undefined) {
        balance = move.bakiye;
      }
    }

    if (negatifHaric && balance < 0) continue;
    if (sifirGizle && Math.abs(balance) < 0.005) continue;

    const gunlukFaiz = calculateDailyInterest(balance, yillikFaizOrani, gunBazi);

    rows.push({
      tarih: day,
      bakiye: balance,
      gunSayisi: 1,
      gunlukFaiz,
      faizOrani: yillikFaizOrani,
    });
  }

  return rows;
}

export function aggregateMonthlyRows(dailyRows = [], context = {}) {
  const grouped = new Map();

  for (const row of dailyRows) {
    const donem = formatMonthDonem(row.tarih);
    if (!grouped.has(donem)) {
      grouped.set(donem, {
        ...context,
        id: `${context.hesapKodu}-${donem}`,
        tarih: row.tarih,
        donem,
        bakiyeToplam: 0,
        gunSayisi: 0,
        gunlukFaiz: 0,
      });
    }

    const bucket = grouped.get(donem);
    bucket.bakiyeToplam += row.bakiye;
    bucket.gunSayisi += 1;
    bucket.gunlukFaiz += row.gunlukFaiz;
    bucket.tarih = row.tarih;
    bucket.bakiye = roundMoney(bucket.bakiyeToplam / bucket.gunSayisi);
  }

  return [...grouped.values()].map((item) => ({
    ...item,
    gunlukFaiz: roundMoney(item.gunlukFaiz),
    bakiye: roundMoney(item.bakiye),
  }));
}

export function aggregatePeriodEndRow(dailyRows = [], context = {}) {
  if (!dailyRows.length) return [];

  const totalFaiz = roundMoney(dailyRows.reduce((sum, row) => sum + row.gunlukFaiz, 0));
  const avgBalance = roundMoney(
    dailyRows.reduce((sum, row) => sum + row.bakiye, 0) / dailyRows.length
  );
  const lastRow = dailyRows[dailyRows.length - 1];
  const donem = formatMonthDonem(lastRow.tarih);

  return [
    {
      ...context,
      id: `${context.hesapKodu}-donem-sonu`,
      tarih: lastRow.tarih,
      donem,
      bakiye: avgBalance,
      gunSayisi: dailyRows.length,
      gunlukFaiz: totalFaiz,
      faizOrani: context.faizOrani,
    },
  ];
}

export function buildOneriFisSatirlari(row, params = {}) {
  const faizYonu = row.faizYonu || resolveDefaultFaizYonu(row.hesapKodu, row.bakiye);
  const tutar = roundMoney(row.gunlukFaiz);
  if (tutar < 0.01) return [];

  const faizHesap = row.faizHesap || resolveFaizHesap(faizYonu, params);
  const aciklama = row.aciklama || buildDefaultAdatAciklama(row.hesapKodu, row.hesapAdi, row.donem);

  if (faizYonu === FAIZ_YONU.GELIR) {
    return [
      { hesapKodu: row.hesapKodu, borc: tutar, alacak: 0, aciklama },
      { hesapKodu: faizHesap, borc: 0, alacak: tutar, aciklama },
    ];
  }

  return [
    { hesapKodu: faizHesap, borc: tutar, alacak: 0, aciklama },
    { hesapKodu: row.hesapKodu, borc: 0, alacak: tutar, aciklama },
  ];
}

export function buildAdatPreviewRows(muavinRows = [], params = {}) {
  const {
    selectedAccounts = [],
    accountPlan = [],
    hesaplamaModu = HESAPLAMA_MODU.GUNLUK_DETAY,
    donemBaslangic = "",
    donemBitis = "",
    yillikFaizOrani = 0,
    gunBazi = 360,
    negatifHaric = false,
    sifirGizle = false,
    faizGelirHesap = DEFAULT_FAIZ_GELIR_HESAP,
    faizGiderHesap = DEFAULT_FAIZ_GIDER_HESAP,
  } = params;

  const planMap = new Map(
    accountPlan.map((item) => [
      compactText(item.accountCode || item.hesapKodu).replace(/\./g, ""),
      item.accountName || item.hesapAdi || "",
    ])
  );

  const filtered = muavinRows.filter((row) => accountMatchesPrefixes(row.hesapKodu, selectedAccounts));

  const grouped = new Map();
  for (const row of filtered) {
    const key = compactText(row.hesapKodu).replace(/\./g, "");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const previewRows = [];

  grouped.forEach((movements, key) => {
    const hesapKodu = movements[0]?.hesapKodu || key;
    const hesapAdi = movements[0]?.hesapAdi || planMap.get(key) || "";

    const dailyRows = buildDailyBalanceSeries(movements, {
      donemBaslangic,
      donemBitis,
      yillikFaizOrani,
      gunBazi,
      negatifHaric,
      sifirGizle,
    });

    const context = {
      hesapKodu,
      hesapAdi,
      faizOrani: yillikFaizOrani,
      disaridaBirak: false,
    };

    let rows = dailyRows.map((row) => ({
      ...context,
      id: `${hesapKodu}-${row.tarih}`,
      tarih: row.tarih,
      donem: formatMonthDonem(row.tarih),
      bakiye: row.bakiye,
      gunSayisi: row.gunSayisi,
      gunlukFaiz: row.gunlukFaiz,
      faizOrani: row.faizOrani,
      faizYonu: resolveDefaultFaizYonu(hesapKodu, row.bakiye),
      faizHesap: resolveFaizHesap(resolveDefaultFaizYonu(hesapKodu, row.bakiye), params),
      fisTarihi: row.tarih,
      aciklama: buildDefaultAdatAciklama(hesapKodu, hesapAdi, formatMonthDonem(row.tarih)),
    }));

    if (hesaplamaModu === HESAPLAMA_MODU.AYLIK_TOPLU) {
      rows = aggregateMonthlyRows(dailyRows, context).map((row) => ({
        ...row,
        faizYonu: resolveDefaultFaizYonu(hesapKodu, row.bakiye),
        faizHesap: resolveFaizHesap(resolveDefaultFaizYonu(hesapKodu, row.bakiye), params),
        fisTarihi: row.tarih,
        aciklama: buildDefaultAdatAciklama(hesapKodu, hesapAdi, row.donem),
      }));
    }

    if (hesaplamaModu === HESAPLAMA_MODU.DONEM_SONU) {
      rows = aggregatePeriodEndRow(dailyRows, context).map((row) => ({
        ...row,
        faizYonu: resolveDefaultFaizYonu(hesapKodu, row.bakiye),
        faizHesap: resolveFaizHesap(resolveDefaultFaizYonu(hesapKodu, row.bakiye), params),
        fisTarihi: row.tarih,
        aciklama: buildDefaultAdatAciklama(hesapKodu, hesapAdi, row.donem),
      }));
    }

    for (const row of rows) {
      previewRows.push({
        ...row,
        oneriFis: buildOneriFisSatirlari(row, { faizGelirHesap, faizGiderHesap }),
      });
    }
  });

  return previewRows.filter((row) => !row.disaridaBirak);
}

export function recalculateAdatPreviewRows(rows = [], params = {}) {
  return rows
    .filter((row) => !row.disaridaBirak)
    .map((row) => {
      const faizOrani =
        row.faizOrani !== "" && row.faizOrani !== null && row.faizOrani !== undefined
          ? Number(row.faizOrani)
          : params.yillikFaizOrani;

      const bakiye = roundMoney(row.bakiye);
      const gunSayisi = Number(row.gunSayisi || 1);
      const basis = Number(params.gunBazi) === 365 ? 365 : 360;

      let gunlukFaiz = row.manuallyEdited && row.gunlukFaiz !== undefined
        ? roundMoney(row.gunlukFaiz)
        : roundMoney((Math.abs(bakiye) * (faizOrani / 100) * gunSayisi) / basis);

      if (params.hesaplamaModu === HESAPLAMA_MODU.GUNLUK_DETAY && !row.manuallyEdited) {
        gunlukFaiz = roundMoney((Math.abs(bakiye) * (faizOrani / 100)) / basis);
      }

      const faizYonu = row.faizYonu || resolveDefaultFaizYonu(row.hesapKodu, bakiye);
      const nextRow = {
        ...row,
        bakiye,
        faizOrani,
        gunlukFaiz,
        faizYonu,
        faizHesap: row.faizHesap || resolveFaizHesap(faizYonu, params),
        aciklama:
          row.aciklama || buildDefaultAdatAciklama(row.hesapKodu, row.hesapAdi, row.donem),
        fisTarihi: formatDateTR(row.fisTarihi || row.tarih),
      };

      return {
        ...nextRow,
        oneriFis: buildOneriFisSatirlari(nextRow, params),
      };
    });
}

export function buildAccountSummary(previewRows = []) {
  const grouped = new Map();

  for (const row of previewRows) {
    const key = compactText(row.hesapKodu).replace(/\./g, "");
    if (!grouped.has(key)) {
      grouped.set(key, {
        hesapKodu: row.hesapKodu,
        hesapAdi: row.hesapAdi,
        toplamFaiz: 0,
        ortalamaBakiye: 0,
        gunSayisi: 0,
        bakiyeToplam: 0,
        faizYonu: row.faizYonu,
      });
    }

    const bucket = grouped.get(key);
    bucket.toplamFaiz += roundMoney(row.gunlukFaiz);
    bucket.bakiyeToplam += roundMoney(row.bakiye);
    bucket.gunSayisi += Number(row.gunSayisi || 1);
  }

  return [...grouped.values()].map((item) => ({
    ...item,
    toplamFaiz: roundMoney(item.toplamFaiz),
    ortalamaBakiye: roundMoney(item.bakiyeToplam / Math.max(item.gunSayisi, 1)),
  }));
}

export function buildMonthlySummary(previewRows = []) {
  const grouped = new Map();

  for (const row of previewRows) {
    const key = `${row.donem}-${compactText(row.hesapKodu)}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        donem: row.donem,
        hesapKodu: row.hesapKodu,
        hesapAdi: row.hesapAdi,
        toplamFaiz: 0,
        ortalamaBakiye: 0,
        gunSayisi: 0,
        bakiyeToplam: 0,
      });
    }

    const bucket = grouped.get(key);
    bucket.toplamFaiz += roundMoney(row.gunlukFaiz);
    bucket.bakiyeToplam += roundMoney(row.bakiye);
    bucket.gunSayisi += Number(row.gunSayisi || 1);
  }

  return [...grouped.values()].map((item) => ({
    ...item,
    toplamFaiz: roundMoney(item.toplamFaiz),
    ortalamaBakiye: roundMoney(item.bakiyeToplam / Math.max(item.gunSayisi, 1)),
  }));
}

export function recalculateAdatSummary(previewRows = []) {
  const activeRows = previewRows.filter((row) => !row.disaridaBirak);
  const accountSummary = buildAccountSummary(activeRows);

  let toplamAdat = 0;
  let toplamFaizGeliri = 0;
  let toplamFaizGideri = 0;
  let bakiyeToplam = 0;
  let gunSayisi = 0;

  for (const row of activeRows) {
    toplamAdat += roundMoney(row.gunlukFaiz);
    bakiyeToplam += roundMoney(row.bakiye);
    gunSayisi += Number(row.gunSayisi || 1);

    if (row.faizYonu === FAIZ_YONU.GIDER) {
      toplamFaizGideri += roundMoney(row.gunlukFaiz);
    } else {
      toplamFaizGeliri += roundMoney(row.gunlukFaiz);
    }
  }

  return {
    toplamAdatTutari: roundMoney(toplamAdat),
    toplamFaizGeliri: roundMoney(toplamFaizGeliri),
    toplamFaizGideri: roundMoney(toplamFaizGideri),
    gunlukOrtalamaBakiye: roundMoney(bakiyeToplam / Math.max(gunSayisi, 1)),
    hesaplananGunSayisi: gunSayisi,
    islemYapilanHesapSayisi: accountSummary.length,
  };
}

export function buildAdatLucaRows(previewRows = [], params = {}) {
  const rows = [];
  let fisNo = 1;

  const grouped = new Map();
  for (const row of previewRows.filter((item) => !item.disaridaBirak && item.gunlukFaiz > 0)) {
    const key = `${row.hesapKodu}-${row.donem || formatMonthDonem(row.tarih)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  grouped.forEach((items) => {
    const base = items[0];
    const toplamFaiz = roundMoney(items.reduce((sum, item) => sum + item.gunlukFaiz, 0));
    const mergedRow = {
      ...base,
      gunlukFaiz: toplamFaiz,
    };
    const satirlar = buildOneriFisSatirlari(mergedRow, params);

    for (const satir of satirlar) {
      rows.push(
        finalizeStandardLucaRow({
          id: `adat-${fisNo}-${satir.hesapKodu}-${satir.borc}-${satir.alacak}`,
          firmaId: params.firmaId || "",
          kaynakTipi: "",
          kaynakAdi: "ADAT_HESAPLAMA",
          fisNo,
          fisTarihi: base.fisTarihi || base.tarih,
          fisAciklama: base.aciklama,
          belgeTuru: params.belgeTuru || "DK",
          belgeNo: "",
          hesapKodu: satir.hesapKodu,
          detayAciklama: satir.aciklama || base.aciklama,
          borc: satir.borc,
          alacak: satir.alacak,
        })
      );
    }

    fisNo += 1;
  });

  return rows;
}

export function runAdatHesaplamaPipeline({
  muavinRows = [],
  mizanRows = [],
  selectedAccounts = [],
  accountPlan = [],
  donemBaslangic = "",
  donemBitis = "",
  yillikFaizOrani = 0,
  gunBazi = 360,
  hesaplamaModu = HESAPLAMA_MODU.GUNLUK_DETAY,
  negatifHaric = false,
  sifirGizle = false,
  faizGelirHesap = DEFAULT_FAIZ_GELIR_HESAP,
  faizGiderHesap = DEFAULT_FAIZ_GIDER_HESAP,
  bsmvHesap = "",
  firmaId = "",
  belgeTuru = "DK",
}) {
  const params = {
    selectedAccounts,
    accountPlan,
    donemBaslangic,
    donemBitis,
    yillikFaizOrani,
    gunBazi,
    hesaplamaModu,
    negatifHaric,
    sifirGizle,
    faizGelirHesap,
    faizGiderHesap,
    bsmvHesap,
  };

  const previewRows = buildAdatPreviewRows(muavinRows, params);
  const summary = recalculateAdatSummary(previewRows);
  const accountSummary = buildAccountSummary(previewRows);
  const monthlySummary = buildMonthlySummary(previewRows);
  const lucaRows = buildAdatLucaRows(previewRows, {
    firmaId,
    belgeTuru,
    faizGelirHesap,
    faizGiderHesap,
  });

  return {
    previewRows,
    summary,
    accountSummary,
    monthlySummary,
    mizanRows,
    lucaRows,
    bankIntegrationMeta: {
      source: "adat-hesaplama-v1",
      donemBaslangic,
      donemBitis,
      accountCodes: accountSummary.map((item) => item.hesapKodu),
    },
  };
}

export function validateAdatBalanceFromMuavin(muavinRows = [], selectedAccounts = []) {
  const filtered = muavinRows.filter((row) => accountMatchesPrefixes(row.hesapKodu, selectedAccounts));
  return filtered.length > 0;
}
