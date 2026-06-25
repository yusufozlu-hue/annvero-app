import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

function excelDateToText(value: any) {
  if (!value) return "";

  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (!date) return String(value);

    const day = String(date.d).padStart(2, "0");
    const month = String(date.m).padStart(2, "0");
    const year = date.y;

    return `${day}.${month}.${year}`;
  }

  return String(value);
}

function sayi(value: any) {
  return Number(value || 0);
}

function normalizeTr(value: any) {
  return String(value || "")
    .toUpperCase()
    .replaceAll("İ", "I")
    .replaceAll("Ş", "S")
    .replaceAll("Ğ", "G")
    .replaceAll("Ü", "U")
    .replaceAll("Ö", "O")
    .replaceAll("Ç", "C");
}

// Açıklama ve evrak/fatura no'dan belge türünü otomatik üretir.
function belgeTuruBelirle(row: any, mevcut: string) {
  const explicit = String(mevcut || "").trim();
  if (explicit) return explicit;

  const aciklama = normalizeTr(row["Açıklama"]);
  const evrakNo = normalizeTr(
    row["Belge No"] || row["Evrak No"] || row["Fatura No"] || ""
  );
  const text = `${aciklama} ${evrakNo}`.trim();

  if (!text) return "";

  const baslar = (prefix: string) => new RegExp(`(^|\\s)${prefix}`).test(text);

  // 1-2: GIB veya MDA ile başlayan → EA
  if (baslar("GIB") || baslar("MDA")) return "EA";

  // 3: MRT / MR1 / MDF ile başlayan → EF
  if (baslar("MRT") || baslar("MR1") || baslar("MDF")) return "EF";

  // 4: Noter → NM
  if (text.includes("NOTER")) return "NM";

  // 5: Serbest meslek makbuzu → SMM
  if (
    text.includes("SMM") ||
    text.includes("SERBEST MESLEK") ||
    text.includes("YUSUF OZLU") ||
    text.includes("BATUHAN BULUT")
  ) {
    return "SMM";
  }

  // 6: Banka/dekont hareketleri → DK
  if (
    text.includes("DEKONT") ||
    text.includes("HAVALE") ||
    text.includes("EFT") ||
    text.includes("BANKA") ||
    text.includes("POS") ||
    text.includes("KREDI KART") ||
    text.includes("VIRMAN")
  ) {
    return "DK";
  }

  // 7: Açıklamada "Fatura" geçiyorsa → EF
  if (text.includes("FATURA")) return "EF";

  return "";
}

function riskSeviyesiHesapla(riskPuani: number) {
  if (riskPuani >= 50) return "Yüksek";
  if (riskPuani >= 20) return "Orta";
  return "Düşük";
}

