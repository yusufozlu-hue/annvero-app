type Banka = "TEB" | "GARANTI" | "VAKIF" | "KUVEYT" | "ZIRAAT";

const bankaHesapKodlari: Record<Banka, string> = {
  TEB: "102.01.003",
  GARANTI: "102.01.001",
  VAKIF: "102.01.004",
  KUVEYT: "102.01.005",
  ZIRAAT: "102.01.006",
};

export function lucaConverter(items: any[], banka: Banka) {
  const result: any[] = [];
  let fisNo = 1;

  items.forEach((item: any) => {
    if (item.anaTutar > 0) {
      result.push({
        "Fiş No": fisNo,
        "Fiş Tarihi": item.tarih,
        "Fiş Açıklama": item.aciklama || "BANKA HAREKETİ",
        "Hesap Kodu": "320.01.001",
        "Evrak No": "",
        "Evrak Tarihi": item.tarih,
        "Detay Açıklama": item.aciklama || "BANKA HAREKETİ",
        Borç: Number(item.anaTutar.toFixed(2)),
        Alacak: "",
        Miktar: "",
        "Belge Türü": "DK",
        "Para Birimi": "",
        Kur: "",
        "Döviz Tutar": "",
      });

      result.push({
        "Fiş No": fisNo,
        "Fiş Tarihi": item.tarih,
        "Fiş Açıklama": item.aciklama || "BANKA HAREKETİ",
        "Hesap Kodu": bankaHesapKodlari[banka],
        "Evrak No": "",
        "Evrak Tarihi": item.tarih,
        "Detay Açıklama": item.aciklama || "BANKA HAREKETİ",
        Borç: "",
        Alacak: Number(item.anaTutar.toFixed(2)),
        Miktar: "",
        "Belge Türü": "DK",
        "Para Birimi": "",
        Kur: "",
        "Döviz Tutar": "",
      });

      fisNo++;
    }

    if (item.masrafTutar > 0) {
      result.push({
        "Fiş No": fisNo,
        "Fiş Tarihi": item.tarih,
        "Fiş Açıklama": "HAVALE/EFT MASRAFI",
        "Hesap Kodu": "780.01.001",
        "Evrak No": "",
        "Evrak Tarihi": item.tarih,
        "Detay Açıklama": "HAVALE/EFT MASRAFI",
        Borç: Number(item.masrafTutar.toFixed(2)),
        Alacak: "",
        Miktar: "",
        "Belge Türü": "DK",
        "Para Birimi": "",
        Kur: "",
        "Döviz Tutar": "",
      });

      result.push({
        "Fiş No": fisNo,
        "Fiş Tarihi": item.tarih,
        "Fiş Açıklama": "HAVALE/EFT MASRAFI",
        "Hesap Kodu": bankaHesapKodlari[banka],
        "Evrak No": "",
        "Evrak Tarihi": item.tarih,
        "Detay Açıklama": "HAVALE/EFT MASRAFI",
        Borç: "",
        Alacak: Number(item.masrafTutar.toFixed(2)),
        Miktar: "",
        "Belge Türü": "DK",
        "Para Birimi": "",
        Kur: "",
        "Döviz Tutar": "",
      });

      fisNo++;
    }
  });

  return result;
}

export function splitByFis(rows: any[], limit = 50) {
  const fisNos = Array.from(
    new Set(rows.map((row) => row["Fiş No"]))
  );

  const chunks: any[][] = [];

  for (let i = 0; i < fisNos.length; i += limit) {
    const selectedFisNos = fisNos.slice(i, i + limit);

    chunks.push(
      rows.filter((row) =>
        selectedFisNos.includes(row["Fiş No"])
      )
    );
  }

  return chunks;
}

export function getFisRange(rows: any[]) {
  const fisNos = rows.map((row) => Number(row["Fiş No"]));
  return {
    start: Math.min(...fisNos),
    end: Math.max(...fisNos),
  };
}