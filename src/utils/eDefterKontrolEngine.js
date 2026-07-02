import {
  BELGE_TARIH_FARK_GUN,
  BORC_ALACAK_TOLERANCE,
  E_DEFTER_KAYNAK,
  E_DEFTER_KONTROL_DURUM,
  E_DEFTER_KONTROL_GRUP,
  KASA_BAKIYE_ESIK,
  NEAR_DATE_DAYS,
  riskBandFromScore,
} from "@/src/config/eDefterKontrolDefaults";
import { formatDateTR, parseDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { normalizeParserText } from "@/src/utils/textNormalize";

function compactText(value) {
  return normalizeParserText(value).replace(/\s+/g, "");
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function findHeaderIndex(rows, matchers) {
  return rows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return matchers.every((matcher) => matcher(text));
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

function parseLedgerRow(row, headers, index, kaynak) {
  const tarih =
    getSheetCell(row, headers, ["TARİH", "TARIH", "FİŞ TARİHİ", "FIS TARIHI", "KAYIT TARIHI"]) ||
    "";

  const fisNo = String(
    getSheetCell(row, headers, ["FİŞ NO", "FIS NO", "FISNO", "YEVMIYE FIS NO"]) || ""
  ).trim();

  const yevmiyeNo = String(
    getSheetCell(row, headers, ["YEVMİYE NO", "YEVMIYE NO", "YEVMIYENO", "YEVMIYE"]) || ""
  ).trim();

  const hesapKodu = String(
    getSheetCell(row, headers, ["HESAP KODU", "HESAP KOD", "HESAP NO", "KOD"]) || ""
  ).trim();

  const hesapAdi = String(
    getSheetCell(row, headers, ["HESAP ADI", "HESAP AD", "HESAP ADI/UNVAN", "HESAP"]) || ""
  ).trim();

  const aciklama = String(
    getSheetCell(row, headers, ["AÇIKLAMA", "ACIKLAMA", "DETAY", "NOT"]) || ""
  ).trim();

  const belgeTuru = String(
    getSheetCell(row, headers, ["BELGE TÜRÜ", "BELGE TURU", "EVRAK TURU", "EVRAK TİPİ"]) || ""
  ).trim();

  const belgeNo = String(
    getSheetCell(row, headers, ["BELGE NO", "EVRAK NO", "FATURA NO", "FIS NO"]) || ""
  ).trim();

  const belgeTarihi =
    getSheetCell(row, headers, ["BELGE TARİHİ", "BELGE TARIHI", "EVRAK TARIHI"]) || "";

  const borc = parseMoneyTR(getSheetCell(row, headers, ["BORÇ", "BORC"]));
  const alacak = parseMoneyTR(getSheetCell(row, headers, ["ALACAK"]));

  if (!tarih && !fisNo && !hesapKodu && !borc && !alacak) return null;

  return {
    id: `${kaynak}-${index + 1}`,
    kaynak,
    tarih: formatDateTR(tarih),
    fisNo,
    yevmiyeNo,
    hesapKodu,
    hesapAdi,
    aciklama,
    belgeTuru,
    belgeNo,
    belgeTarihi: belgeTarihi ? formatDateTR(belgeTarihi) : "",
    borc,
    alacak,
    cariUnvan: aciklama,
    tutar: roundMoney(Math.max(borc, alacak)),
    kontrolDurumu: "",
    not: "",
    duzeltildiMi: false,
    disaridaBirak: false,
    manuallyEdited: false,
  };
}

function parseLedgerSheet(sheetRows = [], kaynak = E_DEFTER_KAYNAK.MUAVIN) {
  if (!sheetRows.length) return [];

  const headerIndex = findHeaderIndex(sheetRows, [
    (text) => text.includes("HESAP") || text.includes("BORC") || text.includes("BORÇ"),
    (text) => text.includes("TARIH") || text.includes("TARİH") || text.includes("FIS"),
  ]);

  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => parseLedgerRow(row, headers, index, kaynak))
    .filter(Boolean);
}

export function parseMuavinSheet(sheetRows = []) {
  return parseLedgerSheet(sheetRows, E_DEFTER_KAYNAK.MUAVIN);
}

export function parseYevmiyeSheet(sheetRows = []) {
  return parseLedgerSheet(sheetRows, E_DEFTER_KAYNAK.YEVMIYE);
}

export function parseMizanSheet(sheetRows = []) {
  if (!sheetRows.length) return [];

  const headerIndex = findHeaderIndex(sheetRows, [
    (text) => text.includes("HESAP"),
    (text) => text.includes("BORC") || text.includes("BORÇ") || text.includes("BAKIYE"),
  ]);

  const headers = headerIndex >= 0 ? sheetRows[headerIndex] : sheetRows[0];
  const dataRows = sheetRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .filter((row) => row && row.some((cell) => String(cell || "").trim()))
    .map((row, index) => {
      const hesapKodu = String(
        getSheetCell(row, headers, ["HESAP KODU", "HESAP KOD", "KOD"]) || ""
      ).trim();
      const hesapAdi = String(
        getSheetCell(row, headers, ["HESAP ADI", "HESAP AD", "HESAP"]) || ""
      ).trim();
      const borc = parseMoneyTR(
        getSheetCell(row, headers, ["BORÇ", "BORC", "BORÇ TOPLAMI", "BORC TOPLAMI"])
      );
      const alacak = parseMoneyTR(
        getSheetCell(row, headers, ["ALACAK", "ALACAK TOPLAMI"])
      );
      const bakiye = parseMoneyTR(
        getSheetCell(row, headers, ["BAKİYE", "BAKIYE", "NET BAKIYE"])
      );

      if (!hesapKodu && !borc && !alacak && !bakiye) return null;

      return {
        id: `mizan-${index + 1}`,
        kaynak: E_DEFTER_KAYNAK.MIZAN,
        tarih: "",
        fisNo: "",
        yevmiyeNo: "",
        hesapKodu,
        hesapAdi,
        aciklama: hesapAdi,
        belgeTuru: "",
        belgeNo: "",
        belgeTarihi: "",
        borc,
        alacak,
        cariUnvan: hesapAdi,
        tutar: roundMoney(Math.max(borc, alacak, Math.abs(bakiye))),
        mizanBakiye: bakiye,
        kontrolDurumu: "",
        not: "",
        duzeltildiMi: false,
        disaridaBirak: false,
        manuallyEdited: false,
      };
    })
    .filter(Boolean);
}

export function parseEDefterListeSheet(sheetRows = []) {
  return parseLedgerSheet(sheetRows, E_DEFTER_KAYNAK.EDEFTER_LISTE);
}

function daysBetween(left, right) {
  const leftDate = parseDateTR(left);
  const rightDate = parseDateTR(right);
  if (!leftDate || !rightDate) return 999;
  return Math.abs(Math.round((leftDate.getTime() - rightDate.getTime()) / 86400000));
}

function extractNumeric(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : NaN;
}

function accountPrefix(hesapKodu) {
  return String(hesapKodu || "").replace(/\./g, "").slice(0, 3);
}

function buildAccountBalanceMap(rows = []) {
  const map = new Map();

  for (const row of rows) {
    if (!row.hesapKodu || row.kaynak === E_DEFTER_KAYNAK.MIZAN) continue;
    const key = compactText(row.hesapKodu);
    const current = map.get(key) || { borc: 0, alacak: 0, hesapKodu: row.hesapKodu };
    current.borc += roundMoney(row.borc);
    current.alacak += roundMoney(row.alacak);
    map.set(key, current);
  }

  const result = new Map();
  for (const [key, item] of map.entries()) {
    result.set(key, {
      ...item,
      net: roundMoney(item.borc - item.alacak),
    });
  }

  return result;
}

function buildFisBalanceMap(rows = []) {
  const map = new Map();

  for (const row of rows) {
    if (!row.fisNo || row.kaynak === E_DEFTER_KAYNAK.MIZAN) continue;
    const key = compactText(row.fisNo);
    const current = map.get(key) || { borc: 0, alacak: 0, fisNo: row.fisNo, tarih: row.tarih };
    current.borc += roundMoney(row.borc);
    current.alacak += roundMoney(row.alacak);
    if (row.tarih) current.tarih = row.tarih;
    map.set(key, current);
  }

  const result = new Map();
  for (const [key, item] of map.entries()) {
    result.set(key, {
      ...item,
      fark: roundMoney(item.borc - item.alacak),
    });
  }

  return result;
}

function analyzeAccountBalanceIssues(hesapKodu, net) {
  const issues = [];
  let riskScore = 0;
  const prefix = accountPrefix(hesapKodu);

  if (prefix.startsWith("100") && Math.abs(net) > KASA_BAKIYE_ESIK) {
    issues.push(`Kasa hesabında olağan dışı yüksek bakiye: ${net.toLocaleString("tr-TR")} TL`);
    riskScore += 35;
  }

  if (prefix.startsWith("120") && net < -BORC_ALACAK_TOLERANCE) {
    issues.push("120 alıcı hesabında ters bakiye (alacak yönünde).");
    riskScore += 40;
  }

  if (prefix.startsWith("320") && net > BORC_ALACAK_TOLERANCE) {
    issues.push("320 satıcı hesabında ters bakiye (borç yönünde).");
    riskScore += 40;
  }

  if (prefix.startsWith("191") && net < -BORC_ALACAK_TOLERANCE) {
    issues.push("191 indirilecek KDV hesabında ters bakiye.");
    riskScore += 45;
  }

  if (prefix.startsWith("391") && net > BORC_ALACAK_TOLERANCE) {
    issues.push("391 hesaplanan KDV hesabında ters bakiye.");
    riskScore += 45;
  }

  if (
    !prefix.startsWith("120") &&
    !prefix.startsWith("320") &&
    !prefix.startsWith("191") &&
    !prefix.startsWith("391") &&
    !prefix.startsWith("100") &&
    Math.abs(net) > 0.01
  ) {
    const hesap = String(hesapKodu || "");
    if (hesap.startsWith("1") && net < -BORC_ALACAK_TOLERANCE) {
      issues.push("Aktif hesapta ters bakiye riski.");
      riskScore += 20;
    }
    if (hesap.startsWith("3") && net > BORC_ALACAK_TOLERANCE) {
      issues.push("Pasif hesapta ters bakiye riski.");
      riskScore += 20;
    }
  }

  return { issues, riskScore };
}

function buildGlobalContext(rows = []) {
  const ledgerRows = rows.filter((row) => row.kaynak !== E_DEFTER_KAYNAK.MIZAN);
  const accountBalances = buildAccountBalanceMap(ledgerRows);
  const fisBalances = buildFisBalanceMap(ledgerRows);

  const problematicAccounts = new Map();
  for (const [key, balance] of accountBalances.entries()) {
    const analysis = analyzeAccountBalanceIssues(balance.hesapKodu, balance.net);
    if (analysis.issues.length) {
      problematicAccounts.set(key, analysis);
    }
  }

  const unbalancedFis = new Set();
  for (const [key, balance] of fisBalances.entries()) {
    if (Math.abs(balance.fark) > BORC_ALACAK_TOLERANCE) {
      unbalancedFis.add(key);
    }
  }

  const fisDateMap = new Map();
  for (const row of ledgerRows) {
    if (!row.fisNo || !row.tarih) continue;
    const key = compactText(row.fisNo);
    if (!fisDateMap.has(key)) {
      fisDateMap.set(key, row.tarih);
    }
  }

  const fisEntries = [...fisDateMap.entries()]
    .map(([key, tarih]) => ({
      key,
      fisNo: key,
      numeric: extractNumeric(key),
      tarih,
      dateValue: parseDateTR(tarih)?.getTime() || 0,
    }))
    .filter((item) => !Number.isNaN(item.numeric))
    .sort((a, b) => a.numeric - b.numeric);

  const fisNoGaps = [];
  for (let index = 1; index < fisEntries.length; index += 1) {
    const prev = fisEntries[index - 1].numeric;
    const current = fisEntries[index].numeric;
    if (current - prev > 1) {
      fisNoGaps.push({ from: prev, to: current });
    }
  }

  const outOfOrderFis = new Set();
  for (let index = 1; index < fisEntries.length; index += 1) {
    if (fisEntries[index].dateValue < fisEntries[index - 1].dateValue) {
      outOfOrderFis.add(fisEntries[index].key);
      outOfOrderFis.add(fisEntries[index - 1].key);
    }
  }

  const allText = ledgerRows
    .map((row) => `${row.aciklama} ${row.hesapAdi} ${row.belgeTuru}`.toLocaleLowerCase("tr-TR"))
    .join(" ");

  return {
    accountBalances,
    problematicAccounts,
    unbalancedFis,
    fisNoGaps,
    outOfOrderFis,
    hasKapanisFisi: /kapan[ıi]s|7\/a|7a|gelir tablosu kapan/.test(allText),
    hasAmortisman: /amortisman/.test(allText),
    hasKurDegerleme: /kur de[ğg]erleme|kur fark[ıi]|de[ğg]erleme fark[ıi]/.test(allText),
  };
}

function buildIssues(row, allRows = [], context = {}) {
  const issues = [];
  let riskScore = 0;
  const fisKey = compactText(row.fisNo);
  const hesapKey = compactText(row.hesapKodu);

  if (!row.hesapKodu) {
    issues.push("Hesap kodu boş.");
    riskScore += 20;
  }

  if (!row.aciklama) {
    issues.push("Açıklama boş.");
    riskScore += 10;
  }

  if (!row.belgeTuru && row.kaynak !== E_DEFTER_KAYNAK.MIZAN) {
    issues.push("Belge türü boş.");
    riskScore += 10;
  }

  if (!row.yevmiyeNo && row.kaynak !== E_DEFTER_KAYNAK.MIZAN) {
    issues.push("Yevmiye no eksik.");
    riskScore += 15;
  }

  if (context.unbalancedFis?.has(fisKey) && row.fisNo) {
    issues.push("Fiş borç/alacak dengesi bozuk.");
    riskScore += 45;
  }

  if (context.outOfOrderFis?.has(fisKey) && row.fisNo) {
    issues.push("Tarih sırası bozuk fiş.");
    riskScore += 20;
  }

  if (row.belgeTarihi && row.tarih && daysBetween(row.belgeTarihi, row.tarih) > BELGE_TARIH_FARK_GUN) {
    issues.push("Belge tarihi ile fiş tarihi arasında anlamlı fark var.");
    riskScore += 15;
  }

  const fisDuplicates = allRows.filter(
    (item) =>
      item.id !== row.id &&
      item.fisNo &&
      compactText(item.fisNo) === fisKey &&
      item.kaynak !== E_DEFTER_KAYNAK.MIZAN
  );

  if (fisDuplicates.length > 5 && row.fisNo) {
    issues.push("Fiş no yoğun tekrar / mükerrer riski.");
    riskScore += 15;
  }

  const belgeDuplicates = allRows.filter(
    (item) =>
      item.id !== row.id &&
      item.belgeNo &&
      compactText(item.belgeNo) === compactText(row.belgeNo)
  );

  if (belgeDuplicates.length > 0 && row.belgeNo) {
    issues.push("Belge no mükerrer.");
    riskScore += 30;
  }

  const nearDuplicates = allRows.filter((item) => {
    if (item.id === row.id) return false;
    if (roundMoney(item.tutar) !== roundMoney(row.tutar) || !row.tutar) return false;
    if (compactText(item.cariUnvan) !== compactText(row.cariUnvan) || !row.cariUnvan) {
      return false;
    }
    return daysBetween(item.tarih, row.tarih) <= NEAR_DATE_DAYS;
  });

  if (nearDuplicates.length) {
    issues.push("Aynı cari + tutar + yakın tarih mükerrer riski.");
    riskScore += 25;
  }

  const accountIssue = context.problematicAccounts?.get(hesapKey);
  if (accountIssue?.issues?.length) {
    issues.push(...accountIssue.issues);
    riskScore += accountIssue.riskScore;
  }

  return {
    issues,
    riskScore: Math.min(100, riskScore),
  };
}

function resolvePrimaryGroup(issues = [], row = {}) {
  const text = issues.join(" ").toLocaleLowerCase("tr-TR");

  if (!row.hesapKodu || !row.aciklama || (!row.belgeTuru && row.kaynak !== E_DEFTER_KAYNAK.MIZAN)) {
    return E_DEFTER_KONTROL_GRUP.EKSIK_BILGI;
  }

  if (text.includes("kdv")) return E_DEFTER_KONTROL_GRUP.KDV_KONTROL;
  if (text.includes("ters bakiye") || text.includes("kasa hesab")) {
    return E_DEFTER_KONTROL_GRUP.TERS_BAKIYE;
  }
  if (text.includes("mükerrer") || text.includes("mukerrer")) {
    return E_DEFTER_KONTROL_GRUP.MUKERRER;
  }
  if (
    text.includes("dengesi bozuk") ||
    text.includes("kritik") ||
    text.includes("fiş no atlama") ||
    text.includes("tarih sırası")
  ) {
    return E_DEFTER_KONTROL_GRUP.KRITIK;
  }
  if (text.includes("boş") || text.includes("eksik")) {
    return E_DEFTER_KONTROL_GRUP.EKSIK_BILGI;
  }
  if (text.includes("dönem sonu") || text.includes("kapan") || text.includes("amortisman")) {
    return E_DEFTER_KONTROL_GRUP.DONEM_SONU;
  }

  return E_DEFTER_KONTROL_GRUP.HATASIZ;
}

function resolveDurum(grup, row = {}) {
  if (row.kontrolDurumu) return row.kontrolDurumu;

  const map = {
    [E_DEFTER_KONTROL_GRUP.HATASIZ]: E_DEFTER_KONTROL_DURUM.HATASIZ,
    [E_DEFTER_KONTROL_GRUP.KRITIK]: E_DEFTER_KONTROL_DURUM.KRITIK,
    [E_DEFTER_KONTROL_GRUP.MUKERRER]: E_DEFTER_KONTROL_DURUM.MUKERRER,
    [E_DEFTER_KONTROL_GRUP.TERS_BAKIYE]: E_DEFTER_KONTROL_DURUM.TERS_BAKIYE,
    [E_DEFTER_KONTROL_GRUP.EKSIK_BILGI]: E_DEFTER_KONTROL_DURUM.EKSIK_BILGI,
    [E_DEFTER_KONTROL_GRUP.DONEM_SONU]: E_DEFTER_KONTROL_DURUM.DONEM_SONU,
    [E_DEFTER_KONTROL_GRUP.KDV_KONTROL]: E_DEFTER_KONTROL_DURUM.KDV_KONTROL,
  };

  return map[grup] || E_DEFTER_KONTROL_DURUM.HATASIZ;
}

function buildPeriodEndWarnings(context = {}) {
  const warnings = [];

  if (!context.hasKapanisFisi) {
    warnings.push({
      id: "donem-sonu-kapanis",
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: "",
      fisNo: "",
      yevmiyeNo: "",
      hesapKodu: "",
      hesapAdi: "Dönem Sonu Kontrol",
      aciklama: "Kapanış fişi tespit edilemedi.",
      belgeTuru: "Uyarı",
      belgeNo: "",
      belgeTarihi: "",
      borc: 0,
      alacak: 0,
      cariUnvan: "",
      tutar: 0,
      kontrolDurumu: "",
      not: "",
      duzeltildiMi: false,
      disaridaBirak: false,
      manuallyEdited: false,
      issues: ["Kapanış fişi kaydı bulunamadı."],
      riskScore: 55,
      riskBand: riskBandFromScore(55),
      grup: E_DEFTER_KONTROL_GRUP.DONEM_SONU,
      durum: E_DEFTER_KONTROL_DURUM.DONEM_SONU,
    });
  }

  if (!context.hasAmortisman) {
    warnings.push({
      id: "donem-sonu-amortisman",
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: "",
      fisNo: "",
      yevmiyeNo: "",
      hesapKodu: "",
      hesapAdi: "Dönem Sonu Kontrol",
      aciklama: "Amortisman kaydı tespit edilemedi.",
      belgeTuru: "Uyarı",
      belgeNo: "",
      belgeTarihi: "",
      borc: 0,
      alacak: 0,
      cariUnvan: "",
      tutar: 0,
      kontrolDurumu: "",
      not: "",
      duzeltildiMi: false,
      disaridaBirak: false,
      manuallyEdited: false,
      issues: ["Amortisman gider kaydı bulunamadı."],
      riskScore: 40,
      riskBand: riskBandFromScore(40),
      grup: E_DEFTER_KONTROL_GRUP.DONEM_SONU,
      durum: E_DEFTER_KONTROL_DURUM.DONEM_SONU,
    });
  }

  if (!context.hasKurDegerleme) {
    warnings.push({
      id: "donem-sonu-kur",
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: "",
      fisNo: "",
      yevmiyeNo: "",
      hesapKodu: "",
      hesapAdi: "Dönem Sonu Kontrol",
      aciklama: "Kur değerleme kaydı tespit edilemedi.",
      belgeTuru: "Uyarı",
      belgeNo: "",
      belgeTarihi: "",
      borc: 0,
      alacak: 0,
      cariUnvan: "",
      tutar: 0,
      kontrolDurumu: "",
      not: "",
      duzeltildiMi: false,
      disaridaBirak: false,
      manuallyEdited: false,
      issues: ["Kur değerleme / kur farkı kaydı bulunamadı."],
      riskScore: 35,
      riskBand: riskBandFromScore(35),
      grup: E_DEFTER_KONTROL_GRUP.DONEM_SONU,
      durum: E_DEFTER_KONTROL_DURUM.DONEM_SONU,
    });
  }

  for (const gap of context.fisNoGaps || []) {
    warnings.push({
      id: `fis-gap-${gap.from}-${gap.to}`,
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: "",
      fisNo: `${gap.from + 1}-${gap.to - 1}`,
      yevmiyeNo: "",
      hesapKodu: "",
      hesapAdi: "Fiş No Kontrol",
      aciklama: `Fiş no atlaması: ${gap.from} ile ${gap.to} arasında eksik numara.`,
      belgeTuru: "Uyarı",
      belgeNo: "",
      belgeTarihi: "",
      borc: 0,
      alacak: 0,
      cariUnvan: "",
      tutar: 0,
      kontrolDurumu: "",
      not: "",
      duzeltildiMi: false,
      disaridaBirak: false,
      manuallyEdited: false,
      issues: [`Fiş no atlaması (${gap.from} → ${gap.to}).`],
      riskScore: 50,
      riskBand: riskBandFromScore(50),
      grup: E_DEFTER_KONTROL_GRUP.KRITIK,
      durum: E_DEFTER_KONTROL_DURUM.KRITIK,
    });
  }

  return warnings;
}

export function analyzeEDefterRow(row, allRows = [], context = {}) {
  if (row.disaridaBirak) {
    return {
      ...row,
      issues: ["Kontrol dışı bırakıldı."],
      riskScore: 0,
      riskBand: riskBandFromScore(0),
      grup: E_DEFTER_KONTROL_GRUP.HATASIZ,
      durum: row.kontrolDurumu || "Kontrol dışı",
    };
  }

  if (row.grup && row.id?.startsWith("donem-sonu")) {
    return row;
  }

  if (row.grup && row.id?.startsWith("fis-gap")) {
    return row;
  }

  const analysis = buildIssues(row, allRows, context);
  const grup = resolvePrimaryGroup(analysis.issues, row);
  const durum = resolveDurum(grup, row);

  return {
    ...row,
    borc: roundMoney(row.borc),
    alacak: roundMoney(row.alacak),
    tutar: roundMoney(row.tutar || Math.max(row.borc, row.alacak)),
    issues: analysis.issues,
    riskScore: grup === E_DEFTER_KONTROL_GRUP.HATASIZ ? 0 : analysis.riskScore,
    riskBand: riskBandFromScore(grup === E_DEFTER_KONTROL_GRUP.HATASIZ ? 0 : analysis.riskScore),
    grup,
    durum,
  };
}

export function analyzeEDefterRows(rows = []) {
  const context = buildGlobalContext(rows);
  const analyzed = rows.map((row) => analyzeEDefterRow(row, rows, context));
  const warnings = buildPeriodEndWarnings(context);
  return [...analyzed, ...warnings];
}

export function recalculateEDefterSummary(rows = []) {
  const activeRows = rows.filter((row) => !row.disaridaBirak);
  const fisSet = new Set(
    activeRows.map((row) => compactText(row.fisNo)).filter(Boolean)
  );

  let kritikHata = 0;
  let yuksekRisk = 0;
  let mukerrerRisk = 0;
  let tersBakiye = 0;
  let eksikBilgi = 0;

  for (const row of activeRows) {
    if (row.grup === E_DEFTER_KONTROL_GRUP.KRITIK) kritikHata += 1;
    if (row.riskScore >= 70) yuksekRisk += 1;
    if (row.grup === E_DEFTER_KONTROL_GRUP.MUKERRER) mukerrerRisk += 1;
    if (row.grup === E_DEFTER_KONTROL_GRUP.TERS_BAKIYE) tersBakiye += 1;
    if (row.grup === E_DEFTER_KONTROL_GRUP.EKSIK_BILGI) eksikBilgi += 1;
  }

  return {
    toplamFis: fisSet.size,
    toplamSatir: activeRows.length,
    kritikHata,
    yuksekRisk,
    mukerrerRisk,
    tersBakiye,
    eksikBilgi,
  };
}

export function filterEDefterRows(rows = [], { grup = "", search = "" } = {}) {
  let result = rows;

  if (grup) {
    result = result.filter((row) => row.grup === grup);
  }

  const query = search.trim().toLocaleLowerCase("tr-TR");
  if (query) {
    result = result.filter((row) =>
      [
        row.fisNo,
        row.yevmiyeNo,
        row.hesapKodu,
        row.hesapAdi,
        row.aciklama,
        row.belgeTuru,
        row.belgeNo,
        row.durum,
        row.grup,
        row.not,
        ...(row.issues || []),
      ]
        .join(" ")
        .toLocaleLowerCase("tr-TR")
        .includes(query)
    );
  }

  return result;
}

export function groupEDefterCounts(rows = []) {
  const counts = Object.fromEntries(
    Object.values(E_DEFTER_KONTROL_GRUP).map((grup) => [grup, 0])
  );

  for (const row of rows.filter((item) => !item.disaridaBirak)) {
    counts[row.grup] = (counts[row.grup] || 0) + 1;
  }

  return Object.entries(counts).map(([grup, count]) => ({ grup, count }));
}

export function runEDefterKontrolPipeline({
  muavinRows = [],
  yevmiyeRows = [],
  mizanRows = [],
  edefterListeRows = [],
}) {
  const mergedRows = [...muavinRows, ...yevmiyeRows, ...edefterListeRows, ...mizanRows];
  const analyzedRows = analyzeEDefterRows(mergedRows);
  const summary = recalculateEDefterSummary(analyzedRows);
  const groupCounts = groupEDefterCounts(analyzedRows);

  return {
    rows: analyzedRows,
    summary,
    groupCounts,
    integrationMeta: {
      source: "e-defter-kontrol-v1",
      fisNolar: analyzedRows.map((row) => row.fisNo).filter(Boolean),
      hesapKodlari: analyzedRows.map((row) => row.hesapKodu).filter(Boolean),
      belgeNolar: analyzedRows.map((row) => row.belgeNo).filter(Boolean),
      kdvMatrahKontrolReady: true,
      kurDegerlemeReady: true,
      lucaAktarimKontrolReady: true,
      muavinMutabakatReady: true,
    },
  };
}

export function recalculateEDefterRows(rows = []) {
  const ledgerRows = rows.filter(
    (row) => !row.id?.startsWith("donem-sonu") && !row.id?.startsWith("fis-gap")
  );
  const context = buildGlobalContext(ledgerRows);
  const analyzed = ledgerRows.map((row) => analyzeEDefterRow(row, ledgerRows, context));
  const warnings = buildPeriodEndWarnings(context);
  const combined = [...analyzed, ...warnings];

  return {
    rows: combined,
    summary: recalculateEDefterSummary(combined),
    groupCounts: groupEDefterCounts(combined),
  };
}
