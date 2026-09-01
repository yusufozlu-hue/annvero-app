/**
 * VakıfBank PDF layout adapter — ortak PDF hattında güvenli banka eklentisi.
 *
 * pdfjs item geometrisi: tarih | saat | referans | tutar | bakiye | açıklama
 * Tutar regex'i referans numarası üzerinde çalışmaz (468+173.000 birleşme hatası).
 * Geometri yoksa: tarih/saat sonrası referansı ayır, kalan tutar/bakiye parse et.
 */

import { createCanonicalBankTransaction } from "@/src/utils/bankCanonicalTransaction.js";
import { BANK_STATEMENT_SOURCE } from "@/src/utils/bankCanonicalTransaction.js";
import {
  BANK_PDF_DOCUMENT_TYPE,
  parseTrAmountToken,
} from "@/src/utils/bankPdf/ziraatPdfLayout.js";

const DATE_START_RE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/;
const DATE_ONLY_RE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const REF_RE = /^\d{12,20}$/;
const AMOUNT_CELL_RE =
  /^-?\d{1,3}(?:\.\d{3})*(?:,\d{2})|-?\d+(?:,\d{2})$/;
const CHAIN_TOLERANCE = 0.05;

const FOOTER_RE =
  /^(sayfa\s*\d+|page\s*\d+|www\.|telefon|m[uü][sş]teri\s*hizmet|copyright|devam\s* ediyor|bu\s*belge)/i;
const SUBTOTAL_RE =
  /(ara\s*toplam|g[uü]nl[uü]k\s*toplam|toplam\s*bor[cç]|toplam\s*alacak|a[cç][iı]l[iı][sş]\s*bakiyesi|kapan[iı][sş]\s*bakiyesi|devreden\s*bakiye)/i;

