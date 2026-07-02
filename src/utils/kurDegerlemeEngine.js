import {
  DEFAULT_KUR_FARKI_GELIR,
  DEFAULT_KUR_FARKI_GIDER,
  KUR_FARKI_TIP,
} from "@/src/config/kurDegerlemeDefaults";
import { formatDateTR, parseDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { finalizeStandardLucaRow } from "@/src/utils/standardLucaRow";
import { normalizeParserText } from "@/src/utils/textNormalize";

function compactText(value) {
  return normalizeParserText(value).replace(/\s+/g, "");
}

function normalizeCurrency(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("₺", "TL");

  if (!text || text === "TL" || text === "TRY" || text === "YTL") return "TL";
  if (text === "EURO") return "EUR";
  if (text === "DOLAR" || text === "USD") return "USD";
  return text.replace(/[^A-Z0-9]/g, "");
}

function findMuavinHeaderIndex(rows) {
  return rows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return (
      text.includes("HESAP") &&
      (text.includes("BORC") || text.includes("ALACAK")) &&
      (text.includes("TARIH") || text.includes("ACIKLAMA") || text.includes("BAKIYE"))
    );
  });
}

function getMuavinCell(row, headers, names) {
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

function accountMatchesGroups(accountCode, selectedGroups = []) {
  const compact = compactText(accountCode).replace(/\./g, "");
  if (!compact) return false;

  return selectedGroups.some((group) => {
    const prefix = String(group.prefix || group.id || group).replace(/\./g, "");
    return compact.startsWith(prefix);
  });
}

function isAktifAccount(accountCode) {
  const firstDigit = compactText(accountCode).replace(/\./g, "").charAt(0);
  return firstDigit === "1";
}

export function resolveKurFarkiTip(accountCode, kurFarkiSigned) {
  const aktif = isAktifAccount(accountCode);

  if (Math.abs(kurFarkiSigned) < 0.005) return null;

  if (aktif) {
    return kurFarkiSigned > 0 ? KUR_FARKI_TIP.GELIR : KUR_FARKI_TIP.GIDER;
  }

  return kurFarkiSigned > 0 ? KUR_FARKI_TIP.GIDER : KUR_FARKI_TIP.GELIR;
}

export function parseDovizliMuavinSheet(sheetRows = []) {
  if (!sheetRows.length) return [];

  const headerIndex = findMuavinHeaderIndex(sheetRows);
  if (headerIndex < 0) return [];

  const headers = sheetRows[headerIndex];
  const dataRows = sheetRows.slice(headerIndex + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      const hesapKodu = String(
        getMuavinCell(row, headers, ["HESAP KODU", "HESAPKODU", "HESAP"]) || ""
      ).trim();

      const hesapAdi = String(
        getMuavinCell(row, headers, ["HESAP ADI", "HESAP AD", "HESAPADI"]) || ""
      ).trim();

      const tarih =
        getMuavinCell(row, headers, [
          "FİŞ TARİHİ",
          "FIS TARIHI",
          "TARİH",
          "TARIH",
          "EVRAK TARİHİ",
        ]) || "";

      const aciklama = String(
        getMuavinCell(row, headers, [
          "DETAY AÇIKLAMA",
          "DETAY ACIKLAMA",
          "AÇIKLAMA",
          "ACIKLAMA",
          "FİŞ AÇIKLAMA",
        ]) || ""
      ).trim();

      const borc = parseMoneyTR(getMuavinCell(row, headers, ["BORÇ", "BORC"]));
      const alacak = parseMoneyTR(getMuavinCell(row, headers, ["ALACAK"]));

      const dovizBorc = parseMoneyTR(
        getMuavinCell(row, headers, ["DÖVİZ BORÇ", "DOVIZ BORC", "DVZ BORC", "D.BORÇ"])
      );
      const dovizAlacak = parseMoneyTR(
        getMuavinCell(row, headers, ["DÖVİZ ALACAK", "DOVIZ ALACAK", "DVZ ALACAK", "D.ALACAK"])
      );

      const dovizBakiyeRaw = getMuavinCell(row, headers, [
        "DÖVİZ BAKİYE",
        "DOVIZ BAKIYE",
        "DVZ BAKIYE",
        "D.BAKIYE",
        "DÖVİZ BAK.",
      ]);
      const tlBakiyeRaw = getMuavinCell(row, headers, [
        "TL BAKİYE",
        "TL BAKIYE",
        "TL BAK.",
        "BAKİYE",
        "BAKIYE",
      ]);

      const paraBirimi = normalizeCurrency(
        getMuavinCell(row, headers, ["PARA BİRİMİ", "PARA BIRIMI", "DÖVİZ", "DOVIZ", "PB"])
      );

      if (!hesapKodu) return null;

      return {
        id: `muavin-${index + 1}`,
        hesapKodu,
        hesapAdi,
        tarih,
        aciklama,
        borc,
        alacak,
        dovizBorc,
        dovizAlacak,
        dovizBakiye: dovizBakiyeRaw !== "" ? parseMoneyTR(dovizBakiyeRaw) : null,
        tlBakiye: tlBakiyeRaw !== "" ? parseMoneyTR(tlBakiyeRaw) : null,
        paraBirimi,
      };
    })
    .filter(Boolean);
}

