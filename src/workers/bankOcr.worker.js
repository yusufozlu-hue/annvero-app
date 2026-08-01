/**
 * Bank OCR classic Worker — zero-import (Turbopack media güvenliği).
 * Local-test sağlayıcı mantığı inline; sahte üretim yok (provider yoksa FAILED/NOT_CONFIGURED).
 *
 * Protocol:
 *  in:  { type:"ocr", jobId, bytes, options }
 *  out: { type:"progress"|"result"|"error", jobId, ... }
 */

const OCR_POLICY = {
  MAX_PAGES: 80,
  TIMEOUT_MS: 60000,
  LOW_CONFIDENCE: 0.72,
};

const SAFE = {
  OCR_FAILED: "OCR tamamlanamadı. Dosyayı kontrol edip güvenli biçimde yeniden deneyin.",
  OCR_PROVIDER_NOT_CONFIGURED:
    "OCR servisi yapılandırılmamış. Taranmış PDF’ler inceleme kuyruğunda bekler.",
  OCR_CANCELLED: "OCR iptal edildi.",
};

const BANK_LABEL = {
  GARANTI: "Garanti BBVA Hesap Ekstresi",
  TEB: "TEB Hesap Ekstresi",
  VAKIFBANK: "VakifBank Hesap Ekstresi",
  ZIRAAT: "Ziraat Bankasi Hesap Ekstresi",
  KUVEYT: "Kuveyt Turk Hesap Ekstresi",
};

function sampleMoves(bank) {
  const b = String(bank || "VAKIFBANK").toUpperCase();
  return [
    {
      tarih: "02.01.2026",
      aciklama: b + " EFT GELEN ABC LTD",
      borc: "1.500,00",
      alacak: "0,00",
      bakiye: "11.500,00",
    },
    {
      tarih: "03.01.2026",
      aciklama: b + " HAVALE GIDEN XYZ AS",
      borc: "0,00",
      alacak: "250,00",
      bakiye: "11.250,00",
    },
    {
      tarih: "04.01.2026",
      aciklama: b + " POS TAHSILAT",
      borc: "800,00",
      alacak: "0,00",
      bakiye: "12.050,00",
    },
  ];
}

function buildPageText(bank, pageIndex, pageCount, lowConfidence, balanceMismatch) {
  const label = BANK_LABEL[bank] || BANK_LABEL.VAKIFBANK;
  const moves = sampleMoves(bank);
  const closing = balanceMismatch ? "12.999,00" : "12.050,00";
  const lines = [
    "--- page " + pageIndex + " ---",
    label,
    "Hesap No: 12345678",
    "Para Birimi: TRY",
    pageIndex === 1 ? "Acilis bakiyesi: 10.000,00" : "Devreden bakiye 11.500,00",
    "Tarih Aciklama Borc Alacak Bakiye",
  ];
  const per = Math.ceil(moves.length / Math.max(1, pageCount));
  const slice = moves.slice((pageIndex - 1) * per, pageIndex * per);
  for (let i = 0; i < slice.length; i += 1) {
    const m = slice[i];
    lines.push(m.tarih + " " + m.aciklama + " " + m.borc + " " + m.alacak + " " + m.bakiye);
  }
  if (pageIndex === pageCount) {
    lines.push("Ara toplam 2.300,00 250,00");
    lines.push("Kapanis bakiyesi: " + closing);
  }
  return { text: lines.join("\n"), confidence: lowConfidence ? 0.55 : 0.92 };
}

function detectBank(options) {
  const fromOpt = String(options.selectedBank || "").trim().toUpperCase();
  if (BANK_LABEL[fromOpt]) return fromOpt;
  const name = String(options.fileName || "").toLowerCase();
  if (name.indexOf("vakif") >= 0 || name.indexOf("vakıf") >= 0) return "VAKIFBANK";
  if (name.indexOf("garanti") >= 0) return "GARANTI";
  if (name.indexOf("teb") >= 0) return "TEB";
  if (name.indexOf("ziraat") >= 0) return "ZIRAAT";
  if (name.indexOf("kuveyt") >= 0) return "KUVEYT";
  return "VAKIFBANK";
}

function post(type, jobId, payload) {
  self.postMessage(Object.assign({ type: type, jobId: jobId }, payload));
}

self.onmessage = function onMessage(event) {
  const msg = event.data || {};
  if (msg.type !== "ocr") return;
  const jobId = msg.jobId;
  const options = msg.options || {};
  const providerName = String(options.providerName || "").toLowerCase();

  try {
    post("progress", jobId, {
      progress: { status: "ocr_preparing", detail: "OCR hazırlanıyor", percent: 3 },
    });

    if (providerName !== "local-test" && providerName !== "test" && providerName !== "fixture") {
      post("result", jobId, {
        result: {
          ok: false,
          code: "OCR_PROVIDER_NOT_CONFIGURED",
          message: SAFE.OCR_PROVIDER_NOT_CONFIGURED,
          transactions: [],
          ocrRequired: true,
          ocrConfigured: false,
        },
      });
      return;
    }

    if (options.simulateFail) {
      post("result", jobId, {
        result: {
          ok: false,
          code: "OCR_FAILED",
          message: SAFE.OCR_FAILED,
          transactions: [],
        },
      });
      return;
    }

    const bank = detectBank(options);
    const pages = Math.max(1, Math.min(Number(options.pageCount) || 1, OCR_POLICY.MAX_PAGES));
    const ocrPages = [];
    for (let i = 1; i <= pages; i += 1) {
      post("progress", jobId, {
        progress: {
          status: "ocr_reading_page",
          detail: "Sayfa " + i + "/" + pages + " okunuyor",
          percent: Math.round((i / pages) * 80),
          page: i,
          pageCount: pages,
        },
      });
      const built = buildPageText(
        bank,
        i,
        pages,
        Boolean(options.lowConfidence),
        Boolean(options.balanceMismatch)
      );
      ocrPages.push({
        page: i,
        text: built.text,
        confidence: built.confidence,
        width: 1240,
        height: 1754,
        dpi: 150,
      });
    }

    post("progress", jobId, {
      progress: {
        status: "ocr_validating",
        detail: "Hareketler doğrulanıyor",
        percent: 90,
      },
    });

    // Worker yalnız OCR sayfalarını döner; normalize ana thread / Node bridge’te yapılır.
    post("result", jobId, {
      result: {
        ok: true,
        code: "OCR_PAGES_READY",
        pages: ocrPages,
        provider: "local-test",
        detectedBank: bank,
        ocrConfigured: true,
        needsNormalize: true,
      },
    });
  } catch (_error) {
    post("error", jobId, {
      code: "OCR_FAILED",
      message: SAFE.OCR_FAILED,
    });
  }
};
