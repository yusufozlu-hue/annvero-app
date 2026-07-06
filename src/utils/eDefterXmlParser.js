import JSZip from "jszip";
import { E_DEFTER_KAYNAK } from "@/src/config/eDefterKontrolDefaults";
import { formatDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";

function localName(node) {
  return String(node?.localName || node?.nodeName || "").replace(/^.*:/, "");
}

function textOf(parent, names = []) {
  if (!parent) return "";
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const walker = parent.getElementsByTagName("*");
  for (const node of walker) {
    const name = localName(node).toLowerCase();
    if (wanted.has(name) && node.textContent?.trim()) {
      return node.textContent.trim();
    }
  }
  return "";
}

function parseXmlDocument(xmlText = "") {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("XML dosyası okunamadı veya bozuk.");
  }
  return doc;
}

function detectDefterType(fileName = "", xmlText = "") {
  const lower = fileName.toLowerCase();
  const content = xmlText.toLowerCase();
  if (lower.includes("berat") || content.includes("berat")) return "berat";
  if (lower.includes("kebir") || content.includes("kebir") || content.includes("ledger")) {
    return "kebir";
  }
  return "yevmiye";
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
  const yevmiyeNo = textOf(entryNode, ["lineNumber", "yevmiyeNo", "yevmiyeNumber", "entryLineNumber"]);
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
    cariUnvan: aciklama,
    tutar: amount,
    kontrolDurumu: "",
    not: "",
    duzeltildiMi: false,
    disaridaBirak: false,
    manuallyEdited: false,
  };
}

export function parseEDefterXmlText(xmlText = "", fileName = "") {
  const doc = parseXmlDocument(xmlText);
  const defterType = detectDefterType(fileName, xmlText);
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

  const beratMeta = {
    readable: true,
    defterType,
    entryCount: rows.length,
    beratId: textOf(doc.documentElement, ["beratId", "beratNo", "uuid", "id"]),
    period: textOf(doc.documentElement, ["periodCoveredStart", "period", "donem"]),
  };

  return { rows, meta: beratMeta, defterType };
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
        level: "Yüksek",
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
        level: "Orta",
      });
      break;
    }
  }

  for (const [fisNo, totals] of fisTotals.entries()) {
    if (!totals.hasLine) {
      findings.push({
        code: "BOS_FIS",
        message: `Boş fiş: ${fisNo}`,
        level: "Yüksek",
      });
    }
    if (Math.abs(totals.borc - totals.alacak) > 0.05) {
      findings.push({
        code: "FIS_DENGESIZ",
        message: `Borç/alacak eşitliği bozuk fiş: ${fisNo}`,
        level: "Kritik",
      });
    }
  }

  const sortedDates = fisDates
    .map((item) => ({ ...item, time: Date.parse(item.tarih.split(".").reverse().join("-")) || 0 }))
    .sort((a, b) => a.fisNo.localeCompare(b.fisNo, "tr"));
  for (let index = 1; index < sortedDates.length; index += 1) {
    if (sortedDates[index].time < sortedDates[index - 1].time) {
      findings.push({
        code: "TARIH_SIRASI",
        message: `Tarih sırası bozuk: ${sortedDates[index].fisNo}`,
        level: "Orta",
      });
      break;
    }
  }

  if (!meta.readable) {
    findings.unshift({
      code: "XML_OKUNAMADI",
      message: "XML dosyası okunamadı.",
      level: "Kritik",
    });
  }

  return findings;
}

export async function parseEDefterUploadFile(file) {
  const fileName = file?.name || "";
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const xmlFiles = Object.values(zip.files).filter(
      (entry) => !entry.dir && entry.name.toLowerCase().endsWith(".xml")
    );
    const beratFiles = xmlFiles.filter((entry) => entry.name.toLowerCase().includes("berat"));
    const ledgerFiles = xmlFiles.filter((entry) => !entry.name.toLowerCase().includes("berat"));

    let allRows = [];
    const technicalFindings = [];
    let beratMeta = null;

    for (const entry of ledgerFiles) {
      const xmlText = await entry.async("text");
      try {
        const parsed = parseEDefterXmlText(xmlText, entry.name);
        allRows = [...allRows, ...parsed.rows];
        technicalFindings.push(...analyzeEDefterXmlTechnical(parsed.rows, parsed.meta));
      } catch (error) {
        technicalFindings.push({
          code: "XML_BOZUK",
          message: `${entry.name}: ${error.message}`,
          level: "Kritik",
        });
      }
    }

    if (beratFiles.length) {
      const beratText = await beratFiles[0].async("text");
      try {
        beratMeta = parseEDefterXmlText(beratText, beratFiles[0].name).meta;
      } catch {
        technicalFindings.push({
          code: "BERAT_ESLESMEDI",
          message: "Berat dosyası okunamadı.",
          level: "Kritik",
        });
      }
    } else {
      technicalFindings.push({
        code: "BERAT_ESLESMEDI",
        message: "ZIP içinde berat dosyası bulunamadı.",
        level: "Yüksek",
      });
    }

    if (beratMeta && allRows.length === 0) {
      technicalFindings.push({
        code: "BERAT_ESLESMEDI",
        message: "Berat var ancak yevmiye/kebir satırı çıkarılamadı.",
        level: "Yüksek",
      });
    }

    return {
      rows: allRows,
      technicalFindings,
      defterType: "ZIP",
      beratMeta,
      fileName,
    };
  }

  if (lower.endsWith(".xml")) {
    const xmlText = await file.text();
    try {
      const parsed = parseEDefterXmlText(xmlText, fileName);
      return {
        rows: parsed.rows,
        technicalFindings: analyzeEDefterXmlTechnical(parsed.rows, parsed.meta),
        defterType: parsed.defterType,
        beratMeta: parsed.meta,
        fileName,
      };
    } catch (error) {
      return {
        rows: [],
        technicalFindings: [
          { code: "XML_BOZUK", message: error.message, level: "Kritik" },
        ],
        defterType: detectDefterType(fileName, xmlText),
        beratMeta: { readable: false },
        fileName,
      };
    }
  }

  throw new Error("Desteklenmeyen dosya türü. XML veya ZIP yükleyin.");
}