export function parseTcmbKurListSheet(sheetRows = []) {
  if (!sheetRows.length) return [];

  const headerIndex = sheetRows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return text.includes("TARIH") && (text.includes("KUR") || text.includes("DOVIZ"));
  });

  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .map((row) => {
      const tarih =
        getMuavinCell(row, headers, ["TARİH", "TARIH", "KUR TARİHİ"]) || row[0] || "";
      const doviz = normalizeCurrency(
        getMuavinCell(row, headers, ["DÖVİZ", "DOVIZ", "PARA BİRİMİ", "PB"]) || row[1] || ""
      );
      const kur = parseMoneyTR(
        getMuavinCell(row, headers, [
          "KUR",
          "DÖVİZ ALIŞ",
          "DOVIZ ALIS",
          "ALIŞ",
          "ALIS",
          "FOREX BUYING",
        ]) || row[2]
      );

      if (!tarih || !doviz || !kur) return null;

      return {
        tarih: formatDateTR(tarih),
        doviz,
        kur,
      };
    })
    .filter(Boolean);
}

export function aggregateMuavinByAccount(rows = [], options = {}) {
  const { selectedGroups = [], currency = "USD", accountPlan = [] } = options;
  const wantedCurrency = normalizeCurrency(currency);
  const planMap = new Map(
    accountPlan.map((item) => [
      compactText(item.accountCode || item.hesapKodu).replace(/\./g, ""),
      item.accountName || item.hesapAdi || "",
    ])
  );

  const grouped = new Map();

  for (const row of rows) {
    if (!accountMatchesGroups(row.hesapKodu, selectedGroups)) continue;

    const rowCurrency = normalizeCurrency(row.paraBirimi);
    const hasDovizAmount =
      Math.abs(row.dovizBorc || 0) > 0 ||
      Math.abs(row.dovizAlacak || 0) > 0 ||
      (row.dovizBakiye !== null && row.dovizBakiye !== undefined);

    if (rowCurrency && rowCurrency !== "TL" && rowCurrency !== wantedCurrency) continue;
    if ((!rowCurrency || rowCurrency === "TL") && !hasDovizAmount) continue;

    const key = compactText(row.hesapKodu).replace(/\./g, "");
    if (!grouped.has(key)) {
      grouped.set(key, {
        hesapKodu: row.hesapKodu,
        hesapAdi: row.hesapAdi || planMap.get(key) || "",
        paraBirimi: wantedCurrency,
        dovizBorcToplam: 0,
        dovizAlacakToplam: 0,
        borcToplam: 0,
        alacakToplam: 0,
        sonDovizBakiye: null,
        sonTlBakiye: null,
        sonTarih: null,
      });
    }

    const bucket = grouped.get(key);

    if (row.hesapAdi && !bucket.hesapAdi) bucket.hesapAdi = row.hesapAdi;
    bucket.dovizBorcToplam += row.dovizBorc || 0;
    bucket.dovizAlacakToplam += row.dovizAlacak || 0;
    bucket.borcToplam += row.borc || 0;
    bucket.alacakToplam += row.alacak || 0;

    const rowDate = parseDateTR(row.tarih);
    const currentDate = bucket.sonTarih ? parseDateTR(bucket.sonTarih) : null;

    if (row.dovizBakiye !== null && row.dovizBakiye !== undefined) {
      if (!currentDate || (rowDate && rowDate >= currentDate)) {
        bucket.sonDovizBakiye = row.dovizBakiye;
        bucket.sonTlBakiye = row.tlBakiye;
        bucket.sonTarih = row.tarih;
      }
    } else if (rowDate && (!currentDate || rowDate >= currentDate)) {
      bucket.sonTarih = row.tarih;
    }
  }

  return [...grouped.values()].map((item) => {
    const dovizBakiye =
      item.sonDovizBakiye !== null && item.sonDovizBakiye !== undefined
        ? item.sonDovizBakiye
        : Number((item.dovizBorcToplam - item.dovizAlacakToplam).toFixed(4));

    const defterTl =
      item.sonTlBakiye !== null && item.sonTlBakiye !== undefined
        ? item.sonTlBakiye
        : Number((item.borcToplam - item.alacakToplam).toFixed(2));

    const hesapKey = compactText(item.hesapKodu).replace(/\./g, "");

    return {
      id: `account-${hesapKey}`,
      hesapKodu: item.hesapKodu,
      hesapAdi: item.hesapAdi || planMap.get(hesapKey) || "",
      paraBirimi: item.paraBirimi,
      dovizBakiye,
      defterTl,
      kur: "",
      degerlenmisTl: 0,
      kurFarki: 0,
      kurFarkiTip: null,
      kurFarkiHesap: "",
      fisTarihi: "",
      aciklama: "",
      tutar: 0,
      oneriSatirlari: [],
    };
  });
}

