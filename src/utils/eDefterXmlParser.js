import JSZip from "jszip";
import { E_DEFTER_KAYNAK } from "@/src/config/eDefterKontrolDefaults";
import { formatDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import {
  EDEFTER_ERROR_CODE,
  assertCompanyTaxMatch,
  assertRowLimit,
  assertSafeZipEntries,
  assertUploadSize,
  buildContentFingerprint,
  createParseAbortGuard,
  extractPeriodFromText,
  extractTaxIdFromText,
  makeEDefterError,
  normalizePeriodKey,
  normalizeTaxId,
  rejectXxePayload,
} from "@/src/utils/eDefterSecurity";

function localName(node) {
  return String(node?.localName || node?.nodeName || "").replace(/^.*:/, "");
}

/**
 * Node ortamında DOMParser yoksa minimal, XXE'siz XML ağacı.
 * Yalnızca etiket/metin; ENTITY/DOCTYPE zaten rejectXxe ile engellenir.
 */
function createMinimalDomFromXml(xmlText = "") {
  const cleaned = String(xmlText || "")
    .replace(/<\?xml[^?]*\?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  class MiniNode {
    constructor(name, attrs = {}) {
      this.nodeName = name;
      this.localName = name.replace(/^.*:/, "");
      this.attributes = attrs;
      this.childNodes = [];
      this.parentNode = null;
      this._text = "";
    }
    get textContent() {
      if (this._text) return this._text;
      return this.childNodes.map((c) => c.textContent).join("");
    }
    set textContent(v) {
      this._text = String(v || "");
      this.childNodes = [];
    }
    getElementsByTagName(tag) {
      const wanted = String(tag || "*").toLowerCase();
      const out = [];
      const walk = (n) => {
        if (!n || !n.nodeName || n.nodeName === "#text") return;
        const name = localName(n).toLowerCase();
        if (wanted === "*" || name === wanted || n.nodeName.toLowerCase() === wanted) {
          out.push(n);
        }
        for (const c of n.childNodes) walk(c);
      };
      walk(this);
      return out;
    }
    querySelector(sel) {
      if (sel === "parsererror") return null;
      return null;
    }
  }

  const root = new MiniNode("document");
  const stack = [root];
  const tagRe = /<\/?([A-Za-z_][\w:.-]*)([^>]*)>|([^<]+)/g;
  let match;
  while ((match = tagRe.exec(cleaned))) {
    if (match[3] != null) {
      const text = match[3].replace(/\s+/g, " ").trim();
      if (!text) continue;
      const textNode = new MiniNode("#text");
      textNode._text = text;
      textNode.nodeName = "#text";
      textNode.localName = "#text";
      stack[stack.length - 1].childNodes.push(textNode);
      continue;
    }
    const name = match[1];
    const attrsRaw = match[2] || "";
    const isClose = String(match[0]).startsWith("</");
    const selfClose = /\/>\s*$/.test(match[0]);
    if (isClose) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = {};
    const attrRe = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let am;
    while ((am = attrRe.exec(attrsRaw))) {
      attrs[am[1]] = am[3] ?? am[4] ?? "";
    }
    const node = new MiniNode(name, attrs);
    stack[stack.length - 1].childNodes.push(node);
    node.parentNode = stack[stack.length - 1];
    if (!selfClose) stack.push(node);
  }

  const documentElement =
    root.childNodes.find((n) => n.nodeName && n.nodeName !== "#text") || root;

  return {
    documentElement,
    getElementsByTagName: (tag) => documentElement.getElementsByTagName(tag),
    querySelector: (sel) => (sel === "parsererror" ? null : null),
  };
}

function parseXmlDocument(xmlText = "") {
  const safe = rejectXxePayload(xmlText);
  if (typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const doc = parser.parseFromString(safe, "application/xml");
    const parseError = doc.querySelector?.("parsererror");
    if (parseError) {
      throw makeEDefterError(
        EDEFTER_ERROR_CODE.XML_BOZUK,
        "XML dosyası okunamadı veya bozuk."
      );
    }
    return doc;
  }
  if (!safe.trim() || !/<[A-Za-z_]/.test(safe)) {
    throw makeEDefterError(EDEFTER_ERROR_CODE.XML_BOZUK, "XML dosyası okunamadı veya bozuk.");
  }
  // Unclosed root / truncated payload
  const openTags = (safe.match(/<[A-Za-z_][\w:.-]*[^>/]*>/g) || []).length;
  const closeTags = (safe.match(/<\/[A-Za-z_][\w:.-]*>/g) || []).length;
  const selfClose = (safe.match(/<[A-Za-z_][\w:.-]*[^>]*\/>/g) || []).length;
  if (openTags > closeTags + selfClose + 2) {
    throw makeEDefterError(EDEFTER_ERROR_CODE.XML_BOZUK, "XML dosyası okunamadı veya bozuk.");
  }
  if (/<[^>]*$/.test(safe.trim())) {
    throw makeEDefterError(EDEFTER_ERROR_CODE.XML_BOZUK, "XML dosyası okunamadı veya bozuk.");
  }
  return createMinimalDomFromXml(safe);
}

function detectDefterType(fileName = "", xmlText = "", rootName = "") {
  const lower = String(fileName || "").toLowerCase();
  const content = String(xmlText || "").toLowerCase();
  const root = String(rootName || "").toLowerCase();

  const contentHints = {
    berat:
      content.includes("berat") ||
      content.includes("ledgerbookinstance") ||
      root.includes("berat") ||
      /defter\s*t[uü]r[uü][^<]{0,40}berat/i.test(xmlText),
    kebir:
      content.includes("kebir") ||
      content.includes("generalledger") ||
      content.includes("ledgerentries") ||
      root.includes("kebir") ||
      root.includes("ledger"),
    yevmiye:
      content.includes("yevmiye") ||
      content.includes("journal") ||
      content.includes("entryheader") ||
      root.includes("journal") ||
      root.includes("yevmiye"),
  };

  if (contentHints.berat || lower.includes("berat")) return "berat";
  if (contentHints.kebir && !contentHints.yevmiye) return "kebir";
  if (contentHints.yevmiye && !contentHints.kebir) return "yevmiye";
  if (contentHints.kebir || lower.includes("kebir") || lower.includes("ledger")) return "kebir";
  if (contentHints.yevmiye || lower.includes("yevmiye") || lower.includes("journal")) {
    return "yevmiye";
  }
  if (lower.includes("berat")) return "berat";
  return "yevmiye";
}

function textOf(parent, names = []) {
  if (!parent) return "";
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const walker = parent.getElementsByTagName?.("*") || [];
  for (const node of walker) {
    const name = localName(node).toLowerCase();
    if (wanted.has(name) && node.textContent?.trim()) {
      return node.textContent.trim();
    }
  }
  return "";
}

function mapEntryToRow(entryNode, index, kaynak) {
  const tarih = formatDateTR(
    textOf(entryNode, [
      "enteredDate",
      "postingDate",
      "documentDate",
      "tarih",
      "fisTarihi",
      "entryDate",
    ])
  );
  const fisNo = textOf(entryNode, ["entryNumber", "fisNo", "fisNumber", "journalNumber"]);
  const yevmiyeNo = textOf(entryNode, [
    "lineNumber",
    "yevmiyeNo",
    "yevmiyeNumber",
    "entryLineNumber",
  ]);
  const hesapKodu = textOf(entryNode, [
    "accountMainID",
    "accountSubID",
    "accountCode",
    "hesapKodu",
    "accountID",
  ]);
  const hesapAdi = textOf(entryNode, ["accountDescription", "accountName", "hesapAdi"]);
  const aciklama = textOf(entryNode, ["entryComment", "detailComment", "description", "aciklama"]);
  const belgeNo = textOf(entryNode, ["documentNumber", "documentReference", "belgeNo", "evrakNo"]);
  const belgeTuru = textOf(entryNode, ["documentType", "belgeTuru", "evrakTuru"]);
  // Cari/party is a distinct field — never invent from explanation text.
  const cariUnvan = textOf(entryNode, [
    "payeeName",
    "payerName",
    "counterpartyName",
    "partyName",
    "cariUnvan",
    "cariAdi",
    "unvan",
    "vendorName",
    "customerName",
  ]);
  const amountText = textOf(entryNode, ["amount", "tutar", "lineAmount"]);
  const debitCredit = textOf(entryNode, ["debitCreditCode", "debitCreditIndicator", "dc"]);
  const amount = parseMoneyTR(amountText);
  const isDebit = /^d|borc|debit|1$/i.test(debitCredit);

  if (!tarih && !fisNo && !hesapKodu && !amount) return null;

  return {
    id: `${kaynak}-${index + 1}`,
    kaynak,
    tarih,
    fisNo,
    yevmiyeNo,
    hesapKodu,
    hesapAdi,
    aciklama,
    belgeTuru,
    belgeNo,
    belgeTarihi: tarih,
    borc: isDebit ? amount : 0,
    alacak: isDebit ? 0 : amount,
    cariUnvan,
    tutar: amount,
    kontrolDurumu: "",
    not: "",
    duzeltildiMi: false,
    disaridaBirak: false,
    manuallyEdited: false,
  };
}

function majorityPeriodFromRows(rows = []) {
  const buckets = new Map();
  for (const row of rows) {
    const raw = String(row?.tarih || row?.yevmiyeTarihi || row?.fisTarihi || "").trim();
    if (!raw) continue;
    // Accept YYYY-MM / YYYY/MM / DD.MM.YYYY / DD/MM/YYYY
    let key = "";
    const iso = raw.match(/(20\d{2})[-/.](0?[1-9]|1[0-2])/);
    if (iso) key = `${iso[1]}-${String(iso[2]).padStart(2, "0")}`;
    else {
      const tr = raw.match(/(0?[1-9]|[12]\d|3[01])[./](0?[1-9]|1[0-2])[./](20\d{2})/);
      if (tr) key = `${tr[3]}-${String(tr[2]).padStart(2, "0")}`;
    }
    if (!key) continue;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [k, n] of buckets) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

function extractPackageMeta(xmlText = "", doc = null, rows = []) {
  const taxId =
    extractTaxIdFromText(xmlText) ||
    (doc
      ? textOf(doc.documentElement, [
          "vkn",
          "tckn",
          "taxId",
          "identifier",
          "uniqueID",
          "taxpayerId",
        ])
      : "");
  // Structured tags first — full-text scan often hits schema/example years (e.g. 2000-09).
  const structuredRaw =
    (doc
      ? textOf(doc.documentElement, [
          "periodCoveredStart",
          "periodCoveredEnd",
          "period",
          "donem",
          "fiscalYear",
          "accountingPeriod",
        ])
      : "") || "";
  const structured = normalizePeriodKey(structuredRaw);
  const fromRows = majorityPeriodFromRows(rows);
  const fromText = normalizePeriodKey(extractPeriodFromText(xmlText) || "");

  let period = structured || fromRows || fromText || "";
  let periodSource = structured ? "structured" : fromRows ? "entry_majority" : fromText ? "fulltext" : "none";
  let periodHeaderMismatch = false;

  // If header period conflicts with dominant entry month, prefer entries for control
  // and surface a technical finding (header may be wrong / multi-month pack).
  if (structured && fromRows && structured !== fromRows) {
    period = fromRows;
    periodSource = "entry_majority_override";
    periodHeaderMismatch = true;
  }

  return {
    taxId: normalizeTaxId(taxId),
    period,
    periodSource,
    periodHeaderMismatch,
  };
}

export function parseEDefterXmlText(xmlText = "", fileName = "", options = {}) {
  const doc = parseXmlDocument(xmlText);
  const rootName = localName(doc.documentElement);
  const defterType = detectDefterType(fileName, xmlText, rootName);
  const kaynak =
    defterType === "kebir"
      ? E_DEFTER_KAYNAK.KEBIR_XML
      : defterType === "berat"
        ? E_DEFTER_KAYNAK.BERAT
        : E_DEFTER_KAYNAK.YEVMIYE_XML;

  const entryNodes = [];
  const allNodes = doc.getElementsByTagName("*");
  for (const node of allNodes) {
    const name = localName(node).toLowerCase();
    if (
      name.includes("entrydetail") ||
      name.includes("entryline") ||
      name === "entry" ||
      name.includes("journaldetail")
    ) {
      entryNodes.push(node);
    }
  }

  const rows = entryNodes
    .map((node, index) => mapEntryToRow(node, index, kaynak))
    .filter(Boolean);

  assertRowLimit(rows.length);

  const packageMeta = extractPackageMeta(xmlText, doc, rows);
  const beratMeta = {
    readable: true,
    defterType,
    entryCount: rows.length,
    beratId: textOf(doc.documentElement, ["beratId", "beratNo", "uuid", "id"]),
    period: packageMeta.period || textOf(doc.documentElement, ["periodCoveredStart", "period", "donem"]),
    taxId: packageMeta.taxId,
    rootName,
    contentDetected: true,
  };

  if (!options.deferIdentityAssert && options.companyTaxId !== undefined) {
    assertCompanyTaxMatch(packageMeta.taxId, options.companyTaxId || "", {
      companyId: options.companyId || "",
      sourceKind: "xml",
    });
  }

  return { rows, meta: beratMeta, defterType, packageMeta };
}

export function analyzeEDefterXmlTechnical(rows = [], meta = {}) {
  const findings = [];
  const yevmiyeMap = new Map();
  const fisTotals = new Map();
  const fisDates = [];

  rows.forEach((row) => {
    if (row.yevmiyeNo) {
      const key = String(row.yevmiyeNo);
      yevmiyeMap.set(key, (yevmiyeMap.get(key) || 0) + 1);
    }
    if (row.fisNo) {
      const key = String(row.fisNo);
      const current = fisTotals.get(key) || { borc: 0, alacak: 0, hasLine: false };
      current.borc += Number(row.borc || 0);
      current.alacak += Number(row.alacak || 0);
      current.hasLine = current.hasLine || Boolean(row.hesapKodu || row.aciklama);
      fisTotals.set(key, current);
      if (row.tarih) fisDates.push({ fisNo: key, tarih: row.tarih });
    }
  });

  for (const [yevmiyeNo, count] of yevmiyeMap.entries()) {
    if (count > 1) {
      findings.push({
        code: "MUKERRER_YEVMIYE",
        message: `Mükerrer yevmiye numarası: ${yevmiyeNo}`,
        level: "Uyarı",
      });
    }
  }

  const numericYevmiye = [...yevmiyeMap.keys()]
    .map((value) => Number(String(value).replace(/\D/g, "")))
    .filter((value) => !Number.isNaN(value))
    .sort((a, b) => a - b);

  for (let index = 1; index < numericYevmiye.length; index += 1) {
    if (numericYevmiye[index] - numericYevmiye[index - 1] > 1) {
      findings.push({
        code: "EKSIK_YEVMIYE",
        message: `Eksik yevmiye numarası: ${numericYevmiye[index - 1]} ile ${numericYevmiye[index]} arası`,
        level: "Uyarı",
      });
      break;
    }
  }

  for (const [fisNo, totals] of fisTotals.entries()) {
    if (!totals.hasLine) {
      findings.push({
        code: "BOS_FIS",
        message: `Boş fiş: ${fisNo}`,
        level: "Uyarı",
      });
    }
    if (Math.abs(totals.borc - totals.alacak) > 0.05) {
      findings.push({
        code: "FIS_DENGESIZ",
        message: `Borç/alacak eşitliği bozuk fiş: ${fisNo}`,
        level: "Kritik hata",
      });
    }
  }

  const sortedDates = fisDates
    .map((item) => ({
      ...item,
      time: Date.parse(item.tarih.split(".").reverse().join("-")) || 0,
    }))
    .sort((a, b) => a.fisNo.localeCompare(b.fisNo, "tr"));
  for (let index = 1; index < sortedDates.length; index += 1) {
    if (sortedDates[index].time < sortedDates[index - 1].time) {
      findings.push({
        code: "TARIH_SIRASI",
        message: `Tarih sırası bozuk: ${sortedDates[index].fisNo}`,
        level: "Uyarı",
      });
      break;
    }
  }

  if (!meta.readable) {
    findings.unshift({
      code: "XML_OKUNAMADI",
      message: "XML dosyası okunamadı.",
      level: "Kritik hata",
    });
  }

  return findings;
}

function detectBufferKind(arrayBuffer, fileName = "") {
  const lower = String(fileName || "").toLowerCase();
  const bytes = new Uint8Array(arrayBuffer || new ArrayBuffer(0));
  const isZipMagic =
    bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
  const head = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 200))).trim();
  const looksXml = head.startsWith("<") || head.startsWith("<?xml");
  if (isZipMagic || lower.endsWith(".zip")) return "zip";
  if (looksXml || lower.endsWith(".xml")) return "xml";
  return "unknown";
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @param {string} fileName
 * @param {{
 *   companyTaxId?: string,
 *   expectedPeriod?: string,
 *   signal?: AbortSignal,
 *   timeoutMs?: number,
 *   knownFingerprints?: Set<string>| { has(fp:string): boolean, add?(fp:string): void },
 *   skipDedup?: boolean,
 * }} [options]
 */
export async function parseEDefterUploadBuffer(arrayBuffer, fileName = "", options = {}) {
  const byteLength = arrayBuffer?.byteLength ?? 0;
  assertUploadSize(byteLength);

  const guard = createParseAbortGuard({
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  guard.check();

  const fingerprint = buildContentFingerprint(arrayBuffer);
  if (!options.skipDedup && options.knownFingerprints?.has?.(fingerprint)) {
    return {
      rows: [],
      technicalFindings: [],
      defterType: "duplicate",
      beratMeta: null,
      fileName,
      fingerprint,
      duplicate: true,
      duplicateMessage: "Mükerrer E-Defter dosyası — yeniden işlenmedi",
      packageMeta: { taxId: "", period: "" },
    };
  }

  const kind = detectBufferKind(arrayBuffer, fileName);
  if (kind === "unknown") {
    throw makeEDefterError(
      EDEFTER_ERROR_CODE.UNSUPPORTED,
      "Desteklenmeyen dosya türü. XML veya ZIP yükleyin."
    );
  }

  const taxIds = new Set();
  const periods = new Set();

  const trackMeta = (packageMeta = {}, defterType = "") => {
    if (packageMeta.taxId) taxIds.add(packageMeta.taxId);
    // Berat metadata period often disagrees with entry majority; do not trip mixed-period gate.
    const isLedger = defterType === "yevmiye" || defterType === "kebir";
    if (isLedger && packageMeta.period) {
      periods.add(normalizePeriodKey(packageMeta.period));
    }
  };

  const finalizeMixedCheck = () => {
    if (taxIds.size > 1 || periods.size > 1) {
      throw makeEDefterError(
        EDEFTER_ERROR_CODE.MIXED_COMPANY_OR_PERIOD,
        "Aynı pakette birden fazla firma veya dönem tespit edildi. Analiz durduruldu."
      );
    }
  };

  if (kind === "zip") {
    let zip;
    try {
      zip = await JSZip.loadAsync(arrayBuffer);
    } catch {
      throw makeEDefterError(
        EDEFTER_ERROR_CODE.ENCRYPTED,
        "ZIP açılamadı. Dosya bozuk veya şifreli olabilir."
      );
    }
    guard.check();
    assertSafeZipEntries(zip.files, byteLength);

    const xmlFiles = Object.values(zip.files).filter(
      (entry) => !entry.dir && entry.name.toLowerCase().endsWith(".xml")
    );
    if (!xmlFiles.length) {
      throw makeEDefterError(
        EDEFTER_ERROR_CODE.UNSUPPORTED,
        "ZIP içinde XML dosyası bulunamadı."
      );
    }

    let allRows = [];
    const technicalFindings = [];
    let beratMeta = null;
    let primaryType = "ZIP";

    for (const entry of xmlFiles) {
      guard.check();
      const xmlText = await entry.async("text");
      rejectXxePayload(xmlText);
      try {
        const parsed = parseEDefterXmlText(xmlText, entry.name, {
          companyTaxId: options.companyTaxId,
          companyId: options.companyId,
          deferIdentityAssert: true,
        });
        trackMeta(parsed.packageMeta, parsed.defterType);
        if (parsed.defterType === "berat") {
          beratMeta = parsed.meta;
          technicalFindings.push({
            code: EDEFTER_ERROR_CODE.EXTERNAL_VERIFICATION_REQUIRED,
            message:
              "Berat dosyası okundu; GİB/mali mühür kriptografik doğrulaması bu ortamda yapılmaz. Harici doğrulama gerekir.",
            level: "Bilgi",
          });
        } else {
          allRows = [...allRows, ...parsed.rows];
          if (parsed.packageMeta?.periodHeaderMismatch) {
            technicalFindings.push({
              code: "PERIOD_HEADER_MISMATCH",
              message:
                "Paket dönem başlığı ile satır tarihlerinin çoğunluğu uyuşmuyor; kontrol dönemi satır çoğunluğuna göre alındı (inceleme bilgisi).",
              level: "Bilgi",
            });
          }
          technicalFindings.push(...analyzeEDefterXmlTechnical(parsed.rows, parsed.meta));
          primaryType = parsed.defterType === "kebir" ? "kebir" : primaryType === "ZIP" ? "yevmiye" : primaryType;
        }
      } catch (error) {
        if (
          error?.code === EDEFTER_ERROR_CODE.COMPANY_MISMATCH ||
          error?.code === EDEFTER_ERROR_CODE.MIXED_COMPANY_OR_PERIOD ||
          error?.code === EDEFTER_ERROR_CODE.XXE_REJECTED ||
          error?.code === EDEFTER_ERROR_CODE.COMPANY_IDENTITY_MISSING ||
          error?.code === EDEFTER_ERROR_CODE.DOCUMENT_IDENTITY_MISSING ||
          error?.code === EDEFTER_ERROR_CODE.IDENTITY_INVALID ||
          error?.code === EDEFTER_ERROR_CODE.IDENTITY_TYPE_CONFLICT ||
          error?.code === EDEFTER_ERROR_CODE.IDENTITY_AMBIGUOUS
        ) {
          throw error;
        }
        throw makeEDefterError(
          error?.code || EDEFTER_ERROR_CODE.XML_BOZUK,
          error?.message || "XML dosyası okunamadı veya bozuk."
        );
      }
    }

    finalizeMixedCheck();
    assertRowLimit(allRows.length);

    if (options.companyTaxId !== undefined) {
      assertCompanyTaxMatch([...taxIds][0] || "", options.companyTaxId || "", {
        companyId: options.companyId || "",
        documentTaxIds: [...taxIds],
        sourceKind: "zip",
      });
    }

    if (!beratMeta) {
      technicalFindings.push({
        code: "BERAT_ESLESMEDI",
        message: "ZIP içinde berat dosyası bulunamadı (inceleme bilgisi).",
        level: "Bilgi",
      });
    }

    if (beratMeta && allRows.length === 0) {
      technicalFindings.push({
        code: "BERAT_ESLESMEDI",
        message: "Berat var ancak yevmiye/kebir satırı çıkarılamadı.",
        level: "Uyarı",
      });
    }

    options.knownFingerprints?.add?.(fingerprint);

    return {
      rows: allRows,
      technicalFindings,
      defterType: primaryType === "ZIP" ? "ZIP" : primaryType,
      beratMeta,
      fileName,
      fingerprint,
      duplicate: false,
      packageMeta: {
        taxId: [...taxIds][0] || "",
        period: [...periods][0] || "",
      },
    };
  }

  // XML
  const xmlText = new TextDecoder().decode(arrayBuffer);
  rejectXxePayload(xmlText);
  guard.check();

  let parsed;
  try {
    parsed = parseEDefterXmlText(xmlText, fileName, {
      companyTaxId: options.companyTaxId,
      companyId: options.companyId,
    });
  } catch (error) {
    if (error?.code) throw error;
    throw makeEDefterError(
      EDEFTER_ERROR_CODE.XML_BOZUK,
      error?.message || "XML dosyası okunamadı veya bozuk."
    );
  }

  trackMeta(parsed.packageMeta, parsed.defterType);
  finalizeMixedCheck();

  const technicalFindings = analyzeEDefterXmlTechnical(parsed.rows, parsed.meta);
  if (parsed.packageMeta?.periodHeaderMismatch) {
    technicalFindings.push({
      code: "PERIOD_HEADER_MISMATCH",
      message:
        "Paket dönem başlığı ile satır tarihlerinin çoğunluğu uyuşmuyor; kontrol dönemi satır çoğunluğuna göre alındı (inceleme bilgisi).",
      level: "Bilgi",
    });
  }
  if (parsed.defterType === "berat") {
    technicalFindings.push({
      code: EDEFTER_ERROR_CODE.EXTERNAL_VERIFICATION_REQUIRED,
      message:
        "Berat dosyası okundu; GİB/mali mühür kriptografik doğrulaması bu ortamda yapılmaz. Harici doğrulama gerekir.",
      level: "Bilgi",
    });
  }

  options.knownFingerprints?.add?.(fingerprint);

  return {
    rows: parsed.rows,
    technicalFindings,
    defterType: parsed.defterType,
    beratMeta: parsed.meta,
    fileName,
    fingerprint,
    duplicate: false,
    packageMeta: parsed.packageMeta,
  };
}

export async function parseEDefterUploadFile(file, options = {}) {
  const fileName = file?.name || "";
  const arrayBuffer = await file.arrayBuffer();
  return parseEDefterUploadBuffer(arrayBuffer, fileName, options);
}
