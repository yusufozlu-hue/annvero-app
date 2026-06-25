export function vakifParser(jsonData: any[]) {
    const grouped: Record<string, any> = {};
  
    jsonData.forEach((row, index) => {
      const tarih =
        row.Tarih ||
        row["İşlem Tarihi"] ||
        row["Islem Tarihi"] ||
        row["TARİH"] ||
        row["TARIH"] ||
        "";
  
      const dekont = String(
        row.Dekont ||
          row["Dekont No"] ||
          row["Fiş No"] ||
          row["Fis No"] ||
          row["İşlem No"] ||
          row["Islem No"] ||
          index + 1
      );
  
      const aciklama = String(
        row.Açıklama ||
          row.Aciklama ||
          row["İşlem Açıklaması"] ||
          row["Islem Aciklamasi"] ||
          row["AÇIKLAMA"] ||
          row["ACIKLAMA"] ||
          ""
      );
  
      const unvan = String(
        row.Unvan ||
          row["Karşı Hesap"] ||
          row["Karsi Hesap"] ||
          row["Ad Soyad"] ||
          ""
      );
  
      const tutar = Number(
        row.Tutar ||
          row["İşlem Tutarı"] ||
          row["Islem Tutari"] ||
          row["TUTAR"] ||
          0
      );
  
      if (!grouped[dekont]) {
        grouped[dekont] = {
          tarih,
          dekont,
          unvan,
          anaTutar: 0,
          masrafTutar: 0,
          aciklama: "",
        };
      }
  
      const isMasraf =
        aciklama.includes("Ücret") ||
        aciklama.includes("Ucret") ||
        aciklama.includes("Masraf") ||
        aciklama.includes("Komisyon") ||
        aciklama.includes("BSMV");
  
      if (isMasraf) {
        grouped[dekont].masrafTutar += Math.abs(tutar);
      } else {
        grouped[dekont].anaTutar += Math.abs(tutar);
        grouped[dekont].aciklama = aciklama;
        grouped[dekont].unvan = unvan;
      }
    });
  
    return Object.values(grouped);
  }