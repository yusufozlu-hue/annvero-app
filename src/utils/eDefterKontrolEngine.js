import {
  BELGE_TARIH_FARK_GUN,
  BORC_ALACAK_TOLERANCE,
  E_DEFTER_FINDING_CODE,
  E_DEFTER_FINDING_STATUS,
  E_DEFTER_FINGERPRINT_STORAGE_KEY,
  E_DEFTER_HATA_TURU,
  E_DEFTER_ISSUE_CODE,
  E_DEFTER_ISSUE_SEVERITY,
  E_DEFTER_KAYNAK,
  E_DEFTER_KONTROL_DURUM,
  E_DEFTER_KONTROL_GRUP,
  E_DEFTER_KONTROL_STATUS,
  E_DEFTER_RECORDS_STORAGE_KEY,
  E_DEFTER_REPORT_DISCLAIMER,
  E_DEFTER_RISK_LEVEL,
  E_DEFTER_SONUC_SEVIYE,
  E_DEFTER_TURU,
  KASA_BAKIYE_ESIK,
  NEAR_DATE_DAYS,
  mapLegacyLevelToSonuc,
  riskBandFromScore,
  riskLevelFromScore,
  sonucSeviyeFromScore,
} from "@/src/config/eDefterKontrolDefaults";
import { loadDeclarationAccrualRecords } from "@/src/utils/beyannameTahakkukEngine";
import { formatDateTR, parseDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { normalizeParserText } from "@/src/utils/textNormalize";
import {
  EDEFTER_ERROR_CODE,
  buildContentFingerprint,
  createFingerprintSession,
  normalizePeriodKey,
  normalizeTaxId,
} from "@/src/utils/eDefterSecurity";

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

  if (prefix.startsWith("102") && net < -BORC_ALACAK_TOLERANCE) {
    issues.push("102 banka hesabında ters bakiye riski.");
    riskScore += 30;
  }

  if (prefix.startsWith("180") && Math.abs(net) > KASA_BAKIYE_ESIK) {
    issues.push("180 gelecek aylara ait giderlerde olağandışı bakiye.");
    riskScore += 25;
  }

  if (prefix.startsWith("280") && Math.abs(net) > KASA_BAKIYE_ESIK) {
    issues.push("280 gelecek yıllara ait giderlerde olağandışı bakiye.");
    riskScore += 25;
  }

  if (prefix.startsWith("309") || prefix.startsWith("409")) {
    if (Math.abs(net) > KASA_BAKIYE_ESIK) {
      issues.push(`${prefix.slice(0, 3)} alınan/verilen çeklerde olağandışı bakiye.`);
      riskScore += 25;
    }
  }

  if (prefix.startsWith("335") || prefix.startsWith("195") || prefix.startsWith("196")) {
    if (Math.abs(net) > BORC_ALACAK_TOLERANCE) {
      issues.push(`${prefix.slice(0, 3)} personel/avans hesabında bakiye risk göstergesi.`);
      riskScore += 20;
    }
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

  const fisLineCounts = new Map();
  const belgeCounts = new Map();
  const aciklamaCounts = new Map();
  const nearKeys = new Map();

  for (const row of ledgerRows) {
    if (row.fisNo && row.kaynak !== E_DEFTER_KAYNAK.MIZAN) {
      const fk = compactText(row.fisNo);
      fisLineCounts.set(fk, (fisLineCounts.get(fk) || 0) + 1);
    }
    if (row.belgeNo) {
      const bk = compactText(row.belgeNo);
      belgeCounts.set(bk, (belgeCounts.get(bk) || 0) + 1);
    }
    if (row.aciklama) {
      const ak = compactText(row.aciklama);
      aciklamaCounts.set(ak, (aciklamaCounts.get(ak) || 0) + 1);
    }
    if (row.tutar && row.cariUnvan) {
      const nk = `${compactText(row.cariUnvan)}|${roundMoney(row.tutar)}`;
      const list = nearKeys.get(nk) || [];
      list.push(row);
      nearKeys.set(nk, list);
    }
  }

  return {
    accountBalances,
    problematicAccounts,
    unbalancedFis,
    fisNoGaps,
    outOfOrderFis,
    fisLineCounts,
    belgeCounts,
    aciklamaCounts,
    nearKeys,
    hasKapanisFisi: /kapan[ıi]s|7\/a|7a|gelir tablosu kapan/.test(allText),
    hasAmortisman: /amortisman/.test(allText),
    hasKurDegerleme: /kur de[ğg]erleme|kur fark[ıi]|de[ğg]erleme fark[ıi]/.test(allText),
  };
}

const ISSUE_SEVERITY_RANK = {
  [E_DEFTER_ISSUE_SEVERITY.BILGI]: 1,
  [E_DEFTER_ISSUE_SEVERITY.UYARI]: 2,
  [E_DEFTER_ISSUE_SEVERITY.KRITIK]: 3,
};

const GROUP_PRIORITY = {
  [E_DEFTER_KONTROL_GRUP.KRITIK]: 100,
  [E_DEFTER_KONTROL_GRUP.CAPRAZ]: 95,
  [E_DEFTER_KONTROL_GRUP.MUKERRER]: 80,
  [E_DEFTER_KONTROL_GRUP.TERS_BAKIYE]: 70,
  [E_DEFTER_KONTROL_GRUP.EKSIK_BILGI]: 60,
  [E_DEFTER_KONTROL_GRUP.DONEM_SONU]: 50,
  [E_DEFTER_KONTROL_GRUP.KDV_KONTROL]: 45,
  [E_DEFTER_KONTROL_GRUP.VERGISEL]: 40,
  [E_DEFTER_KONTROL_GRUP.TEKNIK]: 35,
  [E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI]: 30,
  [E_DEFTER_KONTROL_GRUP.HATASIZ]: 0,
};

/** Structured issue factory — single contract for engine/UI/persist. */
export function createEDefterIssue({
  code = E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
  message = "",
  severity = E_DEFTER_ISSUE_SEVERITY.UYARI,
  group = E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
  blocking = false,
  source = "engine",
  riskScore = 0,
} = {}) {
  const safeMessage = String(message || "").trim() || "Tanımsız bulgu.";
  const safeSeverity =
    ISSUE_SEVERITY_RANK[severity] != null ? severity : E_DEFTER_ISSUE_SEVERITY.UYARI;
  const safeBlocking =
    Boolean(blocking) || safeSeverity === E_DEFTER_ISSUE_SEVERITY.KRITIK;
  return {
    code: String(code || E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE),
    message: safeMessage,
    severity: safeSeverity,
    group: group || E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
    blocking: safeBlocking,
    source: String(source || "engine"),
    riskScore: Math.max(0, Number(riskScore) || 0),
  };
}

/** Legacy string / unknown object → structured issue (fail-closed). */
export function normalizeEDefterIssue(raw, source = "engine") {
  if (raw && typeof raw === "object" && raw.message) {
    return createEDefterIssue({
      code: raw.code || E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message: raw.message,
      severity: raw.severity || E_DEFTER_ISSUE_SEVERITY.UYARI,
      group: raw.group || E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      blocking: raw.blocking,
      source: raw.source || source,
      riskScore: raw.riskScore,
    });
  }
  const message = String(raw || "").trim();
  if (!message) return null;
  const lower = message.toLocaleLowerCase("tr-TR");

  // Keyword fallback — never returns HATASIZ when a message exists.
  if (lower.includes("hesap planında yok")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.ACCOUNT_NOT_IN_PLAN,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
      group: E_DEFTER_KONTROL_GRUP.KRITIK,
      blocking: true,
      source,
      riskScore: 35,
    });
  }
  if (lower.includes("dönem dışı")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.DATE_OUT_OF_PERIOD,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
      group: E_DEFTER_KONTROL_GRUP.KRITIK,
      blocking: true,
      source,
      riskScore: 30,
    });
  }
  if (lower.includes("negatif tutar")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.NEGATIVE_AMOUNT,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
      group: E_DEFTER_KONTROL_GRUP.KRITIK,
      blocking: true,
      source,
      riskScore: 40,
    });
  }
  if (lower.includes("dengesi bozuk") || lower.includes("borç/alacak")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.DEBIT_CREDIT_MISMATCH,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
      group: E_DEFTER_KONTROL_GRUP.KRITIK,
      blocking: true,
      source,
      riskScore: 45,
    });
  }
  if (lower.includes("mükerrer") || lower.includes("mukerrer") || lower.includes("tekrar")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.DUPLICATE_ENTRY,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
      group: E_DEFTER_KONTROL_GRUP.MUKERRER,
      blocking: false,
      source,
      riskScore: 25,
    });
  }
  if (lower.includes("açıklama boş")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.MISSING_DESCRIPTION,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
      group: E_DEFTER_KONTROL_GRUP.EKSIK_BILGI,
      blocking: false,
      source,
      riskScore: 10,
    });
  }
  if (
    lower.includes("hesap kodu boş") ||
    lower.includes("belge türü boş") ||
    lower.includes("yevmiye no eksik")
  ) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.MISSING_DOCUMENT_INFO,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
      group: E_DEFTER_KONTROL_GRUP.EKSIK_BILGI,
      blocking: false,
      source,
      riskScore: 15,
    });
  }
  if (lower.includes("atlama") || lower.includes("tarih sırası")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.JOURNAL_SEQUENCE_GAP,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
      group: E_DEFTER_KONTROL_GRUP.KRITIK,
      blocking: true,
      source,
      riskScore: 50,
    });
  }
  if (lower.includes("ters bakiye") || lower.includes("kasa hesab")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
      group: E_DEFTER_KONTROL_GRUP.TERS_BAKIYE,
      blocking: false,
      source,
      riskScore: 25,
    });
  }
  if (lower.includes("kdv")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
      group: E_DEFTER_KONTROL_GRUP.KDV_KONTROL,
      blocking: false,
      source,
      riskScore: 20,
    });
  }
  if (lower.includes("dönem sonu") || lower.includes("kapan") || lower.includes("amortisman")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
      group: E_DEFTER_KONTROL_GRUP.DONEM_SONU,
      blocking: false,
      source,
      riskScore: 20,
    });
  }
  if (lower.includes("yuvarlama")) {
    return createEDefterIssue({
      code: E_DEFTER_ISSUE_CODE.SUSPICIOUS_ROUNDING,
      message,
      severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
      group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
      blocking: false,
      source,
      riskScore: 10,
    });
  }

  return createEDefterIssue({
    code: E_DEFTER_ISSUE_CODE.UNKNOWN_ISSUE,
    message,
    severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
    group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
    blocking: false,
    source,
    riskScore: 20,
  });
}

