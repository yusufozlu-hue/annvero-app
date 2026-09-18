/**
 * TEB PDF layout — sentetik (anon) + fail-closed; gerçek dosya ayrı gate.
 */
import assert from "node:assert/strict";
import {
  looksLikeTebPdfLayout,
  looksLikeTebBankBrand,
  parseTebPdfLayout,
  TEB_PDF_LAYOUT_UNSUPPORTED,
} from "../src/utils/bankPdf/tebPdfLayout.js";
import {
  PDF_MAX_BYTES,
  PDF_MAX_PAGES,
  PDF_MAX_BYTES_TEB_TEXT_NATIVE,
  PDF_MAX_PAGES_TEB_TEXT_NATIVE,
} from "../src/utils/bankStatementPdf.js";

assert.equal(PDF_MAX_BYTES, 8 * 1024 * 1024);
assert.equal(PDF_MAX_PAGES, 80);
assert.equal(PDF_MAX_BYTES_TEB_TEXT_NATIVE, 16 * 1024 * 1024);
assert.equal(PDF_MAX_PAGES_TEB_TEXT_NATIVE, 150);

assert.equal(looksLikeTebBankBrand("Türkiye Ekonomi Bankası A.Ş."), true);
assert.equal(looksLikeTebBankBrand("Garanti BBVA"), false);

const layoutText = `
TEB Hesap Hareketleri
Tarih Valör Saat Açıklama Banka Unvan Tutar Bakiye Dekont EFT Sorgu No Müşteri Referansı
12.09.2025 12.09.2025 09:00 HAVALE ANON TEB ANON -10,00 90,00 D1
`;
assert.equal(looksLikeTebPdfLayout(layoutText), true);
assert.equal(looksLikeTebPdfLayout("random pdf without columns"), false);

// items required — text alone → unsupported
const noItems = parseTebPdfLayout({ text: layoutText, pagesItems: null });
assert.equal(noItems.code, TEB_PDF_LAYOUT_UNSUPPORTED);
assert.equal((noItems.transactions || []).length, 0);

// Minimal synthetic coords (landscape bands)
const bands = {
  page: 1,
  items: [
    { str: "Tarih", x: 45, y: 545, w: 20, h: 8 },
    { str: "Valör", x: 86, y: 545, w: 20, h: 8 },
    { str: "Saat", x: 126, y: 545, w: 20, h: 8 },
    { str: "İşlemi Giren", x: 152, y: 545, w: 30, h: 8 },
    { str: "Açıklama", x: 197, y: 545, w: 30, h: 8 },
    { str: "Banka", x: 282, y: 545, w: 20, h: 8 },
    { str: "Unvan", x: 363, y: 545, w: 20, h: 8 },
    { str: "Alıcı Hesap / IBAN / Kart No", x: 420, y: 545, w: 40, h: 8 },
    { str: "Özel İşlem Açıklaması", x: 519, y: 545, w: 40, h: 8 },
    { str: "EFT", x: 604, y: 545, w: 15, h: 8 },
    { str: "Tutar", x: 638, y: 545, w: 20, h: 8 },
    { str: "Bakiye", x: 688, y: 545, w: 20, h: 8 },
    { str: "Dekont", x: 737, y: 545, w: 20, h: 8 },
    { str: "Referans", x: 768, y: 538, w: 20, h: 8 },
    // devir
    { str: "Devir Bakiyesi", x: 197, y: 520, w: 60, h: 8 },
    { str: "1.000,00", x: 688, y: 520, w: 30, h: 8 },
    // movement + fee + bsmv same time/dekont
    { str: "10.01.2026", x: 45, y: 500, w: 30, h: 8 },
    { str: "10.01.2026", x: 86, y: 500, w: 30, h: 8 },
    { str: "09:15", x: 126, y: 500, w: 20, h: 8 },
    { str: "ANON", x: 152, y: 500, w: 20, h: 8 },
    { str: "HAVALE GIDEN ANON", x: 197, y: 500, w: 50, h: 8 },
    { str: "TEB", x: 282, y: 500, w: 15, h: 8 },
    { str: "ANON ALICI", x: 363, y: 500, w: 30, h: 8 },
    { str: "-100,00", x: 638, y: 500, w: 25, h: 8 },
    { str: "900,00", x: 688, y: 500, w: 25, h: 8 },
    { str: "D10", x: 737, y: 500, w: 15, h: 8 },
    { str: "10.01.2026", x: 45, y: 485, w: 30, h: 8 },
    { str: "10.01.2026", x: 86, y: 485, w: 30, h: 8 },
    { str: "09:15", x: 126, y: 485, w: 20, h: 8 },
    { str: "HAVALE UCRETI", x: 197, y: 485, w: 40, h: 8 },
    { str: "-5,00", x: 638, y: 485, w: 20, h: 8 },
    { str: "895,00", x: 688, y: 485, w: 20, h: 8 },
    { str: "D10", x: 737, y: 485, w: 15, h: 8 },
    { str: "10.01.2026", x: 45, y: 470, w: 30, h: 8 },
    { str: "10.01.2026", x: 86, y: 470, w: 30, h: 8 },
    { str: "09:15", x: 126, y: 470, w: 20, h: 8 },
    { str: "BSMV", x: 197, y: 470, w: 20, h: 8 },
    { str: "-0,25", x: 638, y: 470, w: 20, h: 8 },
    { str: "894,75", x: 688, y: 470, w: 20, h: 8 },
    { str: "D10", x: 737, y: 470, w: 15, h: 8 },
    // wrap continuation for next movement
    { str: "11.01.2026", x: 45, y: 450, w: 30, h: 8 },
    { str: "11.01.2026", x: 86, y: 450, w: 30, h: 8 },
    { str: "14:30", x: 126, y: 450, w: 20, h: 8 },
    { str: "EFT GELEN", x: 197, y: 450, w: 30, h: 8 },
    { str: "200,50", x: 638, y: 450, w: 25, h: 8 },
    { str: "1.095,25", x: 688, y: 450, w: 30, h: 8 },
    { str: "D20", x: 737, y: 450, w: 15, h: 8 },
    { str: "ANON DEVAM", x: 197, y: 435, w: 40, h: 8 },
  ],
};

const parsed = parseTebPdfLayout({
  text: layoutText,
  pagesItems: [bands],
  context: {},
});
assert.equal(parsed.ok, true);
assert.equal(parsed.bank, "TEB");
assert.equal((parsed.transactions || []).length, 4);
assert.equal(parsed.openingBalanceHint, 1000);
// same hour/dekont → 3 separate movements
const sameDekont = parsed.transactions.filter((t) => t.documentNo === "D10");
assert.equal(sameDekont.length, 3);
assert.ok(parsed.transactions[3].description.includes("EFT GELEN"));
assert.ok(parsed.transactions[3].description.includes("ANON DEVAM"));
assert.equal(parsed.transactions[0].transactionTime, "09:15");
assert.equal(Number(parsed.transactions[0].amount), -100);

console.log("OK — TEB PDF layout synthetic + limits");
