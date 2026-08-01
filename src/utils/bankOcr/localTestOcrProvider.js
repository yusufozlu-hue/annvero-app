/**
 * Deterministik local OCR test sağlayıcısı.
 * Gerçek motor değildir; fixture / selectedBank ile bilinen metin üretir.
 * Ham PDF içeriği loglanmaz.
 */

import { OCR_POLICY, OCR_SAFE_MESSAGES, OCR_STATUS } from "@/src/utils/bankOcr/ocrPolicy.js";

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
      aciklama: `${b} EFT GELEN ABC LTD`,
      borc: "1.500,00",
      alacak: "0,00",
      bakiye: "11.500,00",
    },
    {
      tarih: "03.01.2026",
      aciklama: `${b} HAVALE GIDEN XYZ AS`,
      borc: "0,00",
      alacak: "250,00",
      bakiye: "11.250,00",
    },
    {
      tarih: "04.01.2026",
      aciklama: `${b} POS TAHSILAT`,
      borc: "800,00",
      alacak: "0,00",
      bakiye: "12.050,00",
    },
  ];
}

function buildPageText(bank, pageIndex, pageCount, { lowConfidence = false, balanceMismatch = false } = {}) {
  const label = BANK_LABEL[bank] || BANK_LABEL.VAKIFBANK;
  const moves = sampleMoves(bank);
  const closing = balanceMismatch ? "12.999,00" : "12.050,00";
  const lines = [
    `--- page ${pageIndex} ---`,
    label,
    "Hesap No: 12345678",
    "Para Birimi: TRY",
    pageIndex === 1 ? "Acilis bakiyesi: 10.000,00" : "Devreden bakiye 11.500,00",
    "Tarih Aciklama Borc Alacak Bakiye",
  ];
  // Çok sayfada hareketleri dağıt
  const per = Math.ceil(moves.length / Math.max(1, pageCount));
  const slice = moves.slice((pageIndex - 1) * per, pageIndex * per);
  for (const m of slice) {
    lines.push(`${m.tarih} ${m.aciklama} ${m.borc} ${m.alacak} ${m.bakiye}`);
  }
  if (pageIndex === pageCount) {
    lines.push("Ara toplam 2.300,00 250,00");
    lines.push(`Kapanis bakiyesi: ${closing}`);
  }
  if (lowConfidence) {
    lines.push("OCR_CONF:0.55");
  } else {
    lines.push("OCR_CONF:0.92");
  }
  return lines.join("\n");
}

function detectBankHint(options = {}) {
  const fromOpt = String(options.selectedBank || options.ocrFixtureBank || "")
    .trim()
    .toUpperCase();
  if (BANK_LABEL[fromOpt]) return fromOpt;
  const name = String(options.fileName || "").toLocaleLowerCase("tr-TR");
  if (/vak[ıi]f/.test(name)) return "VAKIFBANK";
  if (/garanti/.test(name)) return "GARANTI";
  if (/\bteb\b/.test(name)) return "TEB";
  if (/ziraat/.test(name)) return "ZIRAAT";
  if (/kuveyt/.test(name)) return "KUVEYT";
  return "VAKIFBANK";
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error(OCR_SAFE_MESSAGES.OCR_CANCELLED);
      err.code = "OCR_CANCELLED";
      reject(err);
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      const err = new Error(OCR_SAFE_MESSAGES.OCR_CANCELLED);
      err.code = "OCR_CANCELLED";
      reject(err);
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/**
 * @returns {import('./ocrProvider.js').createOcrProvider}
 */
export function createLocalTestOcrProvider(options = {}) {
  return {
    name: "local-test",
    configured: true,
    async recognize({
      pageCount = 1,
      signal,
      onProgress,
      selectedBank,
      fileName,
      lowConfidence = false,
      balanceMismatch = false,
      simulateFail = false,
      simulateTimeout = false,
    } = {}) {
      if (simulateFail) {
        return {
          ok: false,
          code: OCR_STATUS.OCR_FAILED,
          status: OCR_STATUS.OCR_FAILED,
          message: OCR_SAFE_MESSAGES.OCR_FAILED,
          pages: [],
          configured: true,
        };
      }
      if (simulateTimeout) {
        await sleep(OCR_POLICY.TIMEOUT_MS + 50, signal);
      }

      const bank = detectBankHint({ selectedBank, fileName, ...options });
      const pages = Math.max(1, Math.min(Number(pageCount) || 1, OCR_POLICY.MAX_PAGES));
      const out = [];

      onProgress?.({
        status: OCR_STATUS.PREPARING,
        detail: "OCR hazırlanıyor",
        percent: 4,
        page: 0,
        pageCount: pages,
      });
      await sleep(30, signal);

      for (let i = 1; i <= pages; i += 1) {
        if (signal?.aborted) {
          const err = new Error(OCR_SAFE_MESSAGES.OCR_CANCELLED);
          err.code = "OCR_CANCELLED";
          throw err;
        }
        onProgress?.({
          status: OCR_STATUS.READING_PAGE,
          detail: `Sayfa ${i}/${pages} okunuyor`,
          percent: Math.round((i / pages) * 85),
          page: i,
          pageCount: pages,
        });
        await sleep(20, signal);
        const text = buildPageText(bank, i, pages, {
          lowConfidence: Boolean(lowConfidence || options.lowConfidence),
          balanceMismatch: Boolean(balanceMismatch || options.balanceMismatch),
        });
        const confMatch = text.match(/OCR_CONF:([0-9.]+)/);
        const confidence = confMatch ? Number(confMatch[1]) : 0.9;
        out.push({
          page: i,
          text: text.replace(/\nOCR_CONF:[0-9.]+\s*$/m, "").trim(),
          confidence,
          width: 1240,
          height: 1754,
          dpi: 150,
        });
      }

      onProgress?.({
        status: OCR_STATUS.VALIDATING,
        detail: "Hareketler doğrulanıyor",
        percent: 92,
        page: pages,
        pageCount: pages,
      });

      return {
        ok: true,
        code: "OK",
        status: OCR_STATUS.COMPLETED,
        message: "",
        pages: out,
        configured: true,
        provider: "local-test",
        detectedBank: bank,
      };
    },
  };
}

export function buildLocalTestOcrTextForBank(bank, opts = {}) {
  const pages = Math.max(1, Number(opts.pageCount) || 1);
  const parts = [];
  for (let i = 1; i <= pages; i += 1) {
    parts.push(
      buildPageText(String(bank || "VAKIFBANK").toUpperCase(), i, pages, opts)
        .replace(/\nOCR_CONF:[0-9.]+\s*$/m, "")
        .trim()
    );
  }
  return parts.join("\n");
}
