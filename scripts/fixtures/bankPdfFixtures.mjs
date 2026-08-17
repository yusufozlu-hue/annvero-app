/**
 * Minimal text-layer PDF builder for bank statement fixtures (no external deps).
 */

function encodePdfLiteral(text = "") {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * @param {string[]} lines
 * @param {{ pageCount?: number, bankLabel?: string }} [opts]
 * @returns {Uint8Array}
 */
export function buildTextPdf(lines = [], opts = {}) {
  const pageCount = Math.max(1, Number(opts.pageCount) || 1);
  const bankLabel = opts.bankLabel || "BANKA EKSTRE";
  const perPage = Math.ceil(Math.max(lines.length, 1) / pageCount);
  const pages = [];

  for (let p = 0; p < pageCount; p += 1) {
    const slice = lines.slice(p * perPage, (p + 1) * perPage);
    const contentLines = [
      `BT /F1 10 Tf 40 800 Td (${encodePdfLiteral(`--- page ${p + 1} ---`)}) Tj`,
      `0 -14 Td (${encodePdfLiteral(bankLabel)}) Tj`,
      `0 -14 Td (${encodePdfLiteral("Sayfa " + (p + 1))}) Tj`,
    ];
    for (const line of slice) {
      contentLines.push(`0 -14 Td (${encodePdfLiteral(line)}) Tj`);
    }
    contentLines.push("ET");
    pages.push(contentLines.join("\n"));
  }

  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;

  let next = 3;
  const contentObjNums = [];
  for (let i = 0; i < pages.length; i += 1) {
    const pageObj = next;
    const contentObj = next + 1;
    contentObjNums.push(contentObj);
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> >>`;
    const stream = pages[i];
    objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    next += 2;
  }
  const fontObj = next;
  objects[fontObj] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i <= fontObj; i += 1) {
    offsets[i] = Buffer.byteLength(pdf, "latin1");
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${fontObj + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= fontObj; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${fontObj + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

  const out = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) out[i] = pdf.charCodeAt(i) & 0xff;
  return out;
}

export function buildEncryptedPdfStub() {
  const body =
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Encrypt 3 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n" +
    "3 0 obj\n<< /Filter /Standard /V 1 /R 2 /O () /U () /P -4 >>\nendobj\n" +
    "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000078 00000 n \n0000000130 00000 n \n" +
    "trailer\n<< /Size 4 /Root 1 0 R /Encrypt 3 0 R >>\nstartxref\n210\n%%EOF\n";
  const out = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i += 1) out[i] = body.charCodeAt(i) & 0xff;
  return out;
}

/** Image-only / no text layer → OCR_REQUIRED */
export function buildScannedPdfStub() {
  const stream = "BT ET"; // empty text
  const body =
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>\nendobj\n` +
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n` +
    "xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000214 00000 n \n" +
    "trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n280\n%%EOF\n";
  const out = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i += 1) out[i] = body.charCodeAt(i) & 0xff;
  return out;
}

/** Çok sayfalı taranmış stub (metin katmanı yok). */
export function buildScannedMultipagePdfStub(pageCount = 2) {
  const n = Math.max(2, Math.min(Number(pageCount) || 2, 10));
  const kids = [];
  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  let next = 3;
  for (let i = 0; i < n; i += 1) {
    const pageObj = next;
    const contentObj = next + 1;
    kids.push(`${pageObj} 0 R`);
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = "<< /Length 5 >>\nstream\nBT ET\nendstream";
    next += 2;
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${n} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i < next; i += 1) {
    offsets[i] = Buffer.byteLength(pdf, "latin1");
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${next}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < next; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  const out = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) out[i] = pdf.charCodeAt(i) & 0xff;
  return out;
}

export function buildCorruptPdfStub() {
  const body = "%PDF-1.4\nthis is not a valid pdf structure";
  const out = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i += 1) out[i] = body.charCodeAt(i) & 0xff;
  return out;
}

const BANK_META = {
  GARANTI: { label: "Garanti BBVA Hesap Ekstresi", code: "GARANTI" },
  TEB: { label: "TEB Hesap Ekstresi", code: "TEB" },
  VAKIFBANK: { label: "VakifBank Hesap Ekstresi", code: "VAKIFBANK" },
  ZIRAAT: { label: "Ziraat Bankasi Hesap Ekstresi", code: "ZIRAAT" },
  KUVEYT: { label: "Kuveyt Turk Hesap Ekstresi", code: "KUVEYT" },
};

/**
 * Deterministic sample movements shared by PDF + Excel cross-dedup tests.
 */
export function sampleBankMovements(bank) {
  const b = String(bank || "TEB").toUpperCase();
  return [
    {
      tarih: "02.01.2026",
      aciklama: `${b} EFT GELEN ABC LTD`,
      borc: 1500,
      alacak: 0,
      bakiye: 11500,
    },
    {
      tarih: "03.01.2026",
      aciklama: `${b} HAVALE GIDEN XYZ AS`,
      borc: 0,
      alacak: 250,
      bakiye: 11250,
    },
    {
      tarih: "04.01.2026",
      aciklama: `${b} POS TAHSILAT`,
      borc: 800,
      alacak: 0,
      bakiye: 12050,
    },
  ];
}

export function buildBankStatementPdfFixture(bank, { multipage = false } = {}) {
  const meta = BANK_META[String(bank).toUpperCase()] || BANK_META.TEB;
  const moves = sampleBankMovements(meta.code);
  const lines = [
    meta.label,
    "Hesap No: 12345678",
    "Para Birimi: TRY",
    "Acilis bakiyesi: 10.000,00",
    "Tarih Aciklama Borc Alacak Bakiye",
    ...moves.map((m) => {
      const borc = m.borc ? m.borc.toFixed(2).replace(".", ",") : "0,00";
      const alacak = m.alacak ? m.alacak.toFixed(2).replace(".", ",") : "0,00";
      const bakiye = Number(m.bakiye).toFixed(2).replace(".", ",");
      return `${m.tarih} ${m.aciklama} ${borc} ${alacak} ${bakiye}`;
    }),
    "Ara toplam 2.300,00 250,00",
    "Devreden bakiye 12.050,00",
    "Kapanis bakiyesi: 12.050,00",
    "www.ornekbanka.com.tr Musteri Hizmetleri",
  ];
  return buildTextPdf(lines, {
    pageCount: multipage ? 2 : 1,
    bankLabel: meta.label,
  });
}

export function movementsToLegacyRows(bank) {
  return sampleBankMovements(bank).map((m, i) => ({
    banka: String(bank).toUpperCase(),
    tarih: m.tarih,
    aciklama: m.aciklama,
    borc: m.borc,
    alacak: m.alacak,
    bakiye: m.bakiye,
    tutar: m.borc > 0 ? m.borc : -m.alacak,
    yon: m.borc > 0 ? "GIRIS" : "CIKIS",
    excelRowNumber: i + 2,
    sheetName: "Ekstre",
  }));
}

function pdfEscape(text = "") {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * Anonim Ziraat ekstre layout fixture:
 * - tekrarlayan sayfa başlığı
 * - çok satırlı açıklama
 * - 0,00 bakiye
 * - sayfa sınırı (birleşmeme)
 * Koordinatlı kolonlar (Tm) — whitespace regex’e bağımlı değil.
 */
export function buildZiraatLayoutPdfFixture() {
  const pages = [];

  function pageContent(pageNum, rows) {
    const ops = ["BT /F1 9 Tf"];
    const put = (x, y, text) => {
      ops.push(`1 0 0 1 ${x} ${y} Tm (${pdfEscape(text)}) Tj`);
    };
    put(40, 800, "T.C. Ziraat Bankasi A.S. Hesap Ekstresi");
    put(40, 785, `Sayfa ${pageNum}`);
    // Header columns
    put(40, 760, "Muh Tarih");
    put(100, 760, "Valor");
    put(160, 760, "Sube");
    put(210, 760, "Fis No");
    put(270, 760, "Isl Kd");
    put(330, 760, "Borc");
    put(390, 760, "Alacak");
    put(450, 760, "Bakiye");
    put(40, 745, "Islem Aciklamasi");
    let y = 720;
    for (const row of rows) {
      if (row.type === "header_repeat") {
        put(40, y, "Muh Tarih");
        put(100, y, "Valor");
        put(160, y, "Sube");
        put(210, y, "Fis No");
        put(270, y, "Isl Kd");
        put(330, y, "Borc");
        put(390, y, "Alacak");
        put(450, y, "Bakiye");
        y -= 16;
        continue;
      }
      put(40, y, row.tarih);
      put(100, y, row.valor || row.tarih);
      put(160, y, row.sube || "ANON");
      put(210, y, row.fis || "");
      put(270, y, row.kod || "EFT");
      put(330, y, row.borc);
      put(390, y, row.alacak);
      put(450, y, row.bakiye);
      y -= 14;
      put(40, y, row.aciklama1);
      y -= 12;
      if (row.aciklama2) {
        put(40, y, row.aciklama2);
        y -= 14;
      } else {
        y -= 4;
      }
    }
    ops.push("ET");
    return ops.join("\n");
  }

  pages.push(
    pageContent(1, [
      {
        tarih: "10.01.2026",
        valor: "10.01.2026",
        fis: "F100",
        borc: "100,00",
        alacak: "0,00",
        bakiye: "900,00",
        aciklama1: "EFT GIDEN ANON FIRMA REF",
        aciklama2: "DEVAM SATIR ACIKLAMA BOLUMU",
      },
      {
        tarih: "11.01.2026",
        valor: "11.01.2026",
        fis: "F101",
        borc: "0,00",
        alacak: "250,00",
        bakiye: "0,00",
        aciklama1: "GELEN HAVALE ANON",
      },
    ])
  );
  pages.push(
    pageContent(2, [
      { type: "header_repeat" },
      {
        tarih: "12.01.2026",
        valor: "12.01.2026",
        fis: "F102",
        borc: "50,00",
        alacak: "0,00",
        bakiye: "200,00",
        aciklama1: "MASRAF ANON SAYFA IKI",
      },
    ])
  );

  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  let next = 3;
  for (let i = 0; i < pages.length; i += 1) {
    const pageObj = next;
    const contentObj = next + 1;
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> >>`;
    const stream = pages[i];
    objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    next += 2;
  }
  const fontObj = next;
  objects[fontObj] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i <= fontObj; i += 1) {
    offsets[i] = Buffer.byteLength(pdf, "latin1");
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${fontObj + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= fontObj; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${fontObj + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  const out = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) out[i] = pdf.charCodeAt(i) & 0xff;
  return out;
}

/** Anonim Ziraat internet bankacılığı dekont (tek hareket, sahiplik yok). */
export function buildZiraatDekontPdfFixture(overrides = {}) {
  const lines = [
    "T.C. Ziraat Bankasi A.S.",
    "Hesaptan TL Havale",
    "SUBE KODU/ADI : 307/ANON SUBESI",
    "VALOR : 12.08.2025",
    "Kanal : INTERNET",
    "Aciklama : ANON FIRMA ODEME REF 999",
    "Havale Tutari : 4.770,00 TRY",
    "18/12/2025-14:09:12 INTERNET",
    ...(overrides.extraLines || []),
  ];
  return buildTextPdf(lines, { pageCount: 1, bankLabel: "Ziraat Internet Bankaciligi" });
}

/**
 * Anonim dekont + etiketli IBAN tarafları (sahiplik testleri).
 * Gerçek kişi/firma PII yok — sentetik TR IBAN.
 */
export function buildZiraatDekontOwnershipPdfFixture({
  firmRole = "sender",
  firmIban = "TR330001000000000000000001",
  counterpartyIban = "TR330006200000000000000002",
  amount = "1.000,00",
  withFees = false,
} = {}) {
  const senderIban = firmRole === "sender" ? firmIban : counterpartyIban;
  const receiverIban = firmRole === "receiver" ? firmIban : counterpartyIban;
  const lines = [
    "T.C. Ziraat Bankasi A.S.",
    "Internet Bankaciligi Dekont",
    "VALOR : 12.08.2025",
    `Gonderen IBAN : ${senderIban}`,
    `Alici IBAN : ${receiverIban}`,
    "Aciklama : ANON TRANSFER REF 1001",
    `Havale Tutari : ${amount} TRY`,
  ];
  if (withFees) {
    lines.push("Masraf : 5,00 TRY", "BSMV : 1,00 TRY", "Toplam Masraf : 6,00 TRY");
  }
  lines.push("12/08/2025-10:00:00 INTERNET");
  return buildTextPdf(lines, { pageCount: 1, bankLabel: "Ziraat Internet Bankaciligi" });
}

