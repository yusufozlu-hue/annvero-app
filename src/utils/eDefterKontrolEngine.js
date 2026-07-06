import {
  BELGE_TARIH_FARK_GUN,
  BORC_ALACAK_TOLERANCE,
  E_DEFTER_FINDING_STATUS,
  E_DEFTER_HATA_TURU,
  E_DEFTER_KAYNAK,
  E_DEFTER_KONTROL_DURUM,
  E_DEFTER_KONTROL_GRUP,
  E_DEFTER_KONTROL_STATUS,
  E_DEFTER_RECORDS_STORAGE_KEY,
  E_DEFTER_RISK_LEVEL,
  E_DEFTER_TURU,
  KASA_BAKIYE_ESIK,
  NEAR_DATE_DAYS,
  riskBandFromScore,
  riskLevelFromScore,
} from "@/src/config/eDefterKontrolDefaults";
import { loadDeclarationAccrualRecords } from "@/src/utils/beyannameTahakkukEngine";
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

  if (prefix.startsWith("360") && Math.abs(net) > KASA_BAKIYE_ESIK) {
    issues.push("360 ödenecek vergi hesabında olağandışı bakiye.");
    riskScore += 35;
  }

  if (prefix.startsWith("361") && Math.abs(net) > KASA_BAKIYE_ESIK) {
    issues.push("361 SGK/borç hesabında olağandışı bakiye.");
    riskScore += 35;
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

  if (row.tutar > 0 && row.tutar % 1000 === 0 && row.tutar >= 10000) {
    issues.push("Şüpheli yuvarlama kaydı.");
    riskScore += 10;
  }

  const duplicateDescriptions = allRows.filter(
    (item) =>
      item.id !== row.id &&
      compactText(item.aciklama) === compactText(row.aciklama) &&
      row.aciklama
  );
  if (duplicateDescriptions.length > 2) {
    issues.push("Mükerrer açıklama tekrarı.");
    riskScore += 15;
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
    riskLevel: riskLevelFromScore(grup === E_DEFTER_KONTROL_GRUP.HATASIZ ? 0 : analysis.riskScore),
    hataTuru: row.hataTuru || E_DEFTER_HATA_TURU.MUHASEBESEL,
    onerilenKontrol: row.onerilenKontrol || (analysis.issues[0] ? `${analysis.issues[0]} için belge ve fiş kontrolü yapın.` : ""),
    cozumDurumu: row.cozumDurumu || E_DEFTER_FINDING_STATUS.YENI,
    smartExplanation: row.smartExplanation || buildSmartEDefterExplanation(row, analysis.issues),
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
  let teknikHata = 0;
  let vergiselRisk = 0;
  let uyariSayisi = 0;

  for (const row of activeRows) {
    if (row.grup === E_DEFTER_KONTROL_GRUP.KRITIK || row.riskLevel === E_DEFTER_RISK_LEVEL.KRITIK) {
      kritikHata += 1;
    }
    if (row.riskScore >= 70 || row.riskLevel === E_DEFTER_RISK_LEVEL.YUKSEK) yuksekRisk += 1;
    if (row.grup === E_DEFTER_KONTROL_GRUP.MUKERRER) mukerrerRisk += 1;
    if (row.grup === E_DEFTER_KONTROL_GRUP.TERS_BAKIYE) tersBakiye += 1;
    if (row.grup === E_DEFTER_KONTROL_GRUP.EKSIK_BILGI) eksikBilgi += 1;
    if (row.grup === E_DEFTER_KONTROL_GRUP.TEKNIK || row.hataTuru === E_DEFTER_HATA_TURU.TEKNIK) {
      teknikHata += 1;
    }
    if (row.grup === E_DEFTER_KONTROL_GRUP.VERGISEL || row.hataTuru === E_DEFTER_HATA_TURU.VERGISEL) {
      vergiselRisk += 1;
    }
    if (row.riskLevel === E_DEFTER_RISK_LEVEL.ORTA || row.riskLevel === E_DEFTER_RISK_LEVEL.DUSUK) {
      uyariSayisi += 1;
    }
  }

  return {
    toplamFis: fisSet.size,
    toplamSatir: activeRows.length,
    kritikHata,
    yuksekRisk,
    mukerrerRisk,
    tersBakiye,
    eksikBilgi,
    yuklenenDefterSayisi: 0,
    teknikHata,
    vergiselRisk,
    uyariSayisi,
  };
}

export function filterEDefterRows(
  rows = [],
  { grup = "", search = "", riskLevel = "", hataTuru = "", cozumDurumu = "" } = {}
) {
  let result = rows;

  if (grup) {
    result = result.filter((row) => row.grup === grup);
  }

  if (riskLevel && riskLevel !== "Tümü") {
    result = result.filter((row) => row.riskLevel === riskLevel);
  }

  if (hataTuru && hataTuru !== "Tümü") {
    result = result.filter((row) => row.hataTuru === hataTuru);
  }

  if (cozumDurumu === "Çözüldü") {
    result = result.filter((row) => row.cozumDurumu === E_DEFTER_FINDING_STATUS.COZULDU);
  }
  if (cozumDurumu === "Çözülmedi") {
    result = result.filter(
      (row) => row.cozumDurumu !== E_DEFTER_FINDING_STATUS.COZULDU && row.grup !== E_DEFTER_KONTROL_GRUP.HATASIZ
    );
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
  xmlRows = [],
  technicalFindings = [],
  companyId = "",
  period = "",
  declarationRecords = [],
}) {
  const mergedRows = [
    ...muavinRows,
    ...yevmiyeRows,
    ...edefterListeRows,
    ...mizanRows,
    ...xmlRows,
  ];
  const analyzedRows = analyzeEDefterRows(mergedRows);
  const technicalRows = buildTechnicalFindingRows(technicalFindings, { companyId, period });
  const vergiselRows = buildVergiselFindingRows({
    rows: mergedRows,
    declarationRecords: declarationRecords.length
      ? declarationRecords
      : typeof window !== "undefined"
        ? loadDeclarationAccrualRecords().filter((record) => !companyId || record.companyId === companyId)
        : [],
    companyId,
    period,
  });
  const combinedRows = [...analyzedRows, ...technicalRows, ...vergiselRows];
  const summary = recalculateEDefterSummary(combinedRows);
  summary.yuklenenDefterSayisi =
    Number(Boolean(muavinRows.length)) +
    Number(Boolean(yevmiyeRows.length)) +
    Number(Boolean(mizanRows.length)) +
    Number(Boolean(xmlRows.length));
  const groupCounts = groupEDefterCounts(combinedRows);

  return {
    rows: combinedRows,
    summary,
    groupCounts,
    integrationMeta: {
      source: "e-defter-kontrol-v2",
      fisNolar: combinedRows.map((row) => row.fisNo).filter(Boolean),
      hesapKodlari: combinedRows.map((row) => row.hesapKodu).filter(Boolean),
      belgeNolar: combinedRows.map((row) => row.belgeNo).filter(Boolean),
      kdvMatrahKontrolReady: true,
      kurDegerlemeReady: true,
      lucaAktarimKontrolReady: true,
      muavinMutabakatReady: true,
    },
  };
}

export function recalculateEDefterRows(rows = []) {
  const preservedRows = rows.filter(
    (row) => row.id?.startsWith("teknik-") || row.id?.startsWith("vergisel-")
  );
  const ledgerRows = rows.filter(
    (row) =>
      !row.id?.startsWith("donem-sonu") &&
      !row.id?.startsWith("fis-gap") &&
      !row.id?.startsWith("teknik-") &&
      !row.id?.startsWith("vergisel-")
  );
  const context = buildGlobalContext(ledgerRows);
  const analyzed = ledgerRows.map((row) => analyzeEDefterRow(row, ledgerRows, context));
  const warnings = buildPeriodEndWarnings(context);
  const combined = [...analyzed, ...warnings, ...preservedRows];

  return {
    rows: combined,
    summary: recalculateEDefterSummary(combined),
    groupCounts: groupEDefterCounts(combined),
  };
}

function scoreFromLevel(level = "") {
  if (level === E_DEFTER_RISK_LEVEL.KRITIK) return 85;
  if (level === E_DEFTER_RISK_LEVEL.YUKSEK) return 65;
  if (level === E_DEFTER_RISK_LEVEL.ORTA) return 40;
  return 15;
}

export function buildSmartEDefterExplanation(row = {}, issues = []) {
  const issueText = issues.join(" ").toLocaleLowerCase("tr-TR");
  const why =
    issueText.includes("kdv") || issueText.includes("191") || issueText.includes("391")
      ? "KDV hesapları ile beyanname/matrah arasında tutarsızlık oluşmuş olabilir."
      : issueText.includes("kasa") || issueText.includes("100")
        ? "Nakit hareketlerinin tamamı bankaya aktarılmamış veya kayıt dışı işlem olabilir."
        : issueText.includes("mükerrer") || issueText.includes("mukerrer")
          ? "Aynı belge veya fiş birden fazla kez işlenmiş olabilir."
          : issueText.includes("xml") || issueText.includes("berat")
            ? "E-defter dosya yapısı veya berat eşleşmesinde teknik sorun olabilir."
            : "Kayıt, belge veya dönemlendirme hatası söz konusu olabilir.";

  const check =
    issueText.includes("sgk") || issueText.includes("361")
      ? "SGK tahakkuk fişi, bordro ve banka ödeme dekontunu kontrol edin."
      : issueText.includes("belge")
        ? "İlgili fatura, fiş, dekont ve yevmiye kaydını birlikte inceleyin."
        : "Muavin dökümü, yevmiye fişi ve destekleyici belgeleri karşılaştırın.";

  const effect =
    issueText.includes("kdv") || issueText.includes("vergi")
      ? "Vergi beyanı ve e-defter berat sürecinde red veya ek açıklama istenebilir."
      : issueText.includes("mükerrer") || issueText.includes("mukerrer")
        ? "Çift gider veya çift gelir beyanı riski doğabilir."
        : "E-defter berat öncesi düzeltme gerekmeden süreç tamamlanmayabilir.";

  return [
    `Sorun neden oluşmuş olabilir? ${why}`,
    `Hangi belge kontrol edilmeli? ${check}`,
    `Olası vergisel etkisi: ${effect}`,
    row.aciklama ? `Kayıt: ${row.aciklama}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTechnicalFindingRows(findings = [], context = {}) {
  return (findings || []).map((finding, index) => {
    const riskScore = scoreFromLevel(finding.level);
    const row = {
      id: `teknik-${finding.code || index}-${Date.now()}`,
      kaynak: E_DEFTER_KAYNAK.TEKNIK,
      tarih: "",
      fisNo: "",
      yevmiyeNo: "",
      hesapKodu: "",
      hesapAdi: "Teknik Kontrol",
      aciklama: finding.message,
      belgeTuru: "Teknik",
      belgeNo: finding.code || "",
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
      issues: [finding.message],
      riskScore,
      riskBand: riskBandFromScore(riskScore),
      riskLevel: finding.level || riskLevelFromScore(riskScore),
      hataTuru: E_DEFTER_HATA_TURU.TEKNIK,
      onerilenKontrol: "XML/ZIP dosyasını ve berat eşleşmesini yeniden kontrol edin.",
      cozumDurumu: E_DEFTER_FINDING_STATUS.YENI,
      grup: E_DEFTER_KONTROL_GRUP.TEKNIK,
      durum: E_DEFTER_KONTROL_DURUM.KRITIK,
      companyId: context.companyId || "",
      period: context.period || "",
    };
    row.smartExplanation = buildSmartEDefterExplanation(row, row.issues);
    return row;
  });
}

function sumAccountPrefix(rows = [], prefix) {
  return rows
    .filter((row) => String(row.hesapKodu || "").startsWith(prefix))
    .reduce((sum, row) => sum + roundMoney(Math.max(row.borc, row.alacak)), 0);
}

export function buildVergiselFindingRows({ rows = [], declarationRecords = [], companyId = "", period = "" }) {
  const findings = [];
  const kdv191 = sumAccountPrefix(rows, "191");
  const kdv391 = sumAccountPrefix(rows, "391");
  const kdv360 = sumAccountPrefix(rows, "360");
  const sgk361 = sumAccountPrefix(rows, "361");
  const devreden190 = sumAccountPrefix(rows, "190");

  if (Math.abs(kdv191 - kdv391) > 1000 && (kdv191 || kdv391)) {
    findings.push({
      message: `191/391 KDV uyumsuzluğu: 191=${kdv191.toLocaleString("tr-TR")} TL, 391=${kdv391.toLocaleString("tr-TR")} TL`,
      level: E_DEFTER_RISK_LEVEL.YUKSEK,
      code: "KDV_191_391",
      action: "KDV listesi ve hesap hareketlerini karşılaştırın.",
    });
  }

  if (devreden190 > KASA_BAKIYE_ESIK) {
    findings.push({
      message: `Devreden KDV süreklilik analizi: 190 hesabı ${devreden190.toLocaleString("tr-TR")} TL`,
      level: E_DEFTER_RISK_LEVEL.ORTA,
      code: "DEVREDEN_KDV",
      action: "KDV beyannamesi ve indirilecek KDV listesini inceleyin.",
    });
  }

  const declarationKdv = declarationRecords
    .filter((record) => record.type === "KDV")
    .filter((record) => !period || record.period === period)
    .reduce((sum, record) => sum + Number(record.totalPayment || 0), 0);
  if (declarationKdv && Math.abs(kdv360 - declarationKdv) > 1000) {
    findings.push({
      message: `Beyanname ile muhasebe farkı (KDV): mizan 360=${kdv360.toLocaleString("tr-TR")} TL, tahakkuk=${declarationKdv.toLocaleString("tr-TR")} TL`,
      level: E_DEFTER_RISK_LEVEL.KRITIK,
      code: "BEYANNAME_KDV",
      action: "KDV beyannamesi ve 360 hesap hareketlerini eşleştirin.",
    });
  }

  const declarationSgk = declarationRecords
    .filter((record) => record.type === "SGK")
    .reduce((sum, record) => sum + Number(record.totalPayment || 0), 0);
  if (declarationSgk && Math.abs(sgk361 - declarationSgk) > 1000) {
    findings.push({
      message: `SGK tahakkuk uyumu: 361=${sgk361.toLocaleString("tr-TR")} TL, tahakkuk=${declarationSgk.toLocaleString("tr-TR")} TL`,
      level: E_DEFTER_RISK_LEVEL.YUKSEK,
      code: "SGK_TAHAKKUK",
      action: "SGK tahakkuk fişi ve bordro belgelerini kontrol edin.",
    });
  }

  ["Damga Vergisi", "Konaklama Vergisi", "Turizm Payı"].forEach((type) => {
    const total = declarationRecords
      .filter((record) => record.type === type)
      .reduce((sum, record) => sum + Number(record.totalPayment || 0), 0);
    if (total > 0) {
      findings.push({
        message: `${type} tahakkuk kaydı mevcut (${total.toLocaleString("tr-TR")} TL); muhasebe eşleşmesi kontrol edilmeli.`,
        level: E_DEFTER_RISK_LEVEL.ORTA,
        code: type.replace(/\s+/g, "_").toUpperCase(),
        action: `${type} beyanı ve ilgili hesap hareketlerini doğrulayın.`,
      });
    }
  });

  const tevkifatRows = rows.filter((row) => /tevkifat|stopaj/i.test(String(row.aciklama || "")));
  if (tevkifatRows.length) {
    findings.push({
      message: `${tevkifatRows.length} tevkifat/stopaj kaydı tespit edildi; oran ve hesap eşleşmesi kontrol edilmeli.`,
      level: E_DEFTER_RISK_LEVEL.ORTA,
      code: "TEVKIFAT",
      action: "Tevkifat beyannamesi ve stopaj hesaplarını karşılaştırın.",
    });
  }

  return findings.map((finding, index) => {
    const riskScore = scoreFromLevel(finding.level);
    const row = {
      id: `vergisel-${finding.code || index}`,
      kaynak: E_DEFTER_KAYNAK.VERGISEL,
      tarih: "",
      fisNo: "",
      yevmiyeNo: "",
      hesapKodu: "",
      hesapAdi: "Vergisel Kontrol",
      aciklama: finding.message,
      belgeTuru: "Vergisel",
      belgeNo: finding.code || "",
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
      issues: [finding.message],
      riskScore,
      riskBand: riskBandFromScore(riskScore),
      riskLevel: finding.level,
      hataTuru: E_DEFTER_HATA_TURU.VERGISEL,
      onerilenKontrol: finding.action,
      cozumDurumu: E_DEFTER_FINDING_STATUS.YENI,
      grup: E_DEFTER_KONTROL_GRUP.VERGISEL,
      durum: E_DEFTER_KONTROL_DURUM.KDV_KONTROL,
      companyId,
      period,
    };
    row.smartExplanation = buildSmartEDefterExplanation(row, row.issues);
    return row;
  });
}

export function buildEDefterUploadRecord(input = {}) {
  return {
    id: input.id || `edefter-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    companyId: input.companyId || "",
    year: String(input.year || "").trim(),
    month: String(input.month || "").trim(),
    defterType: input.defterType || E_DEFTER_TURU.YEVMIYE,
    uploadedAt: input.uploadedAt || new Date().toISOString(),
    controlStatus: input.controlStatus || E_DEFTER_KONTROL_STATUS.BEKLIYOR,
    errorCount: Number(input.errorCount || 0),
    warningCount: Number(input.warningCount || 0),
    fileName: input.fileName || "",
    period: input.period || `${input.year || ""}/${input.month || ""}`,
  };
}

export function loadEDefterKontrolRecords() {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(E_DEFTER_RECORDS_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveEDefterKontrolRecords(records = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(E_DEFTER_RECORDS_STORAGE_KEY, JSON.stringify(records));
}

export function runEDefterKontrolScenario() {
  const brokenXml = buildTechnicalFindingRows(
    [{ code: "XML_BOZUK", message: "Bozuk XML dosyası", level: E_DEFTER_RISK_LEVEL.KRITIK }],
    { companyId: "test", period: "2026/05" }
  );
  const missingYevmiye = buildTechnicalFindingRows(
    [{ code: "EKSIK_YEVMIYE", message: "Eksik yevmiye numarası", level: E_DEFTER_RISK_LEVEL.ORTA }],
    { companyId: "test", period: "2026/05" }
  );
  const muavinRows = [
    {
      id: "1",
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: "31.05.2026",
      fisNo: "101",
      yevmiyeNo: "1",
      hesapKodu: "100.01.001",
      hesapAdi: "Kasa",
      aciklama: "Kasa bakiyesi",
      belgeTuru: "FT",
      belgeNo: "A-001",
      belgeTarihi: "31.05.2026",
      borc: 120000,
      alacak: 0,
      tutar: 120000,
    },
    {
      id: "2",
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: "15.05.2026",
      fisNo: "102",
      yevmiyeNo: "2",
      hesapKodu: "320.01.001",
      hesapAdi: "Satıcılar",
      aciklama: "Fatura",
      belgeTuru: "FT",
      belgeNo: "A-001",
      belgeTarihi: "15.05.2026",
      borc: 5000,
      alacak: 0,
      tutar: 5000,
    },
    {
      id: "3",
      kaynak: E_DEFTER_KAYNAK.MUAVIN,
      tarih: "20.05.2026",
      fisNo: "103",
      yevmiyeNo: "3",
      hesapKodu: "191.01.001",
      hesapAdi: "İndirilecek KDV",
      aciklama: "",
      belgeTuru: "",
      belgeNo: "",
      belgeTarihi: "",
      borc: 50000,
      alacak: 0,
      tutar: 50000,
    },
  ];
  const mizanRows = [
    {
      id: "m1",
      kaynak: E_DEFTER_KAYNAK.MIZAN,
      hesapKodu: "391.01.001",
      hesapAdi: "Hesaplanan KDV",
      borc: 0,
      alacak: 30000,
      tutar: 30000,
    },
  ];
  const result = runEDefterKontrolPipeline({
    muavinRows,
    mizanRows,
    companyId: "test",
    period: "2026/05",
    declarationRecords: [{ companyId: "test", period: "2026/05", type: "KDV", totalPayment: 40000 }],
    technicalFindings: [
      { code: "XML_BOZUK", message: "Bozuk XML", level: E_DEFTER_RISK_LEVEL.KRITIK },
      { code: "EKSIK_YEVMIYE", message: "Eksik yevmiye", level: E_DEFTER_RISK_LEVEL.ORTA },
    ],
  });

  return {
    brokenXmlCount: brokenXml.length,
    missingYevmiyeCount: missingYevmiye.length,
    negativeKasaDetected: result.rows.some((row) =>
      String(row.issues || []).join(" ").includes("Kasa")
    ),
    duplicateBelgeDetected: result.rows.some((row) =>
      String(row.issues || []).join(" ").includes("Belge no mükerrer")
    ),
    kdv191391Detected: result.rows.some((row) => row.aciklama?.includes("191/391")),
    beyannameMismatchDetected: result.rows.some((row) => row.aciklama?.includes("Beyanname ile muhasebe")),
    missingDescriptionDetected: result.rows.some((row) =>
      String(row.issues || []).join(" ").includes("Açıklama boş")
    ),
    totalFindings: result.rows.filter((row) => row.grup !== E_DEFTER_KONTROL_GRUP.HATASIZ).length,
    summary: result.summary,
  };
}
