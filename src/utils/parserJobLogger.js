import {
  logExcelError,
  logOperationalEvent,
  logParserError,
  logXmlError,
  SYSTEM_ERROR_TYPES,
} from "@/src/utils/systemLogEngine";
import { subscribeParserEvents } from "@/src/utils/workerParserBridge";

export function logParserJobCancelled(meta = {}) {
  return logOperationalEvent({
    module: meta.module || "Parser Worker",
    message: meta.message || "Parser işlemi kullanıcı tarafından iptal edildi.",
    level: "info",
    companyId: meta.companyId || "",
    companyName: meta.companyName || "",
    fileName: meta.fileName || "",
    errorType: SYSTEM_ERROR_TYPES.UNEXPECTED,
    technicalDetail: { reason: meta.reason || "user", jobType: meta.jobType || "" },
    suggestion: "Gerekirse işlemi yeniden başlatın.",
  });
}

export function logParserJobTimeout(meta = {}) {
  return logParserError(
    meta.message || "Parser işlemi zaman aşımına uğradı.",
    { jobType: meta.jobType || "", fileName: meta.fileName || "" },
    meta.companyId || "",
    {
      companyName: meta.companyName || "",
      fileName: meta.fileName || "",
      errorType: SYSTEM_ERROR_TYPES.TIMEOUT,
      module: meta.module || "Parser Worker",
      suggestion: "Dosyayı küçültün veya daha sonra tekrar deneyin.",
    }
  );
}

export function logParserJobError(error, meta = {}) {
  const message = error?.message || String(error || "Parser hatası");
  const source = meta.source || "parser";

  if (source === "xml") {
    return logXmlError(message, { stack: error?.stack, jobType: meta.jobType }, meta.companyId, {
      fileName: meta.fileName || "",
      companyName: meta.companyName || "",
      errorType: meta.errorType || SYSTEM_ERROR_TYPES.CORRUPT_XML,
      module: meta.module || "XML / e-Defter",
    });
  }

  if (source === "excel") {
    return logExcelError(message, { stack: error?.stack, jobType: meta.jobType }, meta.companyId, {
      fileName: meta.fileName || "",
      companyName: meta.companyName || "",
      errorType: meta.errorType || SYSTEM_ERROR_TYPES.CORRUPT_EXCEL,
      module: meta.module || "Excel İşleme",
    });
  }

  return logParserError(message, { stack: error?.stack, jobType: meta.jobType }, meta.companyId, {
    fileName: meta.fileName || "",
    companyName: meta.companyName || "",
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
