import * as XLSX from "xlsx";
import { safeRead } from "@/src/utils/safeXlsx";
import {
  buildElektrawebPreviewRows,
  finalizeStandardLucaRow,
  getRowValue,
  logStandardLucaReport,
  normalizeElektrawebRawToStandardLucaRow,
  sortStandardLucaRows,
} from "@/src/utils/standardLucaRow";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";

function riskSeviyesiHesapla(riskPuani) {
  if (riskPuani >= 50) return "Yüksek";
  if (riskPuani >= 20) return "Orta";
  return "Düşük";
}

function satirRiskAnaliz(row) {
  const riskler = [];
  let riskPuani = 0;
  let riskDurumu = row.riskDurumu || "";

  const belgeNo = row.belgeNo || "";
  const aciklama = row.detayAciklama || row.fisAciklama || row.aciklama || "";
  const fisNo = row.fisNo || "";
  const belgeTuru = row.belgeTuru || "";
  const hesapKodu = row.hesapKodu || "";

  if (!aciklama) {
    riskler.push("Açıklama boş");
    riskPuani += 20;
  }

  if (!belgeTuru) {
    riskler.push("Belge türü boş");
    riskPuani += 15;
  }

  if (!hesapKodu) {
    riskler.push("Hesap kodu boş");
    riskPuani += 20;
    riskDurumu = riskDurumu || "HESAP_EKSIK";
  }

  if (belgeTuru === "Fatura" && !belgeNo) {
    riskler.push("Fatura belge no boş");
    riskPuani += 25;
  }

  if (belgeTuru === "Makbuz" && !aciklama) {
    riskler.push("Makbuz açıklama boş");
    riskPuani += 20;
  }

  if (aciklama.length > 0 && aciklama.length < 10) {
    riskler.push("Açıklama çok kısa");
    riskPuani += 10;
  }

  if (!fisNo) {
    riskler.push("Fiş numarası boş");
    riskPuani += 30;
  }

  return { riskler, riskPuani, riskDurumu };
}

function parseWorkbookRows(workbook) {
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

  return XLSX.utils.sheet_to_json(firstSheet, {
    defval: "",
    raw: false,
  });
}

function attachFisBalanceRisk(satirlar) {
  const fisGruplari = {};

  for (const satir of satirlar) {
    const key = String(satir.fisNo);
    if (!fisGruplari[key]) {
      fisGruplari[key] = { borc: 0, alacak: 0, satirlar: [] };
    }
    fisGruplari[key].borc += Number(satir.borc || 0);
    fisGruplari[key].alacak += Number(satir.alacak || 0);
    fisGruplari[key].satirlar.push(satir);
  }

  let dengeliFis = 0;
  let dengesizFis = 0;
  const dengesizFisler = [];

  for (const [fisNo, grup] of Object.entries(fisGruplari)) {
    const fark = Number((grup.borc - grup.alacak).toFixed(2));

    if (Math.abs(fark) > 0.01) {
      dengesizFis += 1;
      dengesizFisler.push({
        fisNo,
        borc: Number(grup.borc.toFixed(2)),
        alacak: Number(grup.alacak.toFixed(2)),
        fark,
      });

      const ilkSatir = grup.satirlar[0];
      ilkSatir.riskler = [...(ilkSatir.riskler || []), "Fiş dengesi bozuk"];
      ilkSatir.riskPuani = Number(ilkSatir.riskPuani || 0) + 50;
      ilkSatir.kontrolNotu = [ilkSatir.kontrolNotu, "Fiş dengesi bozuk"]
        .filter(Boolean)
        .join(", ");
    } else {
      dengeliFis += 1;
    }
  }

  return {
    fisGruplari,
    dengeliFis,
    dengesizFis,
    dengesizFisler,
  };
}

function buildResponseStats(standardLucaRows, fisGruplari, balanceStats) {
  const toplamFis = Object.keys(fisGruplari).length;
  const toplamSatir = standardLucaRows.length;
  const riskliFisSayisi = standardLucaRows.filter((f) => f.durum === "Riskli").length;
  const yuksekRisk = standardLucaRows.filter((f) => f.riskSeviyesi === "Yüksek").length;
  const ortaRisk = standardLucaRows.filter((f) => f.riskSeviyesi === "Orta").length;
  const dusukRisk = standardLucaRows.filter((f) => f.riskSeviyesi === "Düşük").length;
  const aciklamaEksikSatir = standardLucaRows.filter((f) =>
    f.riskler?.includes("Açıklama boş")
  ).length;
  const belgeTuruEksikSatir = standardLucaRows.filter((f) =>
    f.riskler?.includes("Belge türü boş")
  ).length;

  return {
    toplamFis,
    toplamSatir,
    riskliFisSayisi,
    yuksekRisk,
    ortaRisk,
    dusukRisk,
    dengeliFis: balanceStats.dengeliFis,
    dengesizFis: balanceStats.dengesizFis,
    dengesizFisler: balanceStats.dengesizFisler,
    aciklamaEksikSatir,
    belgeTuruEksikSatir,
    eksikAciklama: aciklamaEksikSatir,
    belgesizFatura: standardLucaRows.filter((f) =>
      f.riskler?.includes("Fatura belge no boş")
    ).length,
  };
}

