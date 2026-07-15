/**
 * Belge parse adapter — V1 fixture/JSON.
 * OCR / Drive / n8n yok. source_provider alanı hazır.
 */
import { buildObligationAccrual } from "./normalize.js";
import { hashUtf8String } from "./documentStore.js";
import {
  DOCUMENT_TYPE,
  PARSER_VERSION,
  SOURCE_PROVIDER,
} from "./types.js";

/**
 * Fixture veya önceden çıkarılmış JSON → normalize tahakkuk.
 * PDF ham içerik bu pakette okunmaz.
 */
export function parseObligationDocument(input = {}) {
  const {
    fileMeta = {},
    fixture = null,
    jsonText = "",
    source_provider = SOURCE_PROVIDER.UPLOAD,
  } = input;

  try {
    let raw = fixture;
    if (!raw && jsonText) {
      raw = JSON.parse(jsonText);
    }
    if (!raw || typeof raw !== "object") {
      return {
        ok: false,
        error:
          "V1 yalnızca fixture/JSON parse destekler. PDF OCR sonraki pakette.",
        accrual: null,
      };
    }

    const hash =
      fileMeta.hash ||
      raw.source_file_hash ||
      hashUtf8String(JSON.stringify(raw));

    const accrual = buildObligationAccrual({
      ...raw,
      company_id: raw.company_id || raw.companyId || fileMeta.companyId || "",
      source_file_id: fileMeta.id || raw.source_file_id || "",
      source_file_name:
        fileMeta.name || raw.source_file_name || fileMeta.fileName || "",
      source_file_hash: hash,
      source_provider:
        raw.source_provider || source_provider || SOURCE_PROVIDER.UPLOAD,
      document_type:
        raw.document_type || raw.documentType || DOCUMENT_TYPE.TAHAKKUK,
      parser_version: PARSER_VERSION,
      confidence: Number(raw.confidence ?? 80) || 80,
    });

    return { ok: true, error: "", accrual };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || "Parse hatası",
      accrual: null,
    };
  }
}

/**
 * Kontrollü kuyruk adımı: tek iş (belleğe tüm dosyaları almaz).
 */
export async function processParseJob(job = {}, context = {}) {
  const { fixtureByName = {}, onProgress } = context;
  onProgress?.(10);
  const fixture =
    job.fixture ||
    fixtureByName[job.fileName] ||
    fixtureByName[String(job.fileName || "").toLowerCase()];

  onProgress?.(40);
  const result = parseObligationDocument({
    fileMeta: {
      companyId: job.companyId,
      name: job.fileName,
      hash: job.fileHash,
      id: job.id,
    },
    fixture,
    jsonText: job.jsonText || "",
    source_provider: job.source_provider || SOURCE_PROVIDER.UPLOAD,
  });
  onProgress?.(90);

  if (!result.ok) {
    return {
      ...job,
      status: "error",
      error: result.error,
      progress: 100,
    };
  }

  return {
    ...job,
    status: "done",
    error: "",
    progress: 100,
    accrual: result.accrual,
    accrualId: result.accrual.id,
  };
}
