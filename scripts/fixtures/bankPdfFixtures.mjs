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
