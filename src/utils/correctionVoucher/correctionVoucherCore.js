/**
 * Kaynak fiş meta, referans ve açıklama — recipe/draft motorundan bağımsız çekirdek.
 */
import { formatDateTR, parseDateTR } from "@/src/utils/formatDateTR";
import { parseYevmiyeBlockHeaderCell } from "@/src/utils/eDefterKontrolEngine";

function compactFisNo(value = "") {
  return String(value ?? "").trim();
}

function uniqueNonEmpty(values = []) {
  return [
    ...new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    ),
  ];
}

const SOURCE_DOCUMENT_TOKEN_RE =
  /\b(YEF\d{10,}|[A-Z]{2,5}\d{8,})\b/i;

function extractDocumentToken(text = "") {
  const match = String(text || "").match(SOURCE_DOCUMENT_TOKEN_RE);
  return match ? match[1].toUpperCase() : "";
}

function rowDocumentCandidates(row = {}) {
  const direct = uniqueNonEmpty([
    row.belgeNo,
    row.evrakNo,
    row.documentNo,
    row.belge_no,
  ]);
  if (direct.length) return direct;
  const token = extractDocumentToken(row.aciklama || row.detayAciklama || "");
  return token ? [token] : [];
}

function fisNoMatches(rowFis = "", needle = "") {
  const left = compactFisNo(rowFis);
  const right = compactFisNo(needle);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftNum = left.replace(/^0+/, "") || "0";
  const rightNum = right.replace(/^0+/, "") || "0";
  return leftNum === rightNum && /^\d+$/.test(leftNum);
}

/** Tek canonical DD.MM.YYYY — geçersizse boş. */
export function canonicalLedgerDateTR(value = "") {
  if (value === null || value === undefined || value === "") return "";
  const formatted = formatDateTR(value);
  if (!formatted) return "";
  if (!parseDateTR(formatted)) return "";
  return formatted;
}

function collectDateCandidates(values = []) {
  const canonical = uniqueNonEmpty(
    values
      .map((value) => canonicalLedgerDateTR(value))
      .filter(Boolean)
  );
  return canonical;
}

function rowDateCandidates(row = {}) {
  return [
    row.tarih,
    row.fisTarihi,
    row.belgeTarihi,
    row.evrakTarihi,
  ];
}

function blockHeaderDateFromRow(row = {}) {
  const texts = uniqueNonEmpty([
    row.aciklama,
    row.detayAciklama,
    row.fisAciklama,
    row.blockHeader,
  ]);
  for (const text of texts) {
    const header = parseYevmiyeBlockHeaderCell(text);
    if (header?.tarih) {
      const canonical = canonicalLedgerDateTR(header.tarih);
      if (canonical) return canonical;
    }
  }
  return "";
}

/**
 * Kaynak fiş tarihi — öncelik:
 * 1) aynı fişe ait yevmiye/muavin hareket tarihleri
 * 2) bulgu.tarih
 * 3) Luca block header parse (aciklama vb.)
 */
export function resolveSourceVoucherDate({
  fisRows = [],
  allRows = [],
  fisNo = "",
  finding = null,
} = {}) {
  const needle = compactFisNo(fisNo);
  const sameFisAll = (allRows.length ? allRows : fisRows).filter((row) =>
    fisNoMatches(row.fisNo, needle)
  );

  const movementDates = collectDateCandidates(
    sameFisAll.flatMap((row) => rowDateCandidates(row))
  );
  if (movementDates.length === 1) {
    return { ok: true, value: movementDates[0], source: "MOVEMENT" };
  }
  if (movementDates.length > 1) {
    return {
      ok: false,
      reason: "AMBIGUOUS_DATE",
      message:
        "Kaynak fiş tarihi birden fazla değer içeriyor; otomatik düzeltme üretilmez.",
    };
  }

  const findingDate = canonicalLedgerDateTR(finding?.tarih);
  if (findingDate) {
    return { ok: true, value: findingDate, source: "FINDING" };
  }

  const headerDates = collectDateCandidates(
    sameFisAll.map((row) => blockHeaderDateFromRow(row)).filter(Boolean)
  );
  if (headerDates.length === 1) {
    return { ok: true, value: headerDates[0], source: "BLOCK_HEADER" };
  }
  if (headerDates.length > 1) {
    return {
      ok: false,
      reason: "AMBIGUOUS_DATE",
      message:
        "Kaynak fiş tarihi birden fazla değer içeriyor; otomatik düzeltme üretilmez.",
    };
  }

  return {
    ok: false,
    reason: "DATE_MISSING",
    message: "Kaynak fiş tarihi belirlenemedi.",
  };
}