export async function fetchTcmbKur(degerlemeTarihi, doviz) {
  const parsed = parseDateTR(degerlemeTarihi);
  if (!parsed) {
    return { ok: false, error: "Geçersiz değerleme tarihi." };
  }

  const isoDate = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;

  try {
    const response = await fetch(
      `/api/tcmb?tarih=${encodeURIComponent(isoDate)}&doviz=${encodeURIComponent(doviz)}`
    );
    const data = await response.json();

    if (data.error || !data.kur) {
      return {
        ok: false,
        error: data.error || "Kur bulunamadı.",
      };
    }

    return {
      ok: true,
      kur: Number(data.kur),
      tcmbTarih: data.tarih ? formatDateTR(data.tarih) : "",
    };
  } catch {
    return { ok: false, error: "TCMB kur servisine ulaşılamadı." };
  }
}

export function lookupManualTcmbRate(tcmbList = [], degerlemeTarihi, doviz) {
  const wanted = normalizeCurrency(doviz);
  const targetDate = formatDateTR(degerlemeTarihi);

  const exact = tcmbList.find(
    (item) => item.doviz === wanted && item.tarih === targetDate
  );
  if (exact) return exact.kur;

  const sameCurrency = tcmbList
    .filter((item) => item.doviz === wanted)
    .sort((left, right) => {
      const leftDate = parseDateTR(left.tarih);
      const rightDate = parseDateTR(right.tarih);
      if (!leftDate || !rightDate) return 0;
      return rightDate.getTime() - leftDate.getTime();
    });

  return sameCurrency[0]?.kur || null;
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

export function buildKurDegerlemeFisAciklama(degerlemeTarihi, paraBirimi) {
  const tarih = formatDateTR(degerlemeTarihi);
  return `${tarih} ${normalizeCurrency(paraBirimi)} KUR DEĞERLEME FİŞİ`;
}

export function calculateKurDegerlemeRows(accounts = [], options = {}) {
  const {
    degerlemeTarihi = "",
    paraBirimi = "USD",
    kur = 0,
    kurFarkiGelirHesap = DEFAULT_KUR_FARKI_GELIR,
    kurFarkiGiderHesap = DEFAULT_KUR_FARKI_GIDER,
    belgeTuru = "DK",
  } = options;

  const fisAciklama = buildKurDegerlemeFisAciklama(degerlemeTarihi, paraBirimi);
  const rate = Number(kur);

  return accounts
    .map((account) => {
      const effectiveKur = account.kur !== "" && account.kur !== null && account.kur !== undefined
        ? Number(account.kur)
        : rate;

      const dovizBakiye = Number(account.dovizBakiye || 0);
      const defterTl = roundMoney(account.defterTl);
      const degerlenmisTl = roundMoney(dovizBakiye * effectiveKur);
      const kurFarkiSigned = roundMoney(degerlenmisTl - defterTl);
      const kurFarkiTip = resolveKurFarkiTip(account.hesapKodu, kurFarkiSigned);
      const tutarOverride =
        account.tutar !== "" && account.tutar !== null && account.tutar !== undefined
          ? roundMoney(Math.abs(Number(account.tutar)))
          : roundMoney(Math.abs(kurFarkiSigned));

      const kurFarkiHesap =
        account.kurFarkiHesap ||
        (kurFarkiTip === KUR_FARKI_TIP.GELIR ? kurFarkiGelirHesap : kurFarkiGiderHesap);

      const detayAciklama =
        account.aciklama ||
        `${formatDateTR(degerlemeTarihi)} ${normalizeCurrency(paraBirimi)} kur değerleme - ${account.hesapKodu}`;

      const fisTarihi = formatDateTR(account.fisTarihi || degerlemeTarihi);
      const oneriSatirlari = buildOneriSatirlari({
        hesapKodu: account.hesapKodu,
        kurFarkiTip,
        tutar: tutarOverride,
        kurFarkiHesap,
        detayAciklama,
      });

      return {
        ...account,
        hesapAdi: account.hesapAdi,
        dovizBakiye,
        defterTl,
        kur: effectiveKur,
        degerlenmisTl,
        kurFarki: kurFarkiSigned,
        kurFarkiTip,
        kurFarkiHesap,
        fisTarihi,
        aciklama: detayAciklama,
        fisAciklama,
        belgeTuru,
        tutar: tutarOverride,
        oneriSatirlari,
        skipped: !kurFarkiTip || tutarOverride < 0.01,
      };
    })
    .filter((row) => !row.skipped);
}

function buildOneriSatirlari({ hesapKodu, kurFarkiTip, tutar, kurFarkiHesap, detayAciklama }) {
  if (!kurFarkiTip || tutar < 0.01) return [];

  if (kurFarkiTip === KUR_FARKI_TIP.GELIR) {
    return [
      { hesapKodu, borc: tutar, alacak: 0, aciklama: detayAciklama },
      { hesapKodu: kurFarkiHesap, borc: 0, alacak: tutar, aciklama: detayAciklama },
    ];
  }

  return [
    { hesapKodu: kurFarkiHesap, borc: tutar, alacak: 0, aciklama: detayAciklama },
    { hesapKodu, borc: 0, alacak: tutar, aciklama: detayAciklama },
  ];
}

export function buildKurDegerlemeLucaRows(valuationRows = [], context = {}) {
  const {
    firmaId = "",
    paraBirimi = "USD",
    belgeTuru = "DK",
  } = context;

  const rows = [];
  let fisNo = 1;

  for (const account of valuationRows) {
    if (!account.oneriSatirlari?.length) continue;

    for (const satir of account.oneriSatirlari) {
      rows.push(
        finalizeStandardLucaRow({
          id: `${account.id}-${satir.hesapKodu}-${fisNo}-${satir.borc}-${satir.alacak}`,
          firmaId,
          kaynakTipi: "",
          kaynakAdi: "KUR_DEGERLEME",
          fisNo,
          fisTarihi: account.fisTarihi,
          fisAciklama: account.fisAciklama,
          belgeTuru: account.belgeTuru || belgeTuru,
          belgeNo: "",
          hesapKodu: satir.hesapKodu,
          detayAciklama: satir.aciklama || account.aciklama,
          borc: satir.borc,
          alacak: satir.alacak,
        })
      );
    }

    fisNo += 1;
  }

  return rows;
}

export function recalculateKurDegerlemeSummary(valuationRows = []) {
  const activeRows = valuationRows.filter((row) => !row.skipped);

  let toplamDovizBakiye = 0;
  let toplamKurFarkiGeliri = 0;
  let toplamKurFarkiGideri = 0;

  for (const row of activeRows) {
    toplamDovizBakiye += Number(row.dovizBakiye || 0);

    if (row.kurFarkiTip === KUR_FARKI_TIP.GELIR) {
      toplamKurFarkiGeliri += Number(row.tutar || 0);
    } else if (row.kurFarkiTip === KUR_FARKI_TIP.GIDER) {
      toplamKurFarkiGideri += Number(row.tutar || 0);
    }
  }

  return {
    degerlenenHesapSayisi: activeRows.length,
    toplamDovizBakiye: roundMoney(toplamDovizBakiye),
    toplamKurFarkiGeliri: roundMoney(toplamKurFarkiGeliri),
    toplamKurFarkiGideri: roundMoney(toplamKurFarkiGideri),
    netKurFarki: roundMoney(toplamKurFarkiGeliri - toplamKurFarkiGideri),
  };
}

export function runKurDegerlemePipeline({
  muavinRows = [],
  selectedGroups = [],
  currency = "USD",
  degerlemeTarihi = "",
  kur = 0,
  accountPlan = [],
  kurFarkiGelirHesap = DEFAULT_KUR_FARKI_GELIR,
  kurFarkiGiderHesap = DEFAULT_KUR_FARKI_GIDER,
  belgeTuru = "DK",
}) {
  const accounts = aggregateMuavinByAccount(muavinRows, {
    selectedGroups,
    currency,
    accountPlan,
  });

  const valuationRows = calculateKurDegerlemeRows(accounts, {
    degerlemeTarihi,
    paraBirimi: currency,
    kur,
    kurFarkiGelirHesap,
    kurFarkiGiderHesap,
    belgeTuru,
  });

  return {
    accounts,
    valuationRows,
    summary: recalculateKurDegerlemeSummary(valuationRows),
  };
}