// Satır (line) bazlı kontroller. Borç/Alacak dengesi BURADA kontrol edilmez;
// denge yalnızca Fiş No bazında, gruplama sonrası hesaplanır.
function satirRiskAnaliz(row: any, belgeTuru: string) {
  const riskler: string[] = [];
  let riskPuani = 0;

  const belgeNo = row["Belge No"] || "";
  const aciklama = row["Açıklama"] || "";
  const fisNo = row["Fiş Numarası"] || row["Fiş No"] || "";

  if (!aciklama) {
    riskler.push("Açıklama boş");
    riskPuani += 20;
  }

  if (!belgeTuru) {
    riskler.push("Belge türü boş");
    riskPuani += 15;
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

  if (
    belgeNo &&
    belgeNo.toString().trim() !== "" &&
    belgeNo.toString().length > 5
  ) {
    const ayniBelge = globalThis.__belgeler || {};

    if (ayniBelge[belgeNo]) {
      riskler.push("Mükerrer belge no");
      riskPuani += 45;
    } else {
      ayniBelge[belgeNo] = true;
    }

    globalThis.__belgeler = ayniBelge;
  }

  return { riskler, riskPuani };
}

export async function POST(req: NextRequest) {
  try {
    globalThis.__belgeler = {};
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "Dosya bulunamadı" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();

    const workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: false,
    });

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

    const rows: any[] = XLSX.utils.sheet_to_json(firstSheet, {
      defval: "",
      raw: true,
    });

    const satirlar = rows
      .filter((row) => row["Fiş Numarası"] || row["Fiş No"])
      .map((row: any, index: number) => {
        const belgeTuru = belgeTuruBelirle(
          row,
          row["Belge Tipi"] || row["Belge Türü"] || ""
        );
        const risk = satirRiskAnaliz(row, belgeTuru);

        return {
          id: index + 1,
          fisNo: row["Fiş Numarası"] || row["Fiş No"] || "",
          tarih: excelDateToText(row["Fiş Tarihi"] || row["Tarih"]),
          belgeTuru,
          belgeNo: row["Belge No"] || "",
          aciklama: row["Açıklama"] || "",
          borc: sayi(row["Toplam Borç"] || row["Borç"]),
          alacak: sayi(row["Toplam Alacak"] || row["Alacak"]),
          riskler: risk.riskler,
          riskPuani: risk.riskPuani,
        };
      });

    // Denge kontrolü Fiş No bazında yapılır
    const fisGruplari: Record<
      string,
      { borc: number; alacak: number; satirlar: typeof satirlar }
    > = {};

    for (const satir of satirlar) {
      const key = String(satir.fisNo);
      if (!fisGruplari[key]) {
        fisGruplari[key] = { borc: 0, alacak: 0, satirlar: [] };
      }
      fisGruplari[key].borc += satir.borc;
      fisGruplari[key].alacak += satir.alacak;
      fisGruplari[key].satirlar.push(satir);
    }

    let dengeliFis = 0;
    let dengesizFis = 0;
    const dengesizFisler: {
      fisNo: string;
      borc: number;
      alacak: number;
      fark: number;
    }[] = [];

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

        // "Fiş dengesi bozuk" uyarısı yalnızca fişin ilk satırına yazılır,
        // her satıra tekrar yazılmaz. Risk puanı sadece burada artar.
        const ilkSatir = grup.satirlar[0];
        ilkSatir.riskler.push("Fiş dengesi bozuk");
        ilkSatir.riskPuani += 50;
      } else {
        dengeliFis += 1;
      }
    }

    const fisler = satirlar.map((satir) => {
      const riskMetni = satir.riskler.length
        ? satir.riskler.join(", ")
        : "Sorun yok";

      return {
        ...satir,
        risk: riskMetni,
        riskSeviyesi: riskSeviyesiHesapla(satir.riskPuani),
        durum: riskMetni === "Sorun yok" ? "Temiz" : "Riskli",
      };
    });

    const toplamFis = Object.keys(fisGruplari).length;
    const toplamSatir = fisler.length;
    const riskliFisSayisi = fisler.filter((f) => f.durum === "Riskli").length;
    const yuksekRisk = fisler.filter((f) => f.riskSeviyesi === "Yüksek").length;
    const ortaRisk = fisler.filter((f) => f.riskSeviyesi === "Orta").length;
    const dusukRisk = fisler.filter((f) => f.riskSeviyesi === "Düşük").length;
    const aciklamaEksikSatir = fisler.filter((f) =>
      f.riskler.includes("Açıklama boş")
    ).length;
    const belgeTuruEksikSatir = fisler.filter((f) =>
      f.riskler.includes("Belge türü boş")
    ).length;
    const eksikAciklama = aciklamaEksikSatir;
    const belgesizFatura = fisler.filter((f) =>
      f.riskler.includes("Fatura belge no boş")
    ).length;

    return NextResponse.json({
      success: true,
      toplamFis,
      toplamSatir,
      riskliFisSayisi,
      yuksekRisk,
      ortaRisk,
      dusukRisk,
      dengeliFis,
      dengesizFis,
      dengesizFisler,
      aciklamaEksikSatir,
      belgeTuruEksikSatir,
      eksikAciklama,
      belgesizFatura,
      fisler,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "İşlem hatası" }, { status: 500 });
  }
}