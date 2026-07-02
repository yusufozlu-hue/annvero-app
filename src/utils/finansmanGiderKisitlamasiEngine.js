import {
  DEFAULT_KKEG_HESAP,
  buildKkegFisAciklama,
} from "@/src/config/finansmanGiderKisitlamasiDefaults";
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

function findHeaderIndex(rows, requiredTokens = []) {
  return rows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return requiredTokens.every((token) => text.includes(token));
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

function isWithinPeriod(tarih, baslangic, bitis) {
  const rowDate = parseDateTR(tarih);
  const startDate = parseDateTR(baslangic);
  const endDate = parseDateTR(bitis);

  if (!rowDate) return true;
  if (startDate && rowDate < startDate) return false;
  if (endDate && rowDate > endDate) return false;
  return true;
}

export function parseMizanSheet(sheetRows = []) {
  if (!sheetRows.length) return [];

  const headerIndex = findHeaderIndex(sheetRows, ["HESAP"]);
  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      const hesapKodu = String(
        getSheetCell(row, headers, ["HESAP KODU", "HESAPKODU", "HESAP"]) || row[0] || ""
      ).trim();

      const hesapAdi = String(
        getSheetCell(row, headers, ["HESAP ADI", "HESAP AD", "HESAPADI"]) || row[1] || ""
      ).trim();

      const borc = parseMoneyTR(getSheetCell(row, headers, ["BORÇ", "BORC", "BORÇ TOPLAMI"]));
      const alacak = parseMoneyTR(
        getSheetCell(row, headers, ["ALACAK", "ALACAK TOPLAMI"])
      );
      const bakiye = parseMoneyTR(
        getSheetCell(row, headers, ["BAKİYE", "BAKIYE", "NET BAKİYE"])
      );

      if (!hesapKodu) return null;

      const netBakiye = bakiye || roundMoney(borc - alacak);

      return {
        id: `mizan-${index + 1}`,
        hesapKodu,
        hesapAdi,
        borc,
        alacak,
        netBakiye,
      };
    })
    .filter(Boolean);
}

export function parseFinansmanMuavinSheet(sheetRows = []) {
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

      if (!hesapKodu || (!borc && !alacak)) return null;

      return {
        id: `muavin-${index + 1}`,
        hesapKodu,
        hesapAdi,
        tarih: formatDateTR(tarih),
        aciklama,
        borc,
        alacak,
        netFinansmanGideri: roundMoney(borc - alacak),
      };
    })
    .filter(Boolean);
}

export function computeSuggestedKisitlamaOrani(ozKaynak, yabanciKaynak) {
  const ok = roundMoney(ozKaynak);
  const yk = roundMoney(yabanciKaynak);

  if (yk <= 0 || yk <= ok) return 0;

  return roundMoney(((yk - ok) / yk) * 100);
}

export function filterFinansmanMuavinRows(rows = [], options = {}) {
  const {
    selectedAccounts = [],
    donemBaslangic = "",
    donemBitis = "",
    accountPlan = [],
  } = options;

  const planMap = new Map(
    accountPlan.map((item) => [
      compactText(item.accountCode || item.hesapKodu).replace(/\./g, ""),
      item.accountName || item.hesapAdi || "",
    ])
  );

  return rows
    .filter((row) => accountMatchesPrefixes(row.hesapKodu, selectedAccounts))
    .filter((row) => isWithinPeriod(row.tarih, donemBaslangic, donemBitis))
    .map((row) => {
      const key = compactText(row.hesapKodu).replace(/\./g, "");
      return {
        ...row,
        hesapAdi: row.hesapAdi || planMap.get(key) || "",
        disaridaBirak: false,
        disaridaNeden: "",
        kisitlamayaTabi: true,
        kkegTutari: 0,
      };
    });
}

export function aggregateMizanByAccount(mizanRows = [], selectedAccounts = []) {
  const grouped = new Map();

  for (const row of mizanRows) {
    if (!accountMatchesPrefixes(row.hesapKodu, selectedAccounts)) continue;

    const key = compactText(row.hesapKodu).replace(/\./g, "");
    grouped.set(key, {
      hesapKodu: row.hesapKodu,
      hesapAdi: row.hesapAdi,
      netFinansmanGideri: roundMoney(row.netBakiye > 0 ? row.netBakiye : 0),
    });
  }

  return [...grouped.values()];
}

