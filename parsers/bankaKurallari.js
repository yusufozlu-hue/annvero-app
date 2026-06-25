export const bankaKurallari = [
    // BANKA MASRAFLARI
    {
      anahtarlar: [
        "FAST ÜCRETİ",
        "FAST UCRETI",
        "HAVALE ÜCRETİ",
        "HAVALE UCRETI",
        "EFT ÜCRETİ",
        "EFT UCRETI",
        "BSMV",
        "KESİNTİ",
        "KESINTI",
        "BKM.ÜCR",
        "BKM UCR",
        "BKM UCRET",
        "MASRAF",
        "KOMİSYON",
        "KOMISYON",
      ],
      hesap: "780.01.001",
      aciklama: "HAVALE/EFT MASRAFI",
    },
  
    // MAAŞ / AVANS
    {
      anahtarlar: [
        "MAAŞ AVANSI",
        "MAAS AVANSI",
        "HAZİRAN ÖN AVANS",
        "HAZIRAN ON AVANS",
        "ÖN AVANS",
        "ON AVANS",
      ],
      hesap: "196.01.001",
      aciklama: "MAAŞ AVANSI ÖDEMESİ",
    },
  
    {
      anahtarlar: [
        "MAAŞ ÖDEMESİ",
        "MAAS ODEMESI",
        "HAZİRAN MAAŞ",
        "HAZIRAN MAAS",
        "MAAŞ",
        "MAAS",
      ],
      hesap: "335.01.001",
      aciklama: "MAAŞ ÖDEMESİ",
    },
  
    // KREDİ KARTI
    {
      anahtarlar: [
        "KREDİ KART",
        "KREDI KART",
        "EKSTRE BORÇ",
        "EKSTRE BORC",
        "KART EKSTRE",
      ],
      hesap: "309.01.001",
      aciklama: "KREDİ KARTI EKSTRE ÖDEMESİ",
    },
  
    // DÖVİZ
    {
      anahtarlar: [
        "DÖVİZ ALIŞ",
        "DOVIZ ALIS",
        "DÖVİZ SATIŞ",
        "DOVIZ SATIS",
        "DÖVİZ ALIŞ / SATIŞ",
        "DOVIZ ALIS / SATIS",
      ],
      hesap: "120.01.001",
      aciklama: "DÖVİZ ALIŞ / SATIŞ İŞLEMİ",
    },
  
    // VERGİ / SGK
    {
      anahtarlar: ["SGK", "SOSYAL GÜVENLİK", "SOSYAL GUVENLIK"],
      hesap: "361.01.001",
      aciklama: "SGK ÖDEMESİ",
    },
  
    {
      anahtarlar: ["VERGİ", "VERGI", "GİB", "GIB", "IVD", "İNTERAKTİF VERGİ"],
      hesap: "360.01.001",
      aciklama: "VERGİ ÖDEMESİ",
    },
  
    // ZİRAAT ÖZEL GİDERLER
    {
      anahtarlar: [
        "İPOTEK TESİS ÜCRETİ",
        "IPOTEK TESIS UCRETI",
        "İPOTEK",
        "IPOTEK",
      ],
      hesap: "770.01.010",
      aciklama: "İPOTEK TESİS ÜCRETİ",
    },
  
    {
      anahtarlar: [
        "EKSPERTİZ",
        "EKSPERTIZ",
        "EKSPERTİZ MÜŞ",
        "EKSPERTIZ MUS",
        "KURUMSAL KREDİLER TAHSİLAT",
        "KURUMSAL KREDILER TAHSILAT",
      ],
      hesap: "770.01.011",
      aciklama: "EKSPERTİZ / KREDİ TAHSİLAT GİDERİ",
    },
  
    // ARAÇ / HGS
    {
      anahtarlar: ["HGS"],
      hesap: "770.01.050",
      aciklama: "HGS GEÇİŞ/YÜKLEME BEDELİ",
      ozelIslem: "BINEK_ARAC_GIDER_KISITLAMASI",
      giderOrani: 0.7,
      kkegOrani: 0.3,
      kkegHesap: "689.01.7194",
      kkegAciklama: "7194 SK GİDER KISITLAMASI",
    },
  
    // CARİLER
    {
      anahtarlar: [
        "TTLKOM",
        "TURK TELEKOM",
        "TÜRK TELEKOM",
        "TÜRK TELEKOMÜNİKASYON",
        "TURK TELEKOMUNIKASYON",
      ],
      hesap: "320.01.100",
      aciklama: "GÖND. HVL / TÜRK TELEKOMÜNİKASYON A.Ş.",
    },
  
    {
      anahtarlar: ["TTNET", "TTNET A.Ş", "TTNET A.S"],
      hesap: "320.01.101",
      aciklama: "GÖND. HVL / TTNET A.Ş.",
    },
  
    {
      anahtarlar: ["AYDEME", "AYDEM"],
      hesap: "320.01.200",
      aciklama: "GÖND. HVL / AYDEM ELEKTRİK",
    },
  
    {
      anahtarlar: ["BEDAŞ", "BEDAS"],
      hesap: "320.01.300",
      aciklama: "GÖND. HVL / BEDAŞ",
    },
  
    {
      anahtarlar: ["TURKCELL"],
      hesap: "320.01.400",
      aciklama: "GÖND. HVL / TURKCELL",
    },
  
    {
      anahtarlar: ["VODAFONE"],
      hesap: "320.01.500",
      aciklama: "GÖND. HVL / VODAFONE",
    },
  
    {
      anahtarlar: ["TÜRKİYE GARANTİ BANKASI", "TURKIYE GARANTI BANKASI"],
      hesap: "320.01.801",
      aciklama: "GÖND. HVL / TÜRKİYE GARANTİ BANKASI A.Ş.",
    },
  
    {
      anahtarlar: ["TÜRKİYE VAKIFLAR BANKASI", "TURKIYE VAKIFLAR BANKASI"],
      hesap: "320.01.802",
      aciklama: "GÖND. HVL / TÜRKİYE VAKIFLAR BANKASI T.A.O.",
    },
  
    {
      anahtarlar: ["MURAT YUSUF BİRLİK", "MURAT YUSUF BIRLIK"],
      hesap: "320.01.803",
      aciklama: "GÖND. HVL / MURAT YUSUF BİRLİK",
    },
  
    {
      anahtarlar: ["KORAY GÖKSU", "KORAY GOKSU"],
      hesap: "331.01.001",
      aciklama: "GÖND. HVL / KORAY GÖKSU",
    },
  
    {
      anahtarlar: ["YUSUF ÖZLÜ", "YUSUF OZLU"],
      hesap: "320.01.900",
      aciklama: "GÖND. HVL / YUSUF ÖZLÜ",
    },
  
    {
      anahtarlar: ["ALI YAVUZ", "ALİ YAVUZ"],
      hesap: "335.01.010",
      aciklama: "GÖND. HVL / ALİ YAVUZ",
    },
  
    {
      anahtarlar: ["SERCAN SEVİM", "SERCAN SEVIM"],
      hesap: "335.01.011",
      aciklama: "GÖND. HVL / SERCAN SEVİM",
    },
  
    {
      anahtarlar: ["DENİZ BASMACI", "DENIZ BASMACI"],
      hesap: "320.01.910",
      aciklama: "GÖND. HVL / DENİZ BASMACI",
    },
  
    {
      anahtarlar: ["ACAR FİKRİ", "ACAR FIKRI"],
      hesap: "320.01.911",
      aciklama: "GÖND. HVL / ACAR FİKRİ MÜLKİYET",
    },
  
    {
      anahtarlar: ["AYSU DIŞ TİCARET", "AYSU DIS TICARET"],
      hesap: "120.01.001",
      aciklama: "GLN. HVL / AYSU DIŞ TİCARET VE YAPI SANAYİ A.Ş.",
    },
  ];