export function classifyEDefterIssues(rawIssues = []) {
  const issueDetails = [];
  const seen = new Set();
  for (const raw of rawIssues || []) {
    const issue = normalizeEDefterIssue(raw);
    if (!issue) continue;
    const dedupeKey = `${issue.code}|${issue.message}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    issueDetails.push(issue);
  }

  if (!issueDetails.length) {
    return {
      issueDetails: [],
      issues: [],
      primaryGroup: E_DEFTER_KONTROL_GRUP.HATASIZ,
      riskScore: 0,
      maxSeverity: null,
      hasBlocking: false,
      hasNonInfo: false,
    };
  }

  let primaryGroup = E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI;
  let bestGroupRank = -1;
  let riskScore = 0;
  let maxSeverity = E_DEFTER_ISSUE_SEVERITY.BILGI;
  let hasBlocking = false;
  let hasNonInfo = false;

  for (const issue of issueDetails) {
    riskScore += issue.riskScore || 0;
    if (issue.blocking) hasBlocking = true;
    if (issue.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI) hasNonInfo = true;
    if ((ISSUE_SEVERITY_RANK[issue.severity] || 0) > (ISSUE_SEVERITY_RANK[maxSeverity] || 0)) {
      maxSeverity = issue.severity;
    }
    const rank = GROUP_PRIORITY[issue.group] ?? GROUP_PRIORITY[E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI];
    if (rank > bestGroupRank) {
      bestGroupRank = rank;
      primaryGroup = issue.group || E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI;
    }
  }

  // Fail-closed: issues present ⇒ never HATASIZ.
  if (primaryGroup === E_DEFTER_KONTROL_GRUP.HATASIZ) {
    primaryGroup = E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI;
  }

  return {
    issueDetails,
    issues: issueDetails.map((item) => item.message),
    primaryGroup,
    riskScore: Math.max(1, Math.min(100, riskScore)),
    maxSeverity,
    hasBlocking,
    hasNonInfo,
  };
}

function buildIssues(row, _allRows = [], context = {}) {
  const raw = [];
  const fisKey = compactText(row.fisNo);
  const hesapKey = compactText(row.hesapKodu);

  if (!row.hesapKodu) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.MISSING_DOCUMENT_INFO,
        message: "Hesap kodu boş.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.EKSIK_BILGI,
        riskScore: 20,
      })
    );
  }

  if (!row.aciklama) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.MISSING_DESCRIPTION,
        message: "Açıklama boş.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.EKSIK_BILGI,
        riskScore: 10,
      })
    );
  }

  if (!row.belgeTuru && row.kaynak !== E_DEFTER_KAYNAK.MIZAN) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.MISSING_DOCUMENT_INFO,
        message: "Belge türü boş.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.EKSIK_BILGI,
        riskScore: 10,
      })
    );
  }

  if (!row.yevmiyeNo && row.kaynak !== E_DEFTER_KAYNAK.MIZAN) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.MISSING_DOCUMENT_INFO,
        message: "Yevmiye no eksik.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.EKSIK_BILGI,
        riskScore: 15,
      })
    );
  }

  if (context.unbalancedFis?.has(fisKey) && row.fisNo) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.DEBIT_CREDIT_MISMATCH,
        message: "Fiş borç/alacak dengesi bozuk.",
        severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
        group: E_DEFTER_KONTROL_GRUP.KRITIK,
        blocking: true,
        riskScore: 45,
      })
    );
  }

  if (context.outOfOrderFis?.has(fisKey) && row.fisNo) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.JOURNAL_SEQUENCE_GAP,
        message: "Tarih sırası bozuk fiş.",
        severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
        group: E_DEFTER_KONTROL_GRUP.KRITIK,
        blocking: true,
        riskScore: 20,
      })
    );
  }

  if (row.belgeTarihi && row.tarih && daysBetween(row.belgeTarihi, row.tarih) > BELGE_TARIH_FARK_GUN) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.DOCUMENT_DATE_GAP,
        message: "Belge tarihi ile fiş tarihi arasında anlamlı fark var.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 15,
      })
    );
  }

  const fisLineCount = context.fisLineCounts?.get(fisKey) || 0;
  if (fisLineCount > 5 && row.fisNo) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.DUPLICATE_ENTRY,
        message: "Fiş no yoğun tekrar / mükerrer riski.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.MUKERRER,
        riskScore: 15,
      })
    );
  }

  const belgeKey = compactText(row.belgeNo);
  if (row.belgeNo && (context.belgeCounts?.get(belgeKey) || 0) > 1) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.DUPLICATE_ENTRY,
        message: "Belge no mükerrer.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.MUKERRER,
        riskScore: 30,
      })
    );
  }

  if (row.tutar && row.cariUnvan && context.nearKeys) {
    const nk = `${compactText(row.cariUnvan)}|${roundMoney(row.tutar)}`;
    const peers = context.nearKeys.get(nk) || [];
    const nearDup = peers.some(
      (item) => item.id !== row.id && daysBetween(item.tarih, row.tarih) <= NEAR_DATE_DAYS
    );
    if (nearDup) {
      raw.push(
        createEDefterIssue({
          code: E_DEFTER_ISSUE_CODE.DUPLICATE_ENTRY,
          message: "Aynı cari + tutar + yakın tarih mükerrer riski.",
          severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
          group: E_DEFTER_KONTROL_GRUP.MUKERRER,
          riskScore: 25,
        })
      );
    }
  }

  if (row.tutar > 0 && row.tutar % 1000 === 0 && row.tutar >= 10000) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.SUSPICIOUS_ROUNDING,
        message: "Şüpheli yuvarlama kaydı.",
        severity: E_DEFTER_ISSUE_SEVERITY.BILGI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 10,
      })
    );
  }

  if (Number(row.borc || 0) < 0 || Number(row.alacak || 0) < 0) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.NEGATIVE_AMOUNT,
        message: "Negatif tutar satırı.",
        severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
        group: E_DEFTER_KONTROL_GRUP.KRITIK,
        blocking: true,
        riskScore: 40,
      })
    );
  }

  if (
    Number(row.borc || 0) === 0 &&
    Number(row.alacak || 0) === 0 &&
    row.kaynak !== E_DEFTER_KAYNAK.MIZAN
  ) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.ZERO_AMOUNT,
        message: "Sıfır tutarlı satır.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI,
        riskScore: 15,
      })
    );
  }

  if (context.accountPlanCodes instanceof Set && row.hesapKodu) {
    const code = String(row.hesapKodu).trim();
    const short = code.split(".")[0];
    if (!context.accountPlanCodes.has(code) && !context.accountPlanCodes.has(short)) {
      raw.push(
        createEDefterIssue({
          code: E_DEFTER_ISSUE_CODE.ACCOUNT_NOT_IN_PLAN,
          message: "Hesap kodu hesap planında yok.",
          severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
          group: E_DEFTER_KONTROL_GRUP.KRITIK,
          blocking: true,
          riskScore: 35,
        })
      );
    }
  }

  if (context.expectedPeriodKey && row.tarih) {
    const d = parseDateTR(row.tarih);
    if (d) {
      const rowPeriod = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (rowPeriod !== context.expectedPeriodKey) {
        raw.push(
          createEDefterIssue({
            code: E_DEFTER_ISSUE_CODE.DATE_OUT_OF_PERIOD,
            message: "Dönem dışı tarih.",
            severity: E_DEFTER_ISSUE_SEVERITY.KRITIK,
            group: E_DEFTER_KONTROL_GRUP.KRITIK,
            blocking: true,
            riskScore: 30,
          })
        );
      }
    }
  }

  const aciklamaKey = compactText(row.aciklama);
  if (row.aciklama && (context.aciklamaCounts?.get(aciklamaKey) || 0) > 3) {
    raw.push(
      createEDefterIssue({
        code: E_DEFTER_ISSUE_CODE.DUPLICATE_ENTRY,
        message: "Mükerrer açıklama tekrarı.",
        severity: E_DEFTER_ISSUE_SEVERITY.UYARI,
        group: E_DEFTER_KONTROL_GRUP.MUKERRER,
        riskScore: 15,
      })
    );
  }

  const accountIssue = context.problematicAccounts?.get(hesapKey);
  if (accountIssue?.issues?.length) {
    for (const msg of accountIssue.issues) {
      raw.push(normalizeEDefterIssue(msg, "account-balance"));
    }
  }

  return classifyEDefterIssues(raw);
}

function resolvePrimaryGroup(issues = [], row = {}) {
  const classified = classifyEDefterIssues(issues);
  if (classified.issueDetails.length > 0) return classified.primaryGroup;
  if (!row.hesapKodu || !row.aciklama || (!row.belgeTuru && row.kaynak !== E_DEFTER_KAYNAK.MIZAN)) {
    return E_DEFTER_KONTROL_GRUP.EKSIK_BILGI;
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
    [E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI]: E_DEFTER_KONTROL_DURUM.INCELEME_GEREKLI,
  };

  return map[grup] || E_DEFTER_KONTROL_DURUM.INCELEME_GEREKLI;
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

function severityToSonucSeviye(severity) {
  if (severity === E_DEFTER_ISSUE_SEVERITY.KRITIK) return E_DEFTER_SONUC_SEVIYE.KRITIK;
  if (severity === E_DEFTER_ISSUE_SEVERITY.UYARI) return E_DEFTER_SONUC_SEVIYE.UYARI;
  if (severity === E_DEFTER_ISSUE_SEVERITY.BILGI) return E_DEFTER_SONUC_SEVIYE.BILGI;
  return E_DEFTER_SONUC_SEVIYE.UYGUN;
}

export function analyzeEDefterRow(row, allRows = [], context = {}) {
  if (row.disaridaBirak) {
    return {
      ...row,
      issues: [],
      issueDetails: [],
      riskScore: 0,
      riskBand: riskBandFromScore(0),
      riskLevel: riskLevelFromScore(0),
      sonucSeviye: E_DEFTER_SONUC_SEVIYE.UYGUN,
      hasBlockingIssue: false,
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
  const hasIssues = analysis.issueDetails.length > 0;
  // Fail-closed: never trust HATASIZ when structured issues exist.
  const grup = hasIssues
    ? analysis.primaryGroup === E_DEFTER_KONTROL_GRUP.HATASIZ
      ? E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI
      : analysis.primaryGroup
    : resolvePrimaryGroup(analysis.issues, row);
  const durum = resolveDurum(grup, row);
  const riskScore = hasIssues
    ? Math.max(1, analysis.riskScore || 0)
    : grup === E_DEFTER_KONTROL_GRUP.HATASIZ
      ? 0
      : analysis.riskScore;
  const sonucSeviye = hasIssues
    ? severityToSonucSeviye(analysis.maxSeverity)
    : sonucSeviyeFromScore(riskScore);

  return {
    ...row,
    borc: roundMoney(row.borc),
    alacak: roundMoney(row.alacak),
    tutar: roundMoney(row.tutar || Math.max(row.borc, row.alacak)),
    issues: analysis.issues,
    issueDetails: analysis.issueDetails,
    riskScore,
    riskBand: riskBandFromScore(riskScore),
    riskLevel: riskLevelFromScore(riskScore),
    sonucSeviye,
    hasBlockingIssue: Boolean(analysis.hasBlocking),
    hataTuru: row.hataTuru || E_DEFTER_HATA_TURU.MUHASEBESEL,
    onerilenKontrol:
      row.onerilenKontrol ||
      (analysis.issues[0] ? `${analysis.issues[0]} için belge ve fiş kontrolü yapın.` : ""),
    cozumDurumu: row.cozumDurumu || E_DEFTER_FINDING_STATUS.YENI,
    smartExplanation: row.smartExplanation || buildSmartEDefterExplanation(row, analysis.issues),
    grup,
    durum,
  };
}

export function analyzeEDefterRows(rows = [], options = {}) {
  const context = {
    ...buildGlobalContext(rows),
    accountPlanCodes: options.accountPlanCodes || null,
    expectedPeriodKey: options.expectedPeriod
      ? normalizePeriodKey(String(options.expectedPeriod).replace("/", "-"))
      : "",
  };
  const analyzed = rows.map((row) => analyzeEDefterRow(row, rows, context));
  const warnings = buildPeriodEndWarnings(context);
  return [...analyzed, ...warnings];
}

function sumDebitCredit(rows = []) {
  return rows.reduce(
    (acc, row) => {
      acc.borc += roundMoney(row.borc);
      acc.alacak += roundMoney(row.alacak);
      return acc;
    },
    { borc: 0, alacak: 0 }
  );
}

/**
 * Yevmiye ↔ kebir çapraz mutabakat. Fark varsa JOURNAL_LEDGER_MISMATCH — “uygun” üretilmez.
 */
export function reconcileJournalLedger(yevmiyeRows = [], kebirRows = []) {
  const findings = [];
  if (!yevmiyeRows.length || !kebirRows.length) {
    return { findings, matched: false, skipped: true };
  }

  const yTotals = sumDebitCredit(yevmiyeRows);
  const kTotals = sumDebitCredit(kebirRows);
  const borcFark = roundMoney(yTotals.borc - kTotals.borc);
  const alacakFark = roundMoney(yTotals.alacak - kTotals.alacak);

  if (Math.abs(borcFark) > BORC_ALACAK_TOLERANCE || Math.abs(alacakFark) > BORC_ALACAK_TOLERANCE) {
    findings.push({
      code: E_DEFTER_FINDING_CODE.JOURNAL_LEDGER_MISMATCH,
      message: `Yevmiye-kebir toplam farkı: borç fark=${borcFark}, alacak fark=${alacakFark}`,
      level: E_DEFTER_SONUC_SEVIYE.KRITIK,
    });
  }

  const yMap = buildAccountBalanceMap(yevmiyeRows);
  const kMap = buildAccountBalanceMap(kebirRows);
  const allKeys = new Set([...yMap.keys(), ...kMap.keys()]);
  for (const key of allKeys) {
    const y = yMap.get(key) || { borc: 0, alacak: 0, net: 0, hesapKodu: key };
    const k = kMap.get(key) || { borc: 0, alacak: 0, net: 0, hesapKodu: key };
    if (
      Math.abs(y.borc - k.borc) > BORC_ALACAK_TOLERANCE ||
      Math.abs(y.alacak - k.alacak) > BORC_ALACAK_TOLERANCE
    ) {
      findings.push({
        code: E_DEFTER_FINDING_CODE.JOURNAL_LEDGER_MISMATCH,
        message: `Hesap bazlı yevmiye-kebir farkı: ${y.hesapKodu || k.hesapKodu}`,
        level: E_DEFTER_SONUC_SEVIYE.KRITIK,
      });
      break;
    }
  }

  return {
    findings,
    matched: findings.length === 0,
    skipped: false,
    yTotals,
    kTotals,
  };
}

export function buildCrossFindingRows(findings = [], context = {}) {
  return (findings || []).map((finding, index) => {
    const riskScore =
      mapLegacyLevelToSonuc(finding.level) === E_DEFTER_SONUC_SEVIYE.KRITIK ? 90 : 55;
    const row = {
      id: `capraz-${finding.code || index}`,
      kaynak: E_DEFTER_KAYNAK.CAPRAZ,
      tarih: "",
      fisNo: "",
      yevmiyeNo: "",
      hesapKodu: "",
      hesapAdi: "Çapraz Mutabakat",
      aciklama: finding.message,
      belgeTuru: "Çapraz",
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
      sonucSeviye: mapLegacyLevelToSonuc(finding.level),
      hataTuru: E_DEFTER_HATA_TURU.MUHASEBESEL,
      onerilenKontrol: "Yevmiye ve kebir toplamlarını hesap bazında karşılaştırın.",
      cozumDurumu: E_DEFTER_FINDING_STATUS.YENI,
      grup: E_DEFTER_KONTROL_GRUP.CAPRAZ,
      durum: E_DEFTER_KONTROL_DURUM.KRITIK,
      companyId: context.companyId || "",
      period: context.period || "",
    };
    row.smartExplanation = buildSmartEDefterExplanation(row, row.issues);
    return row;
  });
}

export function analyzeBeratMeta(beratMeta = null, packageMeta = {}, options = {}) {
  const findings = [];
  if (!beratMeta) {
    findings.push({
      code: "BERAT_ESLESMEDI",
      message: "Berat dosyası eksik veya okunamadı.",
      level: E_DEFTER_SONUC_SEVIYE.UYARI,
    });
    return findings;
  }

  if (options.companyTaxId && beratMeta.taxId) {
    if (normalizeTaxId(beratMeta.taxId) !== normalizeTaxId(options.companyTaxId)) {
      findings.push({
        code: EDEFTER_ERROR_CODE.COMPANY_MISMATCH,
        message: "Berat firma bilgisi seçili firma ile uyuşmuyor.",
        level: E_DEFTER_SONUC_SEVIYE.KRITIK,
      });
    }
  }

  if (options.expectedPeriod && beratMeta.period) {
    const a = normalizePeriodKey(beratMeta.period);
    const b = normalizePeriodKey(String(options.expectedPeriod).replace("/", "-"));
    if (a && b && a !== b) {
      findings.push({
        code: "BERAT_DONEM",
        message: "Berat dönemi beklenen dönem ile uyuşmuyor.",
        level: E_DEFTER_SONUC_SEVIYE.UYARI,
      });
    }
  }

  findings.push({
    code: E_DEFTER_FINDING_CODE.EXTERNAL_VERIFICATION_REQUIRED,
    message:
      "Berat varlık/tür bilgisi okundu; GİB veya mali mühür kriptografik doğrulaması yapılmadı. Harici doğrulama gerekir.",
    level: E_DEFTER_SONUC_SEVIYE.BILGI,
  });

  return findings;
}

export function resolveOverallSonuc(rows = []) {
  let worst = E_DEFTER_SONUC_SEVIYE.UYGUN;
  const rank = {
    [E_DEFTER_SONUC_SEVIYE.UYGUN]: 0,
    [E_DEFTER_SONUC_SEVIYE.BILGI]: 1,
    [E_DEFTER_SONUC_SEVIYE.UYARI]: 2,
    [E_DEFTER_SONUC_SEVIYE.KRITIK]: 3,
  };
  for (const row of rows.filter((r) => !r.disaridaBirak)) {
    const details = Array.isArray(row.issueDetails) ? row.issueDetails : [];
    const unresolved = details.filter(
      (issue) => row.cozumDurumu !== E_DEFTER_FINDING_STATUS.COZULDU
    );
    const hasBlocking = unresolved.some((issue) => issue.blocking);
    const hasNonInfo = unresolved.some(
      (issue) => issue.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI
    );
    const legacyIssues = Array.isArray(row.issues) ? row.issues : [];
    const hasLegacyIssues =
      unresolved.length === 0 &&
      legacyIssues.length > 0 &&
      row.cozumDurumu !== E_DEFTER_FINDING_STATUS.COZULDU;

    let seviye =
      row.sonucSeviye ||
      mapLegacyLevelToSonuc(row.riskLevel) ||
      sonucSeviyeFromScore(row.riskScore || 0);

    if (hasBlocking || row.grup === E_DEFTER_KONTROL_GRUP.KRITIK || row.grup === E_DEFTER_KONTROL_GRUP.CAPRAZ) {
      worst = E_DEFTER_SONUC_SEVIYE.KRITIK;
      break;
    }
    if (hasNonInfo || hasLegacyIssues) {
      const fromIssues = unresolved.reduce((acc, issue) => {
        const mapped = severityToSonucSeviye(issue.severity);
        return (rank[mapped] || 0) > (rank[acc] || 0) ? mapped : acc;
      }, E_DEFTER_SONUC_SEVIYE.UYARI);
      if ((rank[fromIssues] || 0) > (rank[seviye] || 0)) seviye = fromIssues;
      if (seviye === E_DEFTER_SONUC_SEVIYE.UYGUN) seviye = E_DEFTER_SONUC_SEVIYE.UYARI;
    }
    if ((rank[seviye] || 0) > (rank[worst] || 0)) worst = seviye;
    if (row.grup === E_DEFTER_KONTROL_GRUP.TEKNIK && (row.riskScore || 0) >= 70) {
      worst = E_DEFTER_SONUC_SEVIYE.KRITIK;
    }
  }
  return worst;
}

/** True only when no blocking / unresolved non-info findings remain. */
export function resolveEdefterUygun(rows = [], overallSonuc = E_DEFTER_SONUC_SEVIYE.UYGUN) {
  if (
    overallSonuc === E_DEFTER_SONUC_SEVIYE.KRITIK ||
    overallSonuc === E_DEFTER_SONUC_SEVIYE.UYARI
  ) {
    return false;
  }
  for (const row of rows.filter((r) => !r.disaridaBirak)) {
    if (row.cozumDurumu === E_DEFTER_FINDING_STATUS.COZULDU) continue;
    const details = Array.isArray(row.issueDetails) ? row.issueDetails : [];
    if (details.some((issue) => issue.blocking || issue.severity !== E_DEFTER_ISSUE_SEVERITY.BILGI)) {
      return false;
    }
    if (
      (!details.length && Array.isArray(row.issues) && row.issues.length > 0) ||
      (row.grup &&
        row.grup !== E_DEFTER_KONTROL_GRUP.HATASIZ &&
        row.grup !== E_DEFTER_KONTROL_GRUP.INCELEME_GEREKLI)
    ) {
      // Non-info structural groups (KRITIK/MUKERRER/...) block approval.
      if (
        row.grup === E_DEFTER_KONTROL_GRUP.KRITIK ||
        row.grup === E_DEFTER_KONTROL_GRUP.CAPRAZ ||
        row.grup === E_DEFTER_KONTROL_GRUP.MUKERRER ||
        row.grup === E_DEFTER_KONTROL_GRUP.EKSIK_BILGI ||
        row.grup === E_DEFTER_KONTROL_GRUP.TERS_BAKIYE
      ) {
        return false;
      }
    }
  }
  return (
    overallSonuc === E_DEFTER_SONUC_SEVIYE.UYGUN ||
    overallSonuc === E_DEFTER_SONUC_SEVIYE.BILGI
  );
}

export function canApproveEDefterExport(overallSonuc) {
  return overallSonuc !== E_DEFTER_SONUC_SEVIYE.KRITIK;
}

/** Fiş Kontrol derin bağlantısı — çift kuyruk kopyası yok. */
export function buildFisKontrolDeepLink({ companyId = "", fisNo = "" } = {}) {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", companyId);
  if (fisNo) params.set("fisNo", fisNo);
  params.set("from", "e-defter-kontrol");
  return `/muhasebe/fis-kontrol?${params.toString()}`;
}

/**
 * Muhasebe Hafızasına kör yazma yok. CORE > hafıza.
 * Bu yardımcı yalnızca entegrasyon meta üretir; storage yazmaz.
 */
export function buildEDefterIntegrationHooks({
  rows = [],
  companyId = "",
  coreDecision = null,
} = {}) {
  const criticalFis = rows
    .filter(
      (row) =>
        row.fisNo &&
        (row.grup === E_DEFTER_KONTROL_GRUP.KRITIK ||
          row.sonucSeviye === E_DEFTER_SONUC_SEVIYE.KRITIK ||
          row.riskLevel === E_DEFTER_RISK_LEVEL.KRITIK)
    )
    .map((row) => row.fisNo);

  const uniqueFis = [...new Set(criticalFis)];
  return {
    writeToAccountMemory: false,
    corePriority: true,
    coreOverridesMemory: true,
    coreDecisionSource: coreDecision?.decision_source || coreDecision?.source || null,
    fisKontrolLinks: uniqueFis.map((fisNo) =>
      buildFisKontrolDeepLink({ companyId, fisNo })
    ),
    disclaimer: E_DEFTER_REPORT_DISCLAIMER,
  };
}

export function loadEDefterFingerprintSession() {
  if (typeof window === "undefined") return createFingerprintSession();
  try {
    const raw = JSON.parse(localStorage.getItem(E_DEFTER_FINGERPRINT_STORAGE_KEY) || "[]");
    return createFingerprintSession(Array.isArray(raw) ? raw : []);
  } catch {
    return createFingerprintSession();
  }
}

export function saveEDefterFingerprintSession(session) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      E_DEFTER_FINGERPRINT_STORAGE_KEY,
      JSON.stringify(session.values?.() || [])
    );
  } catch {
    /* ignore quota */
  }
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
  accountPlanCodes = null,
  beratMeta = null,
  packageMeta = {},
  companyTaxId = "",
  coreDecision = null,
  retryToken = "",
}) {
  const mergedRows = [
    ...muavinRows,
    ...yevmiyeRows,
    ...edefterListeRows,
    ...mizanRows,
    ...xmlRows,
  ];

  const yevmiyeOnly = mergedRows.filter(
    (row) =>
      row.kaynak === E_DEFTER_KAYNAK.YEVMIYE ||
      row.kaynak === E_DEFTER_KAYNAK.YEVMIYE_XML
  );
  const kebirOnly = mergedRows.filter((row) => row.kaynak === E_DEFTER_KAYNAK.KEBIR_XML);

  const analyzedRows = analyzeEDefterRows(mergedRows, {
    accountPlanCodes,
    expectedPeriod: period,
  });

  const journalLedger = reconcileJournalLedger(
    yevmiyeOnly.length ? yevmiyeOnly : mergedRows.filter((r) => r.kaynak !== E_DEFTER_KAYNAK.KEBIR_XML && r.kaynak !== E_DEFTER_KAYNAK.MIZAN),
    kebirOnly
  );

  const totals = sumDebitCredit(
    mergedRows.filter((row) => row.kaynak !== E_DEFTER_KAYNAK.MIZAN)
  );
  const totalFindings = [];
  if (
    mergedRows.some((r) => r.kaynak !== E_DEFTER_KAYNAK.MIZAN) &&
    Math.abs(totals.borc - totals.alacak) > BORC_ALACAK_TOLERANCE
  ) {
    totalFindings.push({
      code: E_DEFTER_FINDING_CODE.TOPLAM_BORC_ALACAK,
      message: `Toplam borç/alacak eşit değil: borç=${totals.borc}, alacak=${totals.alacak}`,
      level: E_DEFTER_SONUC_SEVIYE.KRITIK,
    });
  }

  const beratFindings = analyzeBeratMeta(beratMeta, packageMeta, {
    companyTaxId,
    expectedPeriod: period,
  });

  const technicalRows = buildTechnicalFindingRows(
    [...technicalFindings, ...beratFindings, ...totalFindings],
    { companyId, period }
  );
  const crossRows = buildCrossFindingRows(journalLedger.findings, { companyId, period });
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
  const combinedRows = [...analyzedRows, ...technicalRows, ...crossRows, ...vergiselRows].map(
    (row) => ({
      ...row,
      sonucSeviye:
        row.sonucSeviye ||
        mapLegacyLevelToSonuc(row.riskLevel) ||
        sonucSeviyeFromScore(row.riskScore || 0),
    })
  );
  const summary = recalculateEDefterSummary(combinedRows);
  summary.yuklenenDefterSayisi =
    Number(Boolean(muavinRows.length)) +
    Number(Boolean(yevmiyeRows.length)) +
    Number(Boolean(mizanRows.length)) +
    Number(Boolean(xmlRows.length));
  const overallSonuc = resolveOverallSonuc(combinedRows);
  summary.overallSonuc = overallSonuc;
  summary.edefterUygun = resolveEdefterUygun(combinedRows, overallSonuc);
  summary.findingCount = combinedRows.filter(
    (row) =>
      !row.disaridaBirak &&
      ((Array.isArray(row.issueDetails) && row.issueDetails.length > 0) ||
        (Array.isArray(row.issues) && row.issues.length > 0) ||
        row.grup !== E_DEFTER_KONTROL_GRUP.HATASIZ)
  ).length;
  summary.canApproveExport = canApproveEDefterExport(overallSonuc);
  const groupCounts = groupEDefterCounts(combinedRows);
  const hooks = buildEDefterIntegrationHooks({
    rows: combinedRows,
    companyId,
    coreDecision,
  });

  return {
    rows: combinedRows,
    summary,
    groupCounts,
    overallSonuc,
    journalLedger,
    retryToken: retryToken || `retry-${Date.now()}`,
    disclaimer: E_DEFTER_REPORT_DISCLAIMER,
    integrationMeta: {
      source: "e-defter-kontrol-v3",
      fisNolar: combinedRows.map((row) => row.fisNo).filter(Boolean),
      hesapKodlari: combinedRows.map((row) => row.hesapKodu).filter(Boolean),
      belgeNolar: combinedRows.map((row) => row.belgeNo).filter(Boolean),
      kdvMatrahKontrolReady: true,
      kurDegerlemeReady: true,
      lucaAktarimKontrolReady: true,
      muavinMutabakatReady: true,
      ...hooks,
    },
  };
}

/**
 * Tek tuş pipeline: parse edilmiş XML + excel satırları → tam kontrol.
 * Firma/dönem belirsizliğinde karar: dosya meta > seçili UI; çelişkide hata.
 */
export async function runOneClickEDefterKontrol({
  parsedUpload = null,
  muavinRows = [],
  yevmiyeRows = [],
  mizanRows = [],
  edefterListeRows = [],
  companyId = "",
  companyTaxId = "",
  period = "",
  accountPlanCodes = null,
  declarationRecords = [],
  coreDecision = null,
  fingerprintSession = null,
} = {}) {
  if (parsedUpload?.duplicate) {
    return {
      duplicate: true,
      duplicateMessage: parsedUpload.duplicateMessage,
      rows: [],
      summary: {
        overallSonuc: E_DEFTER_SONUC_SEVIYE.BILGI,
        edefterUygun: false,
        canApproveExport: false,
        kritikHata: 0,
        uyariSayisi: 0,
        toplamSatir: 0,
        toplamFis: 0,
        yuklenenDefterSayisi: 0,
        teknikHata: 0,
        vergiselRisk: 0,
        yuksekRisk: 0,
        mukerrerRisk: 0,
        tersBakiye: 0,
        eksikBilgi: 0,
      },
      groupCounts: [],
      overallSonuc: E_DEFTER_SONUC_SEVIYE.BILGI,
      disclaimer: E_DEFTER_REPORT_DISCLAIMER,
    };
  }

  const fileTax = parsedUpload?.packageMeta?.taxId || "";
  const filePeriod = parsedUpload?.packageMeta?.period || "";
  if (companyTaxId && fileTax && normalizeTaxId(companyTaxId) !== normalizeTaxId(fileTax)) {
    const err = new Error("Dosyadaki VKN/TCKN seçili firma ile uyuşmuyor. Analiz durduruldu.");
    err.code = EDEFTER_ERROR_CODE.COMPANY_MISMATCH;
    throw err;
  }

  let resolvedPeriod = period;
  if (!resolvedPeriod && filePeriod) {
    resolvedPeriod = filePeriod.replace("-", "/");
  } else if (resolvedPeriod && filePeriod) {
    const a = normalizePeriodKey(resolvedPeriod.replace("/", "-"));
    const b = normalizePeriodKey(filePeriod);
    if (a && b && a !== b) {
      const err = new Error("Dosya dönemi ile seçili dönem uyuşmuyor.");
      err.code = EDEFTER_ERROR_CODE.MIXED_COMPANY_OR_PERIOD;
      throw err;
    }
  }

  if (fingerprintSession && parsedUpload?.fingerprint) {
    fingerprintSession.add(parsedUpload.fingerprint);
  }

  return runEDefterKontrolPipeline({
    muavinRows,
    yevmiyeRows,
    mizanRows,
    edefterListeRows,
    xmlRows: parsedUpload?.rows || [],
    technicalFindings: parsedUpload?.technicalFindings || [],
    companyId,
    period: resolvedPeriod,
    declarationRecords,
    accountPlanCodes,
    beratMeta: parsedUpload?.beratMeta || null,
    packageMeta: parsedUpload?.packageMeta || {},
    companyTaxId,
    coreDecision,
  });
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
  const mapped = mapLegacyLevelToSonuc(level);
  if (mapped === E_DEFTER_SONUC_SEVIYE.KRITIK || level === E_DEFTER_RISK_LEVEL.KRITIK) return 85;
  if (mapped === E_DEFTER_SONUC_SEVIYE.UYARI || level === E_DEFTER_RISK_LEVEL.YUKSEK) return 65;
  if (mapped === E_DEFTER_SONUC_SEVIYE.BILGI || level === E_DEFTER_RISK_LEVEL.ORTA) return 40;
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

  const sgdpRows = rows.filter((row) =>
    /sgdp|sosyal g[uü]venlik destek/i.test(`${row.aciklama || ""} ${row.hesapAdi || ""}`)
  );
  if (sgdpRows.length || (sgk361 > 0 && /sgdp/i.test(rows.map((r) => r.aciklama).join(" ")))) {
    findings.push({
      message: "361/SGDP risk göstergesi: SGDP prim kaydı ile 361 hesabı birlikte kontrol edilmeli (kesin vergi hükmü değildir).",
      level: E_DEFTER_RISK_LEVEL.ORTA,
      code: "SGDP_361",
      action: "SGDP bordro/tahakkuk ile 361 hareketlerini karşılaştırın.",
    });
  }

  const kasaBanka = sumAccountPrefix(rows, "100") + sumAccountPrefix(rows, "102");
  if (kasaBanka > KASA_BAKIYE_ESIK * 2) {
    findings.push({
      message: "100/102 nakit-banka yüksek hareket risk göstergesi.",
      level: E_DEFTER_RISK_LEVEL.ORTA,
      code: "KASA_BANKA_100_102",
      action: "Kasa ve banka mutabakatını kontrol edin.",
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
    // Geçici UI cache — denetim kaynağı değil; sunucu kaydı asıldır.
    return JSON.parse(localStorage.getItem(E_DEFTER_RECORDS_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveEDefterKontrolRecords(records = []) {
  if (typeof window === "undefined") return;
  // Yalnız geçici cache; başarılı sunucu kaydı sonrası temizlenir.
  localStorage.setItem(E_DEFTER_RECORDS_STORAGE_KEY, JSON.stringify(records));
}

/** Analiz sonucu için güvenli kaynak parmak izi (ham içerik yok). */
export function buildEDefterResultFingerprints({
  sourceFingerprint = "",
  journalRows = [],
  ledgerRows = [],
  companyId = "",
  period = "",
  summary = {},
} = {}) {
  const journalKey = journalRows
    .slice(0, 5000)
    .map((r) => `${r.fisNo}|${r.yevmiyeNo}|${r.hesapKodu}|${r.borc}|${r.alacak}`)
    .join(";");
  const ledgerKey = ledgerRows
    .slice(0, 5000)
    .map((r) => `${r.fisNo}|${r.yevmiyeNo}|${r.hesapKodu}|${r.borc}|${r.alacak}`)
    .join(";");
  const fallbackSource = buildContentFingerprint(
    `${companyId}|${period}|${summary.overallSonuc || ""}|${summary.toplamSatir || 0}|${summary.kritikHata || 0}|${journalKey.slice(0, 2000)}`
  );
  return {
    source: sourceFingerprint || fallbackSource,
    journal: journalKey ? buildContentFingerprint(journalKey) : "",
    ledger: ledgerKey ? buildContentFingerprint(ledgerKey) : "",
  };
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
