import {
  logExcelError,
  logOperationalEvent,
  logParserError,
  logXmlError,
  SYSTEM_ERROR_TYPES,
} from "@/src/utils/systemLogEngine";
import { subscribeParserEvents } from "@/src/utils/workerParserBridge";
import {
  resolveSafeErrorCode,
  safeUiMessageForCode,
} from "@/src/lib/security/redact";

function safeParserMeta(meta = {}) {
  return {
    jobType: meta.jobType || "",
    module: meta.module || "",
    errorType: meta.errorType || "",
    source: meta.source || "",
    reason: meta.reason || "",
  };
}

export function logParserJobCancelled(meta = {}) {
  return logOperationalEvent({
    module: meta.module || "Parser Worker",
    message: safeUiMessageForCode("PARSER_CANCELLED", "İşlem iptal edildi."),
    level: "info",
    companyId: "",
    companyName: "",
    fileName: "",
    errorType: SYSTEM_ERROR_TYPES.UNEXPECTED,
    technicalDetail: {
      code: "PARSER_CANCELLED",
      reason: meta.reason || "user",
      jobType: meta.jobType || "",
      stage: "PARSER",
    },
    suggestion: "Gerekirse işlemi yeniden başlatın.",
  });
}

export function logParserJobTimeout(meta = {}) {
  return logParserError(
    safeUiMessageForCode("PARSER_TIMEOUT", "İşlem zaman aşımına uğradı."),
    {
      code: "PARSER_TIMEOUT",
      jobType: meta.jobType || "",
      stage: "PARSER",
    },
    "",
    {
      companyName: "",
      fileName: "",
      errorType: SYSTEM_ERROR_TYPES.TIMEOUT,
      module: meta.module || "Parser Worker",
      suggestion: "Dosyayı küçültün veya daha sonra tekrar deneyin.",
    }
  );
}

export function logParserJobError(error, meta = {}) {
  const code = resolveSafeErrorCode(error, "PARSER_FAILED");
  const message = safeUiMessageForCode(code, "İşlem tamamlanamadı.");
  const source = meta.source || "parser";
  const detail = {
    code,
    jobType: meta.jobType || "",
    stage: "PARSER",
    ...safeParserMeta(meta),
  };

  if (source === "xml") {
    return logXmlError(message, detail, "", {
      fileName: "",
      companyName: "",
      errorType: meta.errorType || SYSTEM_ERROR_TYPES.CORRUPT_XML,
      module: meta.module || "XML / e-Defter",
    });
  }

  if (source === "excel") {
    return logExcelError(message, detail, "", {
      fileName: "",
      companyName: "",
      errorType: meta.errorType || SYSTEM_ERROR_TYPES.CORRUPT_EXCEL,
      module: meta.module || "Excel İşleme",
    });
  }

  return logParserError(message, detail, "", {
    fileName: "",
    companyName: "",
    errorType: meta.errorType || SYSTEM_ERROR_TYPES.UNEXPECTED,
    module: meta.module || "Parser Worker",
  });
}

export function attachParserJobLogger(defaults = {}) {
  return subscribeParserEvents((event) => {
    if (event.type === "timeout") {
      logParserJobTimeout({ ...defaults, jobType: event.jobType });
    }
    if (event.type === "cancelled" && event.reason === "user") {
      logParserJobCancelled({ ...defaults, jobType: event.jobType, reason: event.reason });
    }
  });
}

export const PARSER_WORKER_TEST_SCENARIOS = [
  "Büyük banka Excel yükleme — banka-ekstresi Ön İzleme Oluştur",
  "Bozuk banka Excel — hatalı dosyada anlaşılır hata + CORRUPT_EXCEL logu",
  "Büyük e-Defter XML/ZIP — e-defter-kontrol XML yükleme worker progress",
  "Bozuk XML — teknik bulgu veya parse hatası mesajı",
  "Risk analizi — risk-denetim-merkezi worker + kritik öncelik sırası",
  "Fiş kontrol büyük liste — 300+ satırda worker analizi",
  "Luca Excel önizleme — hareket dosyası worker okuma",
  "İşlem iptal — İptal Et butonu + cancel logu",
  "Timeout simülasyonu — çok büyük dosya veya düşük timeoutMs ile TIMEOUT logu",
];