export function processElektrawebWorkbook(workbook, matchingContext = {}) {
  const belgeler = {};

  const rows = parseWorkbookRows(workbook);

  console.log("[elektraweb-parser] raw row sample:", rows.slice(0, 2));

  const normalizedRows = rows
    .filter((row) => row["Fiş Numarası"] || row["Fiş No"])
    .map((row, index) =>
      normalizeElektrawebRawToStandardLucaRow(row, {
        index,
        firmaId: matchingContext.firmaId || "",
        kaynakAdi: matchingContext.kaynakAdi || "ELEKTRAWEB",
        documentSeriesRules: matchingContext.documentSeriesRules || [],
      })
    );

  console.log(
    "[elektraweb-money-debug]",
    rows.slice(0, 20).map((rawRow) => {
      const hamBorc = getRowValue(
        rawRow,
        "Borç",
        "Borc",
        "Toplam Borç",
        "Toplam Borc"
      );
      const hamAlacak = getRowValue(rawRow, "Alacak", "Toplam Alacak");

      return {
        hamBorc,
        hamAlacak,
        parsedBorc: parseMoneyTR(hamBorc),
        parsedAlacak: parseMoneyTR(hamAlacak),
      };
    })
  );

  const parsedRows = sortStandardLucaRows(
    normalizedRows.map((row) => {
      const risk = satirRiskAnaliz(row);
      const riskler = [...risk.riskler];
      let riskPuani = risk.riskPuani;

      const belgeNo = row.belgeNo || row.evrakNo || "";
      if (
        belgeNo &&
        String(belgeNo).trim() !== "" &&
        String(belgeNo).length > 5
      ) {
        const belgeKey = String(belgeNo);
        if (belgeler[belgeKey]) {
          riskler.push("Mükerrer belge no");
          riskPuani += 45;
        } else {
          belgeler[belgeKey] = true;
        }
      }

      return finalizeStandardLucaRow({
        ...row,
        riskDurumu: risk.riskDurumu,
        kontrolNotu: row.kontrolNotu || (riskler.length ? riskler.join(", ") : ""),
        riskler,
        riskPuani,
      });
    })
  );

  const balanceStats = attachFisBalanceRisk(parsedRows);

  const standardLucaRows = buildElektrawebPreviewRows(parsedRows, {
    firmaId: matchingContext.firmaId || "",
    kaynakAdi: matchingContext.kaynakAdi || "ELEKTRAWEB",
    selectedCompanyAccountPlan:
      matchingContext.selectedCompanyAccountPlan ||
      matchingContext.normalizedAccountPlan ||
      matchingContext.accountPlan ||
      [],
    normalizedAccountPlan:
      matchingContext.normalizedAccountPlan ||
      matchingContext.selectedCompanyAccountPlan ||
      matchingContext.accountPlan ||
      [],
    learningMemory: matchingContext.learningMemory || [],
    companyMappings: matchingContext.companyMappings || {},
    documentSeriesRules: matchingContext.documentSeriesRules || [],
    accountingRules: matchingContext.accountingRules || {},
    employees: matchingContext.employees || [],
  }).map((row) => {
    const riskMetni = row.kontrolNotu || "Sorun yok";

    return {
      ...row,
      risk: row.risk || riskMetni,
      riskSeviyesi: riskSeviyesiHesapla(Number(row.riskPuani || 0)),
      durum: riskMetni === "Sorun yok" ? "Temiz" : "Riskli",
    };
  });

  console.log("ELEKTRAWEB ROUTE OUTPUT", standardLucaRows.slice(0, 10));
  logStandardLucaReport("elektraweb-route", standardLucaRows);

  return {
    standardLucaRows,
    fisler: standardLucaRows,
    ...buildResponseStats(standardLucaRows, balanceStats.fisGruplari, balanceStats),
  };
}

export function processElektrawebFile(buffer, matchingContext = {}) {
  const workbook = safeRead(buffer, {
    type: "array",
    cellDates: true,
  });

  return processElektrawebWorkbook(workbook, matchingContext);
}