export function calculateFinansmanGiderKisitlamasi(previewRows = [], params = {}) {
  const ozKaynak = roundMoney(params.ozKaynak);
  const yabanciKaynak = roundMoney(params.yabanciKaynak);
  const donemYili = params.donemYili || new Date().getFullYear();
  const userOran = roundMoney(params.kisitlamaOrani);

  const suggestedOran = computeSuggestedKisitlamaOrani(ozKaynak, yabanciKaynak);
  const kisitlamaUygulanir = yabanciKaynak > ozKaynak && yabanciKaynak > 0;
  const effectiveOran = kisitlamaUygulanir
    ? userOran > 0
      ? userOran
      : suggestedOran
    : 0;

  let toplamFinansmanGideri = 0;
  let kisitlamayaTabiGider = 0;
  let kisitlamaDisiGider = 0;

  const calculatedRows = previewRows.map((row) => {
    const net = roundMoney(Math.max(row.netFinansmanGideri || 0, 0));
    toplamFinansmanGideri += net;

    const disarida = Boolean(row.disaridaBirak);
    const tabi = !disarida && row.kisitlamayaTabi !== false;

    if (tabi) {
      kisitlamayaTabiGider += net;
    } else {
      kisitlamaDisiGider += net;
    }

    const rowKkeg =
      tabi && kisitlamaUygulanir && effectiveOran > 0
        ? roundMoney(net * (effectiveOran / 100))
        : 0;

    return {
      ...row,
      netFinansmanGideri: net,
      kisitlamayaTabi: tabi,
      kkegTutari: rowKkeg,
    };
  });

  const kkegTutari = kisitlamaUygulanir
    ? roundMoney(kisitlamayaTabiGider * (effectiveOran / 100))
    : 0;
  const kabulEdilenGider = roundMoney(toplamFinansmanGideri - kkegTutari);

  return {
    rows: calculatedRows,
    summary: {
      toplamFinansmanGideri: roundMoney(toplamFinansmanGideri),
      kisitlamayaTabiGider: roundMoney(kisitlamayaTabiGider),
      kisitlamaDisiGider: roundMoney(kisitlamaDisiGider),
      kkegTutari,
      kabulEdilenGider,
      ozKaynak,
      yabanciKaynak,
      kisitlamaOrani: effectiveOran,
      suggestedOran,
      kisitlamaUygulanir,
      uyari: kisitlamaUygulanir
        ? ""
        : "Yabancı kaynak öz kaynağa eşit veya daha düşük; finansman gider kısıtlaması uygulanmaz.",
    },
    kkegList: calculatedRows.filter((row) => row.kkegTutari > 0),
    lucaSuggestion: buildKkegLucaSuggestion({
      donemYili,
      kkegTutari,
      kkegHesap: params.kkegHesap || DEFAULT_KKEG_HESAP,
      nazimHesap: params.nazimHesap || "",
      fisTarihi: params.donemBitis || params.donemBaslangic || "",
      firmaId: params.firmaId || "",
    }),
  };
}

export function buildKkegLucaSuggestion({
  donemYili,
  kkegTutari = 0,
  kkegHesap = DEFAULT_KKEG_HESAP,
  nazimHesap = "",
  fisTarihi = "",
  firmaId = "",
}) {
  if (kkegTutari < 0.01) {
    return {
      enabled: false,
      fisAciklama: buildKkegFisAciklama(donemYili),
      rows: [],
    };
  }

  const fisAciklama = buildKkegFisAciklama(donemYili);
  const counterAccount = nazimHesap || "660";
  const rows = [
    finalizeStandardLucaRow({
      id: `fkg-kkeg-${donemYili}-1`,
      firmaId,
      kaynakTipi: "",
      kaynakAdi: "FINANSMAN_GIDER_KISITLAMASI",
      fisNo: 1,
      fisTarihi,
      fisAciklama,
      belgeTuru: "DK",
      belgeNo: "",
      hesapKodu: kkegHesap,
      detayAciklama: fisAciklama,
      borc: kkegTutari,
      alacak: 0,
    }),
    finalizeStandardLucaRow({
      id: `fkg-kkeg-${donemYili}-2`,
      firmaId,
      kaynakTipi: "",
      kaynakAdi: "FINANSMAN_GIDER_KISITLAMASI",
      fisNo: 1,
      fisTarihi,
      fisAciklama,
      belgeTuru: "DK",
      belgeNo: "",
      hesapKodu: counterAccount,
      detayAciklama: fisAciklama,
      borc: 0,
      alacak: kkegTutari,
    }),
  ];

  return {
    enabled: true,
    fisAciklama,
    kkegHesap,
    nazimHesap,
    rows,
  };
}

export function runFinansmanGiderKisitlamasiPipeline({
  muavinRows = [],
  mizanRows = [],
  selectedAccounts = [],
  accountPlan = [],
  donemBaslangic = "",
  donemBitis = "",
  donemYili = "",
  ozKaynak = 0,
  yabanciKaynak = 0,
  kisitlamaOrani = 0,
  kkegHesap = DEFAULT_KKEG_HESAP,
  nazimHesap = "",
  firmaId = "",
}) {
  const filteredRows = filterFinansmanMuavinRows(muavinRows, {
    selectedAccounts,
    donemBaslangic,
    donemBitis,
    accountPlan,
  });

  const mizanAccounts = aggregateMizanByAccount(mizanRows, selectedAccounts);

  const result = calculateFinansmanGiderKisitlamasi(filteredRows, {
    ozKaynak,
    yabanciKaynak,
    kisitlamaOrani,
    donemYili,
    donemBaslangic,
    donemBitis,
    kkegHesap,
    nazimHesap,
    firmaId,
  });

  return {
    ...result,
    mizanAccounts,
    accountDistribution: buildAccountDistribution(result.rows),
  };
}

export function buildAccountDistribution(rows = []) {
  const grouped = new Map();

  for (const row of rows) {
    const key = compactText(row.hesapKodu).replace(/\./g, "");
    if (!grouped.has(key)) {
      grouped.set(key, {
        hesapKodu: row.hesapKodu,
        hesapAdi: row.hesapAdi,
        toplamGider: 0,
        kisitlamayaTabi: 0,
        kisitlamaDisi: 0,
        kkegTutari: 0,
      });
    }

    const bucket = grouped.get(key);
    const net = roundMoney(row.netFinansmanGideri || 0);
    bucket.toplamGider += net;

    if (row.kisitlamayaTabi) {
      bucket.kisitlamayaTabi += net;
      bucket.kkegTutari += roundMoney(row.kkegTutari || 0);
    } else {
      bucket.kisitlamaDisi += net;
    }
  }

  return [...grouped.values()].map((item) => ({
    ...item,
    toplamGider: roundMoney(item.toplamGider),
    kisitlamayaTabi: roundMoney(item.kisitlamayaTabi),
    kisitlamaDisi: roundMoney(item.kisitlamaDisi),
    kkegTutari: roundMoney(item.kkegTutari),
  }));
}

export function recalculateWithRowOverrides(rows = [], params = {}) {
  return calculateFinansmanGiderKisitlamasi(rows, params);
}
