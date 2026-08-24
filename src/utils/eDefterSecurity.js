/**
 * E-Defter güvenlik limitleri ve fingerprint — içerik loglanmaz.
 */

import {
  evaluateEDefterCompanyIdentity,
  identityStatusToErrorCode,
} from "@/src/utils/eDefterCompanyIdentityGate";

export const EDEFTER_MAX_BYTES = 40 * 1024 * 1024;
export const EDEFTER_MAX_ZIP_ENTRIES = 80;
export const EDEFTER_MAX_UNCOMPRESSED_BYTES = 120 * 1024 * 1024;
export const EDEFTER_MAX_COMPRESSION_RATIO = 100;
export const EDEFTER_MAX_NESTED_ZIP = 0;
export const EDEFTER_PARSE_TIMEOUT_MS = 60_000;
export const EDEFTER_MAX_ROWS = 250_000;

export const EDEFTER_ERROR_CODE = Object.freeze({
  COMPANY_MISMATCH: "COMPANY_MISMATCH",
  MIXED_COMPANY_OR_PERIOD: "MIXED_COMPANY_OR_PERIOD",
  JOURNAL_LEDGER_MISMATCH: "JOURNAL_LEDGER_MISMATCH",
  EXTERNAL_VERIFICATION_REQUIRED: "EXTERNAL_VERIFICATION_REQUIRED",
  COMPANY_IDENTITY_MISSING: "COMPANY_IDENTITY_MISSING",
  DOCUMENT_IDENTITY_MISSING: "DOCUMENT_IDENTITY_MISSING",
  IDENTITY_INVALID: "IDENTITY_INVALID",
  IDENTITY_AMBIGUOUS: "IDENTITY_AMBIGUOUS",
  IDENTITY_TYPE_CONFLICT: "IDENTITY_TYPE_CONFLICT",
  XML_BOZUK: "XML_BOZUK",
  XXE_REJECTED: "XXE_REJECTED",
  ZIP_BOMB: "ZIP_BOMB",
  ZIP_SLIP: "ZIP_SLIP",
  TOO_LARGE: "TOO_LARGE",
  TOO_MANY_ENTRIES: "TOO_MANY_ENTRIES",
  TIMEOUT: "TIMEOUT",
  CANCELLED: "CANCELLED",
  DUPLICATE_FILE: "DUPLICATE_FILE",
  UNSUPPORTED: "UNSUPPORTED",
  ENCRYPTED: "ENCRYPTED",
});

export const DUPLICATE_EDEFTER_UI_MESSAGE =
  "Mükerrer E-Defter dosyası — yeniden işlenmedi";

export function makeEDefterError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function buildContentFingerprint(bytesOrText = "") {
  let s = "";
  if (typeof bytesOrText === "string") s = bytesOrText;
  else if (bytesOrText instanceof ArrayBuffer) {
    const view = new Uint8Array(bytesOrText);
    const limit = Math.min(view.byteLength, 2_000_000);
    const parts = [];
    for (let i = 0; i < limit; i += 1) parts.push(String.fromCharCode(view[i]));
    s = parts.join("");
  } else if (bytesOrText instanceof Uint8Array) {
    const limit = Math.min(bytesOrText.length, 2_000_000);
    const parts = [];
    for (let i = 0; i < limit; i += 1) parts.push(String.fromCharCode(bytesOrText[i]));
    s = parts.join("");
  } else {
    s = String(bytesOrText || "");
  }
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let h2 = 0x811c9dc5;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    h2 ^= s.charCodeAt(i);
    h2 = Math.imul(h2, 16777619);
  }
  const lenTag = (typeof bytesOrText === "string"
    ? bytesOrText.length
    : bytesOrText?.byteLength || bytesOrText?.length || 0
  )
    .toString(16)
    .padStart(8, "0");
  return (
    (h >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0") +
    lenTag
  );
}