function resolveVoucherDocumentNo(rows = []) {
  const direct = uniqueNonEmpty(rows.flatMap((row) => rowDocumentCandidates(row)));
  if (direct.length === 1) {
    return { ok: true, value: direct[0] };
  }
  if (direct.length > 1) {
    return {
      ok: false,
      reason: "AMBIGUOUS_DOCUMENT",
      message:
        "Kaynak belge numarası birden fazla aday içeriyor; otomatik düzeltme üretilmez.",
    };
  }
  return {
    ok: false,
    reason: "DOCUMENT_MISSING",
    message: "Kaynak belge numarası belirlenemedi.",
  };
}

/** GM kontrol satırlarından kaynak fiş paketi — fiş/firma bağımsız. */
export function buildSourceVoucherFromLedgerRows(
  rows = [],
  fisNo = "",
  options = {}
) {
  const { finding = null } = options;
  const needle = compactFisNo(fisNo);
  if (!needle) return null;

  const sameFisRows = (rows || []).filter((row) => fisNoMatches(row.fisNo, needle));
  if (!sameFisRows.length) return null;

  const voucherRows = sameFisRows.filter((row) =>
    String(row.hesapKodu || "").trim()
  );
  if (!voucherRows.length) return null;

  const dateResult = resolveSourceVoucherDate({
    fisRows: voucherRows,
    allRows: rows,
    fisNo: needle,
    finding,
  });
  const documentResult = resolveVoucherDocumentNo(voucherRows);
  const fisDisplay =
    compactFisNo(voucherRows.find((row) => compactFisNo(row.fisNo))?.fisNo) ||
    needle;

  const cariCandidates = uniqueNonEmpty(
    voucherRows.map((row) => String(row.cariUnvan || row.hesapAdi || "").trim())
  );

  return {
    fisNo: fisDisplay,
    tarih: dateResult.ok ? dateResult.value : "",
    belgeNo: documentResult.ok ? documentResult.value : "",
    cariUnvan: cariCandidates.length === 1 ? cariCandidates[0] : "",
    rows: voucherRows,
    metaComplete: dateResult.ok && documentResult.ok,
    metaIssues: [
      ...(dateResult.ok ? [] : [dateResult]),
      ...(documentResult.ok ? [] : [documentResult]),
    ],
    dateSource: dateResult.ok ? dateResult.source : "",
  };
}

export function buildCorrectionReference(sourceVoucher = {}) {
  if (!sourceVoucher?.metaComplete) {
    const issue = sourceVoucher?.metaIssues?.[0];
    return {
      ok: false,
      sourceFisNo: compactFisNo(sourceVoucher?.fisNo),
      sourceDate: "",
      sourceDocumentNo: "",
      sourceParty: sourceVoucher?.cariUnvan || "",
      displaySourceDate: "",
      reason: issue?.reason || "SOURCE_META_INCOMPLETE",
      message:
        issue?.message ||
        "Kaynak fiş tarih/belge bilgisi eksik veya belirsiz; düzeltme fişi üretilmez.",
    };
  }

  const displaySourceDate =
    formatDateTR(sourceVoucher.tarih) || String(sourceVoucher.tarih || "").trim();

  return {
    ok: true,
    sourceFisNo: compactFisNo(sourceVoucher.fisNo),
    sourceDate: sourceVoucher.tarih || "",
    sourceDocumentNo: sourceVoucher.belgeNo || "",
    sourceParty: sourceVoucher.cariUnvan || "",
    displaySourceDate,
  };
}

export function buildCorrectionDescription({
  reference = {},
  correctDebitAccountCode = "",
  correctDebitAccountName = "",
} = {}) {
  const datePart = reference.displaySourceDate || reference.sourceDate || "";
  const fisPart = reference.sourceFisNo || "—";
  const belgePart = reference.sourceDocumentNo || "—";
  if (!datePart || !reference.sourceDocumentNo) {
    return "";
  }
  const targetLabel = [correctDebitAccountCode, correctDebitAccountName]
    .filter(Boolean)
    .join(" ");

  return `${datePart} tarihli ${fisPart} numaralı fişte sehven borçlandırılan cari hesabın ${targetLabel} hesabına düzeltilmesi. Kaynak belge: ${belgePart}.`;
}