function normalizeSpaces(s = "") {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeVakifBankBrand(text = "") {
  const t = normalizeSpaces(text).toLocaleLowerCase("tr-TR");
  return /vak[ıi]f\s*bank|vakifbank|vakiflar\s+bank/.test(t);
}

export function looksLikeVakifStatement(text = "") {
  const t = normalizeSpaces(text).toLocaleLowerCase("tr-TR");
  if (!looksLikeVakifBankBrand(t)) return false;
  const statement =
    /hesap\s*ekstresi/.test(t) ||
    /hesap\s*hareket/.test(t) ||
    /vadesiz/.test(t) ||
    /vadel[iı]/.test(t) ||
    /vb\s*m[uü][sş]/.test(t);
  const dateLines = (String(text || "").split(/\r?\n/).filter((l) => DATE_START_RE.test(l.trim())) || [])
    .length;
  return statement || dateLines >= 2;
}

export function classifyVakifPdfDocument(text = "") {
  if (!looksLikeVakifBankBrand(text)) return BANK_PDF_DOCUMENT_TYPE.UNKNOWN_BANK_DOCUMENT;
  if (looksLikeVakifStatement(text)) return BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT;
  return BANK_PDF_DOCUMENT_TYPE.UNKNOWN_BANK_DOCUMENT;
}

function toBal(tx) {
  const n = Number(tx?.balance);
  return Number.isFinite(n) ? n : null;
}

function isAmountCell(str = "") {
  const t = normalizeSpaces(str);
  return Boolean(t && AMOUNT_CELL_RE.test(t));
}

function median(values = []) {
  const nums = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function clusterRows(items = []) {
  const mapped = (items || [])
    .filter((it) => it && typeof it.str === "string" && normalizeSpaces(it.str))
    .map((it) => ({
      str: normalizeSpaces(it.str),
      x: Number(it.x) || 0,
      y: Number(it.y) || 0,
      w: Number(it.w) || Math.max(4, String(it.str || "").length * 4),
      h: Number(it.h) || 10,
    }));
  mapped.sort((a, b) => (Math.abs(a.y - b.y) < 1.5 ? a.x - b.x : b.y - a.y));
  const rows = [];
  let cur = null;
  for (const it of mapped) {
    const band = Math.max(5.5, (cur?.h || it.h) * 0.7);
    if (!cur || Math.abs(it.y - cur.y) > band) {
      if (cur) {
        cur.cells.sort((a, b) => a.x - b.x);
        rows.push(cur);
      }
      cur = { y: it.y, h: it.h, cells: [it] };
    } else {
      cur.cells.push(it);
      const n = cur.cells.length;
      cur.y = (cur.y * (n - 1) + it.y) / n;
      cur.h = (cur.h * (n - 1) + it.h) / n;
    }
  }
  if (cur) {
    cur.cells.sort((a, b) => a.x - b.x);
    rows.push(cur);
  }
  return rows;
}

function isMovementRow(row = {}) {
  const first = row.cells?.[0]?.str || "";
  return DATE_ONLY_RE.test(first);
}

/**
 * Hareket satırlarından göreli kolon bantları (sayfa ölçeğine uyumlu).
 */
export function inferVakifColumnBands(rows = []) {
  const movementRows = rows.filter(isMovementRow);
  if (!movementRows.length) return null;

  const refX = [];
  const amountX = [];
  const balanceX = [];
  const descX = [];

  for (const row of movementRows) {
    const cells = row.cells || [];
    if (cells.length < 4) continue;

    let idx = 0;
    if (!DATE_ONLY_RE.test(cells[idx]?.str || "")) continue;
    idx += 1;
    if (TIME_RE.test(cells[idx]?.str || "")) idx += 1;

    const refCell = cells[idx];
    if (refCell && REF_RE.test(refCell.str)) {
      refX.push(refCell.x + refCell.w / 2);
      idx += 1;
    }

    const amountCandidates = [];
    const descCandidates = [];
    for (let i = idx; i < cells.length; i += 1) {
      const c = cells[i];
      if (isAmountCell(c.str)) amountCandidates.push(c);
      else descCandidates.push(c);
    }

    if (amountCandidates.length >= 2) {
      amountX.push(amountCandidates[0].x + amountCandidates[0].w / 2);
      balanceX.push(
        amountCandidates[amountCandidates.length - 1].x +
          amountCandidates[amountCandidates.length - 1].w / 2
      );
    } else if (amountCandidates.length === 1) {
      amountX.push(amountCandidates[0].x + amountCandidates[0].w / 2);
    }

    if (descCandidates.length) {
      const d = descCandidates[descCandidates.length - 1];
      descX.push(d.x + d.w / 2);
    }
  }

  const refCenter = median(refX);
  const amountCenter = median(amountX);
  const balanceCenter = median(balanceX);
  const descCenter = median(descX);
  if (refCenter == null || amountCenter == null || balanceCenter == null) {
    return null;
  }

  const refWidth = median(
    movementRows
      .flatMap((r) => r.cells)
      .filter((c) => REF_RE.test(c.str))
      .map((c) => c.w)
  ) || 80;

  const gap = Math.max(20, (balanceCenter - amountCenter) * 0.35);

  return {
    ref: { center: refCenter, halfWidth: refWidth / 2 + 8 },
    amount: {
      min: refCenter + refWidth / 2 + 4,
      max: (amountCenter + balanceCenter) / 2 - gap / 2,
    },
    balance: {
      min: (amountCenter + balanceCenter) / 2 + gap / 2,
      max: (descCenter ?? balanceCenter + 120) - 4,
    },
    desc: { min: (descCenter ?? balanceCenter + 40) - 20 },
  };
}

function assignCellBand(cell, bands) {
  const cx = cell.x + cell.w / 2;
  if (REF_RE.test(cell.str)) return "ref";
  if (isAmountCell(cell.str)) {
    if (cx >= bands.balance.min && cx <= bands.balance.max + 40) return "balance";
    if (cx >= bands.amount.min && cx <= bands.amount.max + 40) return "amount";
    if (cx > bands.balance.min - 20) return "balance";
    return "amount";
  }
  if (cx >= bands.desc.min) return "desc";
  if (TIME_RE.test(cell.str)) return "time";
  if (DATE_ONLY_RE.test(cell.str)) return "date";
  return "other";
}

function parseRowWithBands(row, bands) {
  const bucket = {
    date: "",
    time: "",
    ref: "",
    amount: "",
    balance: "",
    descParts: [],
  };

  for (const cell of row.cells || []) {
    const band = assignCellBand(cell, bands);
    if (band === "date" && !bucket.date) bucket.date = cell.str;
    else if (band === "time" && !bucket.time) bucket.time = cell.str;
    else if (band === "ref" && !bucket.ref) bucket.ref = cell.str;
    else if (band === "amount" && !bucket.amount) bucket.amount = cell.str;
    else if (band === "balance" && !bucket.balance) bucket.balance = cell.str;
    else if (band === "desc") bucket.descParts.push(cell.str);
    else if (band === "other" && !DATE_ONLY_RE.test(cell.str) && !TIME_RE.test(cell.str)) {
      if (!REF_RE.test(cell.str) && !isAmountCell(cell.str)) {
        bucket.descParts.push(cell.str);
      }
    }
  }

  return bucket;
}

function parseRowPositional(row) {
  const cells = row.cells || [];
  if (!cells.length || !DATE_ONLY_RE.test(cells[0]?.str || "")) return null;

  let idx = 1;
  const time = TIME_RE.test(cells[idx]?.str || "") ? cells[idx++].str : "";
  const ref = REF_RE.test(cells[idx]?.str || "") ? cells[idx++].str : "";

  const amountCells = [];
  const descParts = [];
  for (let i = idx; i < cells.length; i += 1) {
    const c = cells[i];
    if (isAmountCell(c.str)) amountCells.push(c.str);
    else descParts.push(c.str);
  }

  return {
    date: cells[0].str,
    time,
    ref,
    amount: amountCells[0] || "",
    balance: amountCells.length >= 2 ? amountCells[amountCells.length - 1] : "",
    descParts,
  };
}

function signedFromAmountRaw(raw = "") {
  const n = parseTrAmountToken(raw);
  if (!Number.isFinite(n)) return { signed: 0, debit: 0, credit: 0 };
  const t = normalizeSpaces(raw);
  if (t.startsWith("-")) {
    return { signed: n, debit: 0, credit: Math.abs(n) };
  }
  return { signed: Math.abs(n), debit: Math.abs(n), credit: 0 };
}

function sourceTypeOf(context = {}) {
  return (
    context.sourceType ||
    (context.ocrUsed ? BANK_STATEMENT_SOURCE.PDF_OCR : BANK_STATEMENT_SOURCE.PDF)
  );
}

function pushMovement(out, partial, context, warnings) {
  const { signed, debit, credit } = signedFromAmountRaw(partial.amountRaw);
  if (!Number.isFinite(signed) || Math.abs(signed) < 0.005) {
    warnings.push({ row: partial.sourceRow, code: "amount_skip" });
    return false;
  }
  const description = normalizeSpaces(
    [partial.time, partial.ref, ...(partial.descParts || [])].filter(Boolean).join(" ")
  );
  if (!description || description.length < 2) {
    warnings.push({ row: partial.sourceRow, code: "desc_skip" });
    return false;
  }

  const balance = partial.balanceRaw
    ? parseTrAmountToken(partial.balanceRaw)
    : null;

  out.push(
    createCanonicalBankTransaction({
      companyId: context.companyId,
      bank: "VAKIFBANK",
      accountIdentity: context.accountIdentity || "",
      transactionDate: partial.date.replace(/-/g, ".").replace(/\//g, "."),
      description,
      amount: signed,
      debit_amount: debit,
      credit_amount: credit,
      direction: signed < 0 ? "CIKIS" : "GIRIS",
      balance: Number.isFinite(balance) ? balance : null,
      currency: context.currency || "TRY",
      sourceRow: partial.sourceRow,
      sourcePage: partial.sourcePage,
      sourceFileHash: context.sourceFileHash,
      sourceType: sourceTypeOf(context),
      parseWarnings: partial.reviewRequired ? ["vakif_row_review"] : [],
      reviewRequired: Boolean(partial.reviewRequired || context.forceReview),
    })
  );
  return true;
}

/**
 * pdfjs koordinatlı VakıfBank ekstre parse.
 */
export function parseVakifStatementFromItems(pagesItems = [], context = {}) {
  const warnings = [];
  const diagnostics = {
    layout: "vakif_statement_coords",
    skipped: [],
    headerFound: false,
    pageCount: 0,
    parserMode: "vakif_coords",
  };
  const out = [];
  let sourceRow = 0;

  const pages = Array.isArray(pagesItems) ? pagesItems : [];
  diagnostics.pageCount = pages.length;

  for (const page of pages) {
    const pageNum = Number(page.page || page.pageNum || 1) || 1;
    const rows = clusterRows(page.items || []);
    const bands = inferVakifColumnBands(rows);
    if (!bands) {
      diagnostics.skipped.push({ page: pageNum, code: "bands_not_found" });
      continue;
    }
    diagnostics.headerFound = true;

    for (const row of rows) {
      const lineText = normalizeSpaces(row.cells.map((c) => c.str).join(" "));
      if (!lineText) continue;
      if (FOOTER_RE.test(lineText) || SUBTOTAL_RE.test(lineText)) continue;
      if (!isMovementRow(row)) continue;

      sourceRow += 1;
      let parsed = parseRowWithBands(row, bands);
      if (!parsed.amount && !parsed.balance) {
        parsed = parseRowPositional(row);
      }
      if (!parsed || !parsed.date) {
        warnings.push({ row: sourceRow, code: "row_skip" });
        continue;
      }

      const amountRaw = parsed.amount || "";
      const balanceRaw = parsed.balance || "";
      if (!amountRaw || !balanceRaw) {
        warnings.push({ row: sourceRow, code: "ambiguous_columns" });
        pushMovement(
          out,
          {
            ...parsed,
            amountRaw: amountRaw || balanceRaw,
            balanceRaw,
            sourceRow,
            sourcePage: pageNum,
            reviewRequired: true,
          },
          context,
          warnings,
          diagnostics
        );
        continue;
      }

      pushMovement(
        out,
        {
          date: parsed.date,
          time: parsed.time,
          ref: parsed.ref,
          descParts: parsed.descParts,
          amountRaw,
          balanceRaw,
          sourceRow,
          sourcePage: pageNum,
          reviewRequired: false,
        },
        context,
        warnings,
        diagnostics
      );
    }
  }

  diagnostics.parsed = out.length;
  return { transactions: out, warnings, bank: "VAKIFBANK", diagnostics };
}

/**
 * Metin fallback — referans alanını ayır, tutar regex'i yalnız kalan gövdede.
 */
export function parseVakifStatementTextFallback(text = "", context = {}) {
  const warnings = [];
  const diagnostics = { layout: "vakif_statement_text_ref_strip", parserMode: "vakif_text_fallback" };
  const out = [];
  let sourceRow = 0;
  let currentPage = 1;

  const lines = String(text || "")
    .split(/\r?\n/)
    .map(normalizeSpaces)
    .filter(Boolean);

  for (const line of lines) {
    const pageMark = line.match(/^---\s*page\s+(\d+)\s*---$/i);
    if (pageMark) {
      currentPage = Number(pageMark[1]) || currentPage;
      continue;
    }
    if (FOOTER_RE.test(line) || SUBTOTAL_RE.test(line)) continue;

    const m = line.match(
      /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\s+(?:(\d{1,2}:\d{2})\s+)?(\d{12,20})\s+(.+)$/
    );
    if (!m) continue;

    sourceRow += 1;
    const rest = m[4];
    const amountMatches = [...rest.matchAll(
      /-?\d{1,3}(?:\.\d{3})*(?:,\d{2})|-?\d+(?:,\d{2})/g
    )].map((x) => x[0]);

    if (amountMatches.length < 2) {
      warnings.push({ row: sourceRow, code: "ambiguous_text_row" });
      continue;
    }

    const amountRaw = amountMatches[0];
    const balanceRaw = amountMatches[amountMatches.length - 1];
    let desc = rest;
    for (const tok of amountMatches) desc = desc.replace(tok, " ");
    desc = normalizeSpaces(desc);

    pushMovement(
      out,
      {
        date: m[1],
        time: m[2] || "",
        ref: m[3],
        descParts: desc ? [desc] : [],
        amountRaw,
        balanceRaw,
        sourceRow,
        sourcePage: currentPage,
        reviewRequired: false,
      },
      context,
      warnings,
      diagnostics
    );
  }

  diagnostics.parsed = out.length;
  return { transactions: out, warnings, bank: "VAKIFBANK", diagnostics };
}

/**
 * 2-token Vakıf satırlarında tutar işareti çoğu zaman hep pozitif kalır.
 * Çalışan bakiye farkı hesabın gerçek hareketidir — yön tahmin edilmez.
 */
export function applyVakifRunningBalanceSigns(transactions = []) {
  const txs = Array.isArray(transactions) ? [...transactions] : [];
  if (txs.length < 1) return txs;

  for (let i = 0; i < txs.length; i += 1) {
    const curBal = toBal(txs[i]);
    if (curBal == null) continue;

    const prevBal = i > 0 ? toBal(txs[i - 1]) : 0;
    if (i === 0 && prevBal == null) {
      const currentSigned = Number(txs[i].amount);
      const impliedOpen = Number((curBal - currentSigned).toFixed(2));
      if (
        Number.isFinite(currentSigned) &&
        Math.abs(impliedOpen) <= CHAIN_TOLERANCE &&
        Math.abs(currentSigned) > CHAIN_TOLERANCE
      ) {
        continue;
      }
    }

    if (i === 0) continue;
    const prev = toBal(txs[i - 1]);
    if (prev == null) continue;
    const delta = Number((curBal - prev).toFixed(2));
    if (Math.abs(delta) < 0.005) continue;
    const currentSigned = Number(txs[i].amount);
    const chainOk =
      Number.isFinite(currentSigned) &&
      Math.abs(prev + currentSigned - curBal) <= CHAIN_TOLERANCE;
    if (chainOk) continue;
    const direction = delta < 0 ? "CIKIS" : "GIRIS";
    txs[i] = createCanonicalBankTransaction({
      ...txs[i],
      amount: delta,
      direction,
    });
  }
  return txs;
}

export function parseVakifPdfLayout({ text = "", pagesItems = null, context = {} } = {}) {
  const warnings = [];
  const diagnostics = { attempts: [] };
  const body = String(text || "");

  if (pagesItems && pagesItems.length) {
    const fromItems = parseVakifStatementFromItems(pagesItems, context);
    diagnostics.attempts.push(fromItems.diagnostics);
    if ((fromItems.transactions || []).length) {
      return {
        ...fromItems,
        documentType: BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT,
        diagnostics: { ...diagnostics, ...fromItems.diagnostics, winner: "vakif_coords" },
      };
    }
    warnings.push(...(fromItems.warnings || []));
  }

  const fromText = parseVakifStatementTextFallback(body, context);
  diagnostics.attempts.push(fromText.diagnostics);
  if ((fromText.transactions || []).length) {
    return {
      ...fromText,
      documentType: BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT,
      diagnostics: { ...diagnostics, ...fromText.diagnostics, winner: "vakif_text_fallback" },
    };
  }
  warnings.push(...(fromText.warnings || []));

  return {
    transactions: [],
    warnings,
    bank: "VAKIFBANK",
    documentType: classifyVakifPdfDocument(body),
    diagnostics: { ...diagnostics, winner: "none" },
  };
}

export function applyVakifStatementPostParse(parsed = {}, text = "") {
  const transactions = applyVakifRunningBalanceSigns(parsed.transactions || []);
  const classified = classifyVakifPdfDocument(text);
  const documentType =
    classified !== BANK_PDF_DOCUMENT_TYPE.UNKNOWN_BANK_DOCUMENT
      ? classified
      : transactions.length >= 1
        ? BANK_PDF_DOCUMENT_TYPE.BANK_STATEMENT
        : BANK_PDF_DOCUMENT_TYPE.UNKNOWN_BANK_DOCUMENT;
  return {
    ...parsed,
    transactions,
    bank: parsed.bank || "VAKIFBANK",
    documentType,
    diagnostics: {
      ...(parsed.diagnostics || {}),
      parserMode: parsed.diagnostics?.parserMode || "vakif_running_balance",
      winner: parsed.diagnostics?.winner || "vakif_statement",
    },
  };
}
