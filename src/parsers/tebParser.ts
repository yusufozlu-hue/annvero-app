export function tebParser(jsonData: any[]) {
    const grouped: Record<string, any> = {};
  
    jsonData.forEach((row) => {
      const tarih = row.Tarih || "";
      const dekont = String(row.Dekont || "");
      const aciklama = String(row.Açıklama || "");
      const unvan = String(row.Unvan || "");
      const tutar = Number(row.Tutar || 0);
  
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
        aciklama.includes("Masraf") ||
        aciklama.includes("Komisyon") ||
        aciklama.includes("BSMV");
  
      if (isMasraf) {
        grouped[dekont].masrafTutar += Math.abs(tutar);
      } else {
        grouped[dekont].anaTutar += Math.abs(tutar);
        grouped[dekont].aciklama = aciklama;
      }
    });
  
    return Object.values(grouped);
  }