/** DOCTYPE / ENTITY → XXE riski */
export function rejectXxePayload(xmlText = "") {
  const t = String(xmlText || "");
  if (/<!DOCTYPE/i.test(t) || /<!ENTITY/i.test(t) || /SYSTEM\s+["']/i.test(t)) {
    throw makeEDefterError(
      EDEFTER_ERROR_CODE.XXE_REJECTED,
      "XML içinde harici varlık (DOCTYPE/ENTITY) tespit edildi; güvenlik nedeniyle reddedildi."
    );
  }
  return t;
}

export function assertUploadSize(byteLength = 0) {
  if (byteLength > EDEFTER_MAX_BYTES) {
    throw makeEDefterError(
      EDEFTER_ERROR_CODE.TOO_LARGE,
      `Dosya çok büyük. En fazla ${(EDEFTER_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB yüklenebilir.`
    );
  }
}

export function assertRowLimit(count = 0) {
  if (count > EDEFTER_MAX_ROWS) {
    throw makeEDefterError(
      EDEFTER_ERROR_CODE.TOO_LARGE,
      `Satır sayısı sınırı aşıldı (en fazla ${EDEFTER_MAX_ROWS.toLocaleString("tr-TR")}).`
    );
  }
}

export function isZipSlipPath(name = "") {
  const n = String(name || "").replace(/\\/g, "/");
  if (!n || n.startsWith("/") || n.includes("..")) return true;
  if (/^[a-zA-Z]:/.test(n)) return true;
  return false;
}

/**
 * JSZip entry listesi için bomb/slip kontrolleri.
 * @returns {{ ok: true, entryCount: number, uncompressedEstimate: number }}
 */
export function assertSafeZipEntries(zipFiles = {}, compressedTotal = 0) {
  const entries = Object.values(zipFiles || {}).filter((e) => e && !e.dir);
  if (entries.length > EDEFTER_MAX_ZIP_ENTRIES) {
    throw makeEDefterError(
      EDEFTER_ERROR_CODE.TOO_MANY_ENTRIES,
      `ZIP içinde çok fazla dosya var (en fazla ${EDEFTER_MAX_ZIP_ENTRIES}).`
    );
  }
  let uncompressed = 0;
  for (const entry of entries) {
    const name = entry.name || "";
    if (isZipSlipPath(name)) {
      throw makeEDefterError(EDEFTER_ERROR_CODE.ZIP_SLIP, "ZIP yolu güvenli değil (zip-slip).");
    }
    if (/\.zip$/i.test(name)) {
      throw makeEDefterError(EDEFTER_ERROR_CODE.ZIP_BOMB, "İç içe ZIP desteklenmiyor.");
    }
    const size = Number(entry._data?.uncompressedSize ?? entry.uncompressedSize ?? 0);
    if (Number.isFinite(size) && size > 0) uncompressed += size;
  }
  if (uncompressed > EDEFTER_MAX_UNCOMPRESSED_BYTES) {
    throw makeEDefterError(EDEFTER_ERROR_CODE.ZIP_BOMB, "ZIP açıldığında boyut sınırı aşıldı.");
  }
  if (
    compressedTotal > 0 &&
    uncompressed / compressedTotal > EDEFTER_MAX_COMPRESSION_RATIO
  ) {
    throw makeEDefterError(
      EDEFTER_ERROR_CODE.ZIP_BOMB,
      "ZIP sıkıştırma oranı anormal (zip bomb şüphesi)."
    );
  }
  return { ok: true, entryCount: entries.length, uncompressedEstimate: uncompressed };
}

export function extractTaxIdFromText(text = "") {
  const t = String(text || "");
  const labeled =
    t.match(/vkn[^0-9]{0,12}(\d{10})\b/i) ||
    t.match(/vergi[^0-9]{0,20}(\d{10})\b/i) ||
    t.match(/tckn[^0-9]{0,12}(\d{11})\b/i) ||
    t.match(/<[^>]*(?:vkn|taxId|identifier)[^>]*>\s*(\d{10,11})\s*</i);
  if (labeled) return labeled[1];
  const vkn = t.match(/\b(\d{10})\b/);
  const tckn = t.match(/\b(\d{11})\b/);
  if (vkn) return vkn[1];
  if (tckn) return tckn[1];
  return "";
}

export function extractPeriodFromText(text = "") {
  const t = String(text || "");
  const iso = t.match(/(20\d{2})[-./](0[1-9]|1[0-2])/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const tr = t.match(/(0[1-9]|1[0-2])[-./](20\d{2})/);
  if (tr) return `${tr[2]}-${tr[1]}`;
  const yyyyMm = t.match(/\b(20\d{2})(0[1-9]|1[0-2])\b/);
  if (yyyyMm) return `${yyyyMm[1]}-${yyyyMm[2]}`;
  return "";
}

export function normalizePeriodKey(period = "") {
  const raw = String(period || "").trim();
  if (!raw) return "";
  const fromText = extractPeriodFromText(raw);
  if (fromText) return fromText;
  const parts = raw.replace(/\//g, "-").split("-");
  if (parts.length >= 2) {
    const y = parts[0].length === 4 ? parts[0] : parts[1];
    const m = parts[0].length === 4 ? parts[1] : parts[0];
    if (/^20\d{2}$/.test(y) && /^(0?[1-9]|1[0-2])$/.test(m)) {
      return `${y}-${String(m).padStart(2, "0")}`;
    }
  }
  return raw;
}

export function normalizeTaxId(value = "") {
  return String(value || "").replace(/\D/g, "");
}

/**
 * Seçili firma VKN/TCKN ile dosya vergi kimliği karşılaştırır.
 * Fail-closed: eksik kimlik artık {ok:true, skipped:true} ile geçilmez.
 */
export function assertCompanyTaxMatch(fileTaxId = "", companyTaxId = "", options = {}) {
  const decision = evaluateEDefterCompanyIdentity({
    companyTaxId,
    documentTaxId: fileTaxId,
    documentTaxIds: options.documentTaxIds,
    companyId: options.companyId || "",
    sourceKind: options.sourceKind || "xml",
  });
  if (decision.blocking || !decision.allowAnalyze) {
    throw makeEDefterError(
      identityStatusToErrorCode(decision.status) || EDEFTER_ERROR_CODE.COMPANY_MISMATCH,
      decision.safeMessage
    );
  }
  return {
    ok: true,
    skipped: false,
    decision,
  };
}

export function createParseAbortGuard({ signal, timeoutMs = EDEFTER_PARSE_TIMEOUT_MS } = {}) {
  const started = Date.now();
  const check = () => {
    if (signal?.aborted) {
      throw makeEDefterError(EDEFTER_ERROR_CODE.CANCELLED, "E-Defter işlemi iptal edildi.");
    }
    if (timeoutMs > 0 && Date.now() - started > timeoutMs) {
      throw makeEDefterError(
        EDEFTER_ERROR_CODE.TIMEOUT,
        "E-Defter ayrıştırma zaman aşımına uğradı."
      );
    }
  };
  return { check, started };
}

/** Oturum içi fingerprint set — ham XML saklanmaz. */
export function createFingerprintSession(initial = []) {
  const seen = new Set(Array.isArray(initial) ? initial : []);
  return {
    has(fp) {
      return Boolean(fp) && seen.has(fp);
    },
    add(fp) {
      if (fp) seen.add(fp);
    },
    values() {
      return [...seen];
    },
    clear() {
      seen.clear();
    },
  };
}
