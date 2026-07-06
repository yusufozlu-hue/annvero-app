import {
  KURGAN_DATA_SOURCE,
  KURGAN_RISK_LEVEL,
  KURGAN_RISK_STATUS,
  KURGAN_RISK_THRESHOLDS,
  KURGAN_RISK_TYPE,
  KURGAN_SNAPSHOT_KEY,
  KURGAN_STORAGE_KEY,
  resolveRiskLevelFromRatio,
} from "@/src/config/kurganRiskDefaults";
import { loadDeclarationAccrualRecords } from "@/src/utils/beyannameTahakkukEngine";
import { loadPendingLucaRows } from "@/src/utils/companyCenter";
import { formatDateTR } from "@/src/utils/formatDateTR";
import { parseMoneyTR } from "@/src/utils/parseMoneyTR";
import { normalizeParserText } from "@/src/utils/textNormalize";

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function compactText(value) {
  return normalizeParserText(value).replace(/\s+/g, "");
}

function findHeaderIndex(rows, requiredTokens = []) {
  return rows.findIndex((row) => {
    const text = row.map((cell) => normalizeParserText(cell)).join(" ");
    return requiredTokens.every((token) => text.includes(token));
  });
}

function getSheetCell(row, headers, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    const wanted = compactText(name);
    const index = headers.findIndex((header) => {
      const current = compactText(header);
      return current === wanted || current.includes(wanted);
    });
    if (index >= 0) return row[index];
  }
  return "";
}

function accountStartsWith(code, prefix) {
  const normalized = String(code || "").trim();
  return normalized === prefix || normalized.startsWith(`${prefix}.`);
}

function getAccountNetBalance(row = {}) {
  const debit = parseMoneyTR(row.borcBakiye ?? row.borc ?? row.debit ?? 0);
  const credit = parseMoneyTR(row.alacakBakiye ?? row.alacak ?? row.credit ?? 0);
  const net = parseMoneyTR(row.bakiye ?? row.netBalance ?? debit - credit);
  if (net !== 0) return net;
  return debit > 0 ? debit : -credit;
}

export function parseMizanSheet(rows = []) {
  if (!rows.length) return [];
  const headerIndex = findHeaderIndex(rows, ["HESAP"]);
  const headers = headerIndex >= 0 ? rows[headerIndex] : rows[0];
  const dataRows = rows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .map((row, index) => {
      const accountCode = String(
        getSheetCell(row, headers, ["HESAP KODU", "HESAP KOD", "KOD"]) || row[0] || ""
      ).trim();
      const accountName = String(
        getSheetCell(row, headers, ["HESAP ADI", "HESAP AD", "AD"]) || row[1] || ""
      ).trim();
      const borcBakiye = parseMoneyTR(
        getSheetCell(row, headers, ["BORÇ BAKİYE", "BORC BAKIYE", "BORÇ", "BORC"])
      );
      const alacakBakiye = parseMoneyTR(
        getSheetCell(row, headers, ["ALACAK BAKİYE", "ALACAK BAKIYE", "ALACAK"])
      );
      const bakiye = parseMoneyTR(getSheetCell(row, headers, ["BAKİYE", "BAKIYE", "NET"]));

      if (!accountCode) return null;

      return {
        id: `mizan-${index + 1}`,
        accountCode,
        accountName,
        borcBakiye,
        alacakBakiye,
        bakiye,
        netBalance: bakiye || (borcBakiye > 0 ? borcBakiye : -alacakBakiye),
      };
    })
    .filter(Boolean);
}

export function parseMuavinSheet(rows = []) {
  if (!rows.length) return [];
  const headerIndex = findHeaderIndex(rows, ["TARIH"]);
  const headers = headerIndex >= 0 ? rows[headerIndex] : rows[0];
  const dataRows = rows.slice((headerIndex >= 0 ? headerIndex : 0) + 1);

  return dataRows
    .map((row, index) => {
      const tarih = formatDateTR(
        getSheetCell(row, headers, ["TARİH", "TARIH", "FİŞ TARİHİ", "FIS TARIHI"]) || row[0]
      );
      const hesapKodu = String(
        getSheetCell(row, headers, ["HESAP KODU", "HESAP KOD", "KOD"]) || ""
      ).trim();
      const hesapAdi = String(getSheetCell(row, headers, ["HESAP ADI", "HESAP AD"]) || "").trim();
      const borc = parseMoneyTR(getSheetCell(row, headers, ["BORÇ", "BORC"]));
      const alacak = parseMoneyTR(getSheetCell(row, headers, ["ALACAK"]));
      const aciklama = String(
        getSheetCell(row, headers, ["AÇIKLAMA", "ACIKLAMA", "DETAY AÇIKLAMA"]) || ""
      ).trim();
      const evrakNo = String(getSheetCell(row, headers, ["EVRAK NO", "BELGE NO", "FİŞ NO"]) || "").trim();

      if (!tarih && !hesapKodu && !borc && !alacak) return null;

      return {
        id: `muavin-${index + 1}`,
        tarih,
        hesapKodu,
        hesapAdi,
        borc,
        alacak,
        aciklama,
        evrakNo,
        amount: borc > 0 ? borc : alacak,
      };
    })
    .filter(Boolean);
}

function buildFinding({
  companyId = "",
  companyName = "",
  period = "",
  type,
  level,
  amount = 0,
  description = "",
  recommendedAction = "",
  source = "",
  reference = "",
  smartExplanation = "",
}) {
  return {
    id: `risk-${type}-${reference || Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    companyId,
    companyName,
    period,
    type,
    level,
    amount: roundMoney(amount),
    description,
    recommendedAction,
    source,
    reference,
    smartExplanation,
    status: KURGAN_RISK_STATUS.YENI,
    createdAt: new Date().toISOString(),
  };
}

export function buildSmartRiskExplanation(finding = {}) {
  const templates = {
    [KURGAN_RISK_TYPE.KASA_YUKSEK_BAKIYE]: {
      why: "Dönem sonunda kasa hesabında yüksek bakiye, tahsilatların bankaya aktarılmaması veya kayıt dışı nakit hareketleri nedeniyle oluşmuş olabilir.",
      check: "Kasa sayım tutanağı, kasa fişleri ve banka yatırma dekontlarını kontrol edin.",
      note: "Vergisel açıdan yüksek kasa bakiyesi inceleme konusu olabilir; nakit akışı belgeleriyle destekleyin.",
    },
    [KURGAN_RISK_TYPE.ORTAKLARDAN_ALACAK]: {
      why: "Ortaklardan alacak hesabı uzun süre yüksek kalıyorsa örtülü sermaye veya ilişkili kişi işlemi riski doğabilir.",
      check: "Ortak cari hesap ekstresi, sözleşme ve ödeme planını inceleyin.",
      note: "Faiz hesaplaması ve transfer fiyatlandırması açısından belge eksikliğine dikkat edin.",
    },
    [KURGAN_RISK_TYPE.ORTAKLARA_BORC]: {
      why: "Ortaklara borç hesabının yüksek kalması, ortaklara yapılan ödemelerin sınıflandırma hatası veya gizli kâr dağıtımı riski taşıyabilir.",
      check: "Ortak ödeme dekontları, genel kurul kararları ve borçlanma belgelerini kontrol edin.",
      note: "Borç niteliği ve vade yapısı vergisel sonuç doğurabilir.",
    },
    [KURGAN_RISK_TYPE.DEVREDEN_KDV]: {
      why: "Devreden KDV hesabının uzun süre yüksek kalması, indirilecek KDV'nin kullanılamaması veya matrah düşüklüğüne işaret edebilir.",
      check: "KDV beyannameleri, indirilecek KDV listesi ve iade dosyalarını karşılaştırın.",
      note: "Süreklilik arz eden yüksek devreden KDV için açıklama hazırlığı yapın.",
    },
    [KURGAN_RISK_TYPE.ODENECEK_KDV_TUTARSIZ]: {
      why: "Mizandaki ödenecek KDV ile beyanname/tahakkuk tutarı arasındaki fark, eksik tahakkuk veya yanlış hesap sınıflandırmasından kaynaklanabilir.",
      check: "KDV beyannamesi, tahakkuk fişi ve 360 hesap hareketlerini karşılaştırın.",
      note: "Dönem uyumu ve ödeme tarihi farkları ayrıca kontrol edilmelidir.",
    },
    [KURGAN_RISK_TYPE.POS_BANKA_UYUMSUZ]: {
      why: "POS tahsilatlarının banka ekstresinde görülüp muhasebe kaydında karşılığı yoksa eksik gelir kaydı riski oluşur.",
      check: "POS slip raporları, banka ekstresi ve 108/120 hesap hareketlerini eşleştirin.",
      note: "Komisyon ve valör farklarını ayrı satırlarda izleyin.",
    },
    [KURGAN_RISK_TYPE.BANKA_MUHASEBE_FARK]: {
      why: "Banka ile muhasebe kayıtları arasındaki fark, aktarılmamış işlem, yanlış tarih veya tutar farkından kaynaklanabilir.",
      check: "Banka mutabakat çalışması yapın; eşleşmeyen satırları dekont bazında inceleyin.",
      note: "102 hesap hareketleri ile banka ekstresi birebir eşleşmelidir.",
    },
    [KURGAN_RISK_TYPE.SGK_BORDRO_UYUMSUZ]: {
      why: "SGK tahakkuku ile banka ödemesi arasındaki fark, eksik ödeme, gecikme zammı veya yanlış dönem kaydından oluşabilir.",
      check: "SGK tahakkuk fişi, bordro özeti ve banka ödeme dekontunu karşılaştırın.",
      note: "361 hesap hareketleri ile SGK tahakkuk dönemi uyumlu olmalıdır.",
    },
    [KURGAN_RISK_TYPE.KDV_MATRAH_ANOMALI]: {
      why: "KDV matrahında olağandışı değişim, eksik fatura kaydı veya yanlış oran kullanımına işaret edebilir.",
      check: "Satış faturaları, KDV listesi ve gelir hesaplarını dönemsel karşılaştırın.",
      note: "Matrah değişiminin ticari gerekçesi belgelenmelidir.",
    },
    [KURGAN_RISK_TYPE.KARLILIK_ANOMALI]: {
      why: "Düşük kârlılık oranı, maliyetlerin gelirle uyumsuz artması veya hatalı hesap sınıflandırmasından kaynaklanabilir.",
      check: "Gelir tablosu kırılımı, satış maliyeti ve dönem giderlerini analiz edin.",
      note: "Süreklilik arz eden düşük kârlılık vergi incelemesinde soru konusu olabilir.",
    },
    [KURGAN_RISK_TYPE.GIDER_ARTISI]: {
      why: "Giderlerde ani artış, yanlış dönemlendirme, kişisel harcamaların giderleştirilmesi veya belgesiz gider kaydı riski taşır.",
      check: "770 ve ilgili gider hesaplarının hareket dökümünü ve belge eşleşmesini kontrol edin.",
      note: "KKEG ve belge zorunluluğu açısından destekleyici evrak toplayın.",
    },
    [KURGAN_RISK_TYPE.SUPHELI_CARI]: {
      why: "Cari hesapta sık ve yüksek tutarlı hareketler, sahte fatura veya ilişkili taraf işlemi riski oluşturabilir.",
      check: "Cari ekstre, sözleşme, fatura ve ödeme belgelerini inceleyin.",
      note: "Açıklaması zayıf yüksek tutarlı cari hareketler öncelikli kontrol edilmelidir.",
    },
    [KURGAN_RISK_TYPE.MUKERRER_KAYIT]: {
      why: "Aynı tarih, tutar ve açıklamalı tekrar eden kayıtlar çift ödeme veya çift gider kaydı riski taşır.",
      check: "Mükerrer satırların fiş ve evrak numaralarını karşılaştırın.",
      note: "Ters kayıt veya iptal belgesi olmadan mükerrer kayıt bırakılmamalıdır.",
    },
    [KURGAN_RISK_TYPE.EKSIK_BELGE]: {
      why: "Eksik belge tipi veya açıklama, denetimde ispat zorluğu ve vergisel risk doğurur.",
      check: "Fiş satırlarında belge tipi, evrak no ve detay açıklama alanlarını tamamlayın.",
      note: "Luca aktarım öncesi eksik alanlar tamamlanmalıdır.",
    },
  };

  const template = templates[finding.type] || {
    why: "Bu risk olağandışı hesap hareketi veya veri tutarsızlığı nedeniyle tespit edilmiş olabilir.",
    check: "İlgili hesap hareketlerini ve belgeleri kontrol edin.",
    note: "Gerekirse düzeltme kaydı veya açıklama notu hazırlayın.",
  };

  return [
    `Bu risk neden oluşmuş olabilir? ${template.why}`,
    `Hangi belge/kayıt kontrol edilmeli? ${template.check}`,
    `Muhasebe açısından neye dikkat edilmeli? ${template.note}`,
  ].join("\n");
}

function sumAccounts(mizanRows = [], prefix) {
  return mizanRows
    .filter((row) => accountStartsWith(row.accountCode, prefix))
    .reduce((sum, row) => sum + Math.abs(getAccountNetBalance(row)), 0);
}

function analyzeHighBalanceRisks({ mizanRows, companyId, companyName, period }) {
  const findings = [];
  const checks = [
    {
      prefix: "100",
      type: KURGAN_RISK_TYPE.KASA_YUKSEK_BAKIYE,
      threshold: KURGAN_RISK_THRESHOLDS.kasaHighBalance,
      action: "Kasa sayımı yapın ve fazla bakiyeyi bankaya aktarın veya gerekçesini belgeleyin.",
    },
    {
      prefix: "131",
      type: KURGAN_RISK_TYPE.ORTAKLARDAN_ALACAK,
      threshold: KURGAN_RISK_THRESHOLDS.ortakAlacakHighBalance,
      action: "Ortak cari hesap ekstresini ve tahsilat planını kontrol edin.",
    },
    {
      prefix: "331",
      type: KURGAN_RISK_TYPE.ORTAKLARA_BORC,
      threshold: KURGAN_RISK_THRESHOLDS.ortakBorcHighBalance,
      action: "Ortaklara borç hareketlerini sözleşme ve ödeme belgeleriyle doğrulayın.",
    },
    {
      prefix: "190",
      type: KURGAN_RISK_TYPE.DEVREDEN_KDV,
      threshold: KURGAN_RISK_THRESHOLDS.devredenKdvHighBalance,
      action: "Devreden KDV nedenini KDV beyannamesi ve indirilecek listeyle açıklayın.",
    },
  ];

  checks.forEach((check) => {
    const amount = sumAccounts(mizanRows, check.prefix);
    if (amount < check.threshold) return;
    const finding = buildFinding({
      companyId,
      companyName,
      period,
      type: check.type,
      level: resolveRiskLevelFromRatio(amount, check.threshold),
      amount,
      description: `${check.prefix} hesap grubu dönem sonu bakiyesi ${amount.toLocaleString("tr-TR")} TL; eşik ${check.threshold.toLocaleString("tr-TR")} TL.`,
      recommendedAction: check.action,
      source: KURGAN_DATA_SOURCE.MIZAN,
      reference: check.prefix,
    });
    finding.smartExplanation = buildSmartRiskExplanation(finding);
    findings.push(finding);
  });

  return findings;
}

function analyzeKdvMismatch({ mizanRows, declarationRecords, companyId, companyName, period }) {
  const mizanKdv = sumAccounts(mizanRows, "360");
  const declarationKdv = declarationRecords
    .filter((record) => record.companyId === companyId && record.type === "KDV")
    .filter((record) => !period || record.period === period)
    .reduce((sum, record) => sum + Number(record.totalPayment || 0), 0);

  if (!mizanKdv && !declarationKdv) return [];

  const diff = Math.abs(mizanKdv - declarationKdv);
  if (diff <= 1) return [];

  const finding = buildFinding({
    companyId,
    companyName,
    period,
    type: KURGAN_RISK_TYPE.ODENECEK_KDV_TUTARSIZ,
    level: diff >= 50000 ? KURGAN_RISK_LEVEL.KRITIK : diff >= 10000 ? KURGAN_RISK_LEVEL.YUKSEK : KURGAN_RISK_LEVEL.ORTA,
    amount: diff,
    description: `Mizan 360 bakiyesi ${mizanKdv.toLocaleString("tr-TR")} TL, beyanname/tahakkuk toplamı ${declarationKdv.toLocaleString("tr-TR")} TL.`,
    recommendedAction: "KDV beyannamesi, tahakkuk kaydı ve 360 hesap hareketlerini karşılaştırın.",
    source: `${KURGAN_DATA_SOURCE.MIZAN} + ${KURGAN_DATA_SOURCE.BEYANNAME}`,
    reference: "360-kdv",
  });
  finding.smartExplanation = buildSmartRiskExplanation(finding);
  return [finding];
}

function analyzeDuplicateRecords(rows = [], context = {}) {
  const seen = new Map();
  const findings = [];

  rows.forEach((row) => {
    const tarih = row.tarih || row.fisTarihi || "";
    const amount = roundMoney(row.amount || row.borc || row.alacak || 0);
    const aciklama = compactText(row.aciklama || row.detayAciklama || row.fisAciklama || "");
    if (!tarih || !amount || !aciklama) return;

    const key = `${tarih}|${amount}|${aciklama}`;
    if (!seen.has(key)) {
      seen.set(key, row);
      return;
    }

    const finding = buildFinding({
      companyId: context.companyId,
      companyName: context.companyName,
      period: context.period,
      type: KURGAN_RISK_TYPE.MUKERRER_KAYIT,
      level: amount >= 50000 ? KURGAN_RISK_LEVEL.YUKSEK : KURGAN_RISK_LEVEL.ORTA,
      amount,
      description: `${tarih} tarihli ${amount.toLocaleString("tr-TR")} TL tutarlı kayıt tekrar ediyor.`,
      recommendedAction: "Mükerrer fişleri tespit edin; ters kayıt veya birleştirme değerlendirin.",
      source: context.source || KURGAN_DATA_SOURCE.MUAVIN,
      reference: key,
    });
    finding.smartExplanation = buildSmartRiskExplanation(finding);
    findings.push(finding);
  });

  return findings;
}

function analyzeBankAccountingMismatch({ bankRows = [], accountingRows = [], context = {} }) {
  const findings = [];
  const accountingIndex = new Map();

  accountingRows.forEach((row) => {
    const key = `${row.tarih || row.fisTarihi || ""}|${roundMoney(row.amount || row.borc || row.alacak)}`;
    accountingIndex.set(key, row);
  });

  bankRows.forEach((row) => {
    const tarih = row.tarih || row.fisTarihi || "";
    const amount = roundMoney(row.amount || row.borc || row.alacak || 0);
    const key = `${tarih}|${amount}`;
    if (!accountingIndex.has(key)) {
      const finding = buildFinding({
        companyId: context.companyId,
        companyName: context.companyName,
        period: context.period,
        type: KURGAN_RISK_TYPE.BANKA_MUHASEBE_FARK,
        level: amount >= 25000 ? KURGAN_RISK_LEVEL.YUKSEK : KURGAN_RISK_LEVEL.ORTA,
        amount,
        description: `Bankada görülen ${tarih} / ${amount.toLocaleString("tr-TR")} TL işlem muhasebede bulunamadı.`,
        recommendedAction: "Banka mutabakatı yapın ve eksik muhasebe kaydını tamamlayın.",
        source: `${KURGAN_DATA_SOURCE.BANKA} + ${KURGAN_DATA_SOURCE.MUAVIN}`,
        reference: `bank-missing-${key}`,
      });
      finding.smartExplanation = buildSmartRiskExplanation(finding);
      findings.push(finding);
    }
  });

  accountingRows.forEach((row) => {
    const tarih = row.tarih || row.fisTarihi || "";
    const amount = roundMoney(row.amount || row.borc || row.alacak || 0);
    const key = `${tarih}|${amount}`;
  const bankMatch = bankRows.some((bankRow) => {
      const bankKey = `${bankRow.tarih || bankRow.fisTarihi || ""}|${roundMoney(bankRow.amount || bankRow.borc || bankRow.alacak || 0)}`;
      return bankKey === key;
    });
    if (!bankMatch && accountStartsWith(row.hesapKodu, "102")) {
      const finding = buildFinding({
        companyId: context.companyId,
        companyName: context.companyName,
        period: context.period,
        type: KURGAN_RISK_TYPE.BANKA_MUHASEBE_FARK,
        level: amount >= 25000 ? KURGAN_RISK_LEVEL.YUKSEK : KURGAN_RISK_LEVEL.ORTA,
        amount,
        description: `Muhasebede görülen ${tarih} / ${amount.toLocaleString("tr-TR")} TL banka kaydı ekstrede bulunamadı.`,
        recommendedAction: "Banka ekstresi ve 102 hesap hareketlerini yeniden eşleştirin.",
        source: `${KURGAN_DATA_SOURCE.BANKA} + ${KURGAN_DATA_SOURCE.MUAVIN}`,
        reference: `accounting-missing-${key}`,
      });
      finding.smartExplanation = buildSmartRiskExplanation(finding);
      findings.push(finding);
    }
  });

  return findings;
}

function analyzePosMismatch({ bankRows = [], accountingRows = [], context = {} }) {
  const posBankTotal = bankRows
    .filter((row) => /POS/i.test(String(row.aciklama || row.detayAciklama || "")))
    .reduce((sum, row) => sum + roundMoney(row.amount || row.borc || row.alacak || 0), 0);
  const posAccountingTotal = accountingRows
    .filter(
      (row) =>
        /POS/i.test(String(row.aciklama || row.detayAciklama || "")) ||
        accountStartsWith(row.hesapKodu, "108")
    )
    .reduce((sum, row) => sum + roundMoney(row.amount || row.borc || row.alacak || 0), 0);

  const diff = Math.abs(posBankTotal - posAccountingTotal);
  if (diff <= 1000) return [];

  const finding = buildFinding({
    companyId: context.companyId,
    companyName: context.companyName,
    period: context.period,
    type: KURGAN_RISK_TYPE.POS_BANKA_UYUMSUZ,
    level: diff >= 50000 ? KURGAN_RISK_LEVEL.KRITIK : diff >= 10000 ? KURGAN_RISK_LEVEL.YUKSEK : KURGAN_RISK_LEVEL.ORTA,
    amount: diff,
    description: `POS banka hareketleri ${posBankTotal.toLocaleString("tr-TR")} TL, muhasebe kayıtları ${posAccountingTotal.toLocaleString("tr-TR")} TL.`,
    recommendedAction: "POS slip raporu ile 108/banka hesap hareketlerini karşılaştırın.",
    source: `${KURGAN_DATA_SOURCE.BANKA} + ${KURGAN_DATA_SOURCE.LUCA}`,
    reference: "pos-mismatch",
  });
  finding.smartExplanation = buildSmartRiskExplanation(finding);
  return [finding];
}

function analyzeSgkMismatch({ declarationRecords = [], bankRows = [], context = {} }) {
  const sgkDeclaration = declarationRecords
    .filter((record) => record.companyId === context.companyId && record.type === "SGK")
    .reduce((sum, record) => sum + Number(record.totalPayment || 0), 0);
  const sgkBankPayments = bankRows
    .filter((row) => /SGK|MUHSGK|SOSYAL/i.test(String(row.aciklama || row.detayAciklama || "")))
    .reduce((sum, row) => sum + roundMoney(row.amount || row.borc || row.alacak || 0), 0);

  const diff = Math.abs(sgkDeclaration - sgkBankPayments);
  if (!sgkDeclaration && !sgkBankPayments) return [];
  if (diff <= 100) return [];

  const finding = buildFinding({
    companyId: context.companyId,
    companyName: context.companyName,
    period: context.period,
    type: KURGAN_RISK_TYPE.SGK_BORDRO_UYUMSUZ,
    level: diff >= 50000 ? KURGAN_RISK_LEVEL.KRITIK : diff >= 10000 ? KURGAN_RISK_LEVEL.YUKSEK : KURGAN_RISK_LEVEL.ORTA,
    amount: diff,
    description: `SGK tahakkuk toplamı ${sgkDeclaration.toLocaleString("tr-TR")} TL, banka ödemeleri ${sgkBankPayments.toLocaleString("tr-TR")} TL.`,
    recommendedAction: "SGK tahakkuk kaydı, bordro ve banka ödeme dekontlarını karşılaştırın.",
    source: `${KURGAN_DATA_SOURCE.SGK} + ${KURGAN_DATA_SOURCE.BANKA}`,
    reference: "sgk-mismatch",
  });
  finding.smartExplanation = buildSmartRiskExplanation(finding);
  return [finding];
}

function analyzeRatioRisks({ mizanRows = [], context = {} }) {
  const revenue = sumAccounts(mizanRows, "600") || sumAccounts(mizanRows, "601");
  const expense = sumAccounts(mizanRows, "770");
  const profit = revenue - expense;
  const findings = [];

  if (revenue > 0 && expense / revenue >= KURGAN_RISK_THRESHOLDS.giderRevenueRatio) {
    const finding = buildFinding({
      companyId: context.companyId,
      companyName: context.companyName,
      period: context.period,
      type: KURGAN_RISK_TYPE.GIDER_ARTISI,
      level: expense / revenue >= 0.5 ? KURGAN_RISK_LEVEL.YUKSEK : KURGAN_RISK_LEVEL.ORTA,
      amount: expense,
      description: `Gider/Gelir oranı %${((expense / revenue) * 100).toFixed(1)}; olağandışı gider artışı sinyali.`,
      recommendedAction: "770 ve satış maliyeti hesaplarının hareket dökümünü inceleyin.",
      source: KURGAN_DATA_SOURCE.MIZAN,
      reference: "gider-artisi",
    });
    finding.smartExplanation = buildSmartRiskExplanation(finding);
    findings.push(finding);
  }

  if (revenue > 0 && profit / revenue < KURGAN_RISK_THRESHOLDS.karlilikMinRatio) {
    const finding = buildFinding({
      companyId: context.companyId,
      companyName: context.companyName,
      period: context.period,
      type: KURGAN_RISK_TYPE.KARLILIK_ANOMALI,
      level: profit / revenue < 0 ? KURGAN_RISK_LEVEL.KRITIK : KURGAN_RISK_LEVEL.YUKSEK,
      amount: profit,
      description: `Kârlılık oranı %${((profit / revenue) * 100).toFixed(1)}; beklenen eşiğin altında.`,
      recommendedAction: "Gelir tablosu analizi yapın ve maliyet yapısını gözden geçirin.",
      source: KURGAN_DATA_SOURCE.MIZAN,
      reference: "karlilik",
    });
    finding.smartExplanation = buildSmartRiskExplanation(finding);
    findings.push(finding);
  }

  const kdvMatrahProxy = sumAccounts(mizanRows, "391");
  if (revenue > 0 && kdvMatrahProxy / revenue >= KURGAN_RISK_THRESHOLDS.kdvMatrahChangeRatio) {
    const finding = buildFinding({
      companyId: context.companyId,
      companyName: context.companyName,
      period: context.period,
      type: KURGAN_RISK_TYPE.KDV_MATRAH_ANOMALI,
      level: KURGAN_RISK_LEVEL.ORTA,
      amount: kdvMatrahProxy,
      description: `Hesaplanan KDV (${kdvMatrahProxy.toLocaleString("tr-TR")} TL) gelir tabanına göre yüksek görünüyor.`,
      recommendedAction: "KDV listesi ve satış faturalarını matrah değişimi açısından kontrol edin.",
      source: KURGAN_DATA_SOURCE.MIZAN,
      reference: "kdv-matrah",
    });
    finding.smartExplanation = buildSmartRiskExplanation(finding);
    findings.push(finding);
  }

  return findings;
}

function analyzeSuspiciousCari({ muavinRows = [], context = {} }) {
  const cariRows = muavinRows.filter((row) => /^12|^32|^33/.test(String(row.hesapKodu || "")));
  const grouped = new Map();

  cariRows.forEach((row) => {
    const key = row.hesapKodu;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  const findings = [];
  grouped.forEach((rows, hesapKodu) => {
    const total = rows.reduce((sum, row) => sum + roundMoney(row.amount || row.borc || row.alacak || 0), 0);
    if (rows.length < 5 || total < 100000) return;
    const finding = buildFinding({
      companyId: context.companyId,
      companyName: context.companyName,
      period: context.period,
      type: KURGAN_RISK_TYPE.SUPHELI_CARI,
      level: total >= 250000 ? KURGAN_RISK_LEVEL.YUKSEK : KURGAN_RISK_LEVEL.ORTA,
      amount: total,
      description: `${hesapKodu} hesabında ${rows.length} hareket ve ${total.toLocaleString("tr-TR")} TL toplam tutar tespit edildi.`,
      recommendedAction: "Cari hesap ekstresi, fatura ve ödeme belgelerini inceleyin.",
      source: KURGAN_DATA_SOURCE.MUAVIN,
      reference: hesapKodu,
    });
    finding.smartExplanation = buildSmartRiskExplanation(finding);
    findings.push(finding);
  });

  return findings;
}

function analyzeMissingDocumentRisks({ lucaRows = [], context = {} }) {
  const findings = [];

  lucaRows.forEach((row) => {
    const hesapKodu = String(row.hesapKodu || "").trim();
    const aciklama = String(row.detayAciklama || row.fisAciklama || row.aciklama || "").trim();
    const belgeTipi = String(row.belgeTipi || row.documentType || "").trim();
    const amount = roundMoney(row.borc || row.alacak || 0);
    if (!hesapKodu || amount <= 0) return;
    if (aciklama && belgeTipi) return;

    const finding = buildFinding({
      companyId: context.companyId,
      companyName: context.companyName,
      period: context.period,
      type: KURGAN_RISK_TYPE.EKSIK_BELGE,
      level: amount >= 25000 ? KURGAN_RISK_LEVEL.ORTA : KURGAN_RISK_LEVEL.DUSUK,
      amount,
      description: `${row.fisTarihi || "-"} tarihli ${hesapKodu} satırında belge tipi veya açıklama eksik.`,
      recommendedAction: "Belge tipi ve detay açıklama alanlarını tamamlayın.",
      source: KURGAN_DATA_SOURCE.LUCA,
      reference: row.id || `${row.fisNo}-${row.fisTarihi}`,
    });
    finding.smartExplanation = buildSmartRiskExplanation(finding);
    findings.push(finding);
  });

  return findings.slice(0, 50);
}

function mapLucaRowsToMovementRows(rows = []) {
  return rows.map((row) => ({
    id: row.id,
    tarih: row.fisTarihi,
    fisTarihi: row.fisTarihi,
    hesapKodu: row.hesapKodu,
    hesapAdi: row.hesapAdi,
    borc: row.borc,
    alacak: row.alacak,
    aciklama: row.detayAciklama || row.fisAciklama || row.aciklama,
    detayAciklama: row.detayAciklama,
    fisAciklama: row.fisAciklama,
    belgeTipi: row.belgeTipi,
    amount: parseMoneyTR(row.borc) || parseMoneyTR(row.alacak),
  }));
}

export function analyzeKurganRisks(input = {}) {
  const {
    companyId = "",
    companyName = "",
    period = "",
    mizanRows = [],
    muavinRows = [],
    bankRows = [],
    lucaRows = [],
    declarationRecords = [],
  } = input;

  const context = { companyId, companyName, period };
  const accountingRows = [...muavinRows, ...mapLucaRowsToMovementRows(lucaRows)];
  const findings = [
    ...analyzeHighBalanceRisks({ mizanRows, ...context }),
    ...analyzeKdvMismatch({ mizanRows, declarationRecords, ...context }),
    ...analyzeDuplicateRecords(accountingRows, { ...context, source: KURGAN_DATA_SOURCE.MUAVIN }),
    ...analyzeDuplicateRecords(bankRows, { ...context, source: KURGAN_DATA_SOURCE.BANKA }),
    ...analyzeBankAccountingMismatch({ bankRows, accountingRows, ...context }),
    ...analyzePosMismatch({ bankRows, accountingRows, ...context }),
    ...analyzeSgkMismatch({ declarationRecords, bankRows, ...context }),
    ...analyzeRatioRisks({ mizanRows, ...context }),
    ...analyzeSuspiciousCari({ muavinRows, ...context }),
    ...analyzeMissingDocumentRisks({ lucaRows, ...context }),
  ];

  return {
    findings,
    analyzedAt: new Date().toISOString(),
    summary: buildKurganDashboardStats(findings),
    sources: {
      mizanCount: mizanRows.length,
      muavinCount: muavinRows.length,
      bankCount: bankRows.length,
      lucaCount: lucaRows.length,
      declarationCount: declarationRecords.length,
    },
  };
}

export function buildKurganDashboardStats(findings = []) {
  const openStatuses = new Set([
    KURGAN_RISK_STATUS.YENI,
    KURGAN_RISK_STATUS.INCELENIYOR,
    KURGAN_RISK_STATUS.DUZELTME_GEREKLI,
  ]);

  return {
    totalRisks: findings.length,
    criticalRisks: findings.filter((item) => item.level === KURGAN_RISK_LEVEL.KRITIK).length,
    highRisks: findings.filter((item) => item.level === KURGAN_RISK_LEVEL.YUKSEK).length,
    pendingReviews: findings.filter((item) => openStatuses.has(item.status)).length,
    lastAnalyzedAt: findings[0]?.createdAt || "",
  };
}

export function loadKurganRiskFindings() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(KURGAN_STORAGE_KEY) || "[]", []);
}

export function saveKurganRiskFindings(findings = []) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KURGAN_STORAGE_KEY, JSON.stringify(findings));
}

export function loadKurganRiskSnapshots() {
  if (typeof window === "undefined") return [];
  return safeParseJson(localStorage.getItem(KURGAN_SNAPSHOT_KEY) || "[]", []);
}

export function saveKurganRiskSnapshot(snapshot = {}) {
  if (typeof window === "undefined") return;
  const current = loadKurganRiskSnapshots();
  const next = [{ ...snapshot, savedAt: new Date().toISOString() }, ...current].slice(0, 20);
  localStorage.setItem(KURGAN_SNAPSHOT_KEY, JSON.stringify(next));
}

export function mergeSavedStatuses(findings = [], savedFindings = []) {
  const statusMap = new Map(savedFindings.map((item) => [item.id, item.status]));
  return findings.map((finding) => ({
    ...finding,
    status: statusMap.get(finding.id) || finding.status || KURGAN_RISK_STATUS.YENI,
  }));
}

export function collectKurganDataSources({ companyId = "" } = {}) {
  const pendingLuca = loadPendingLucaRows();
  const lucaRows = (pendingLuca?.rows || []).filter(
    (row) => !companyId || row.firmaId === companyId
  );
  const declarationRecords = loadDeclarationAccrualRecords().filter(
    (record) => !companyId || record.companyId === companyId
  );
  const bankRows = lucaRows
    .filter((row) => String(row.kaynakTipi || "").toUpperCase() === "BANKA")
    .map((row) => ({
      tarih: row.fisTarihi,
      fisTarihi: row.fisTarihi,
      hesapKodu: row.hesapKodu,
      borc: row.borc,
      alacak: row.alacak,
      aciklama: row.detayAciklama || row.fisAciklama,
      detayAciklama: row.detayAciklama,
      amount: parseMoneyTR(row.borc) || parseMoneyTR(row.alacak),
    }));

  return { lucaRows, declarationRecords, bankRows };
}

export function runKurganRiskScenario() {
  const mizanRows = [
    { accountCode: "100.01.001", accountName: "Kasa", borcBakiye: 125000, alacakBakiye: 0, netBalance: 125000 },
    { accountCode: "131.01.001", accountName: "Ortaklardan Alacaklar", borcBakiye: 220000, alacakBakiye: 0, netBalance: 220000 },
    { accountCode: "190.01.001", accountName: "Devreden KDV", borcBakiye: 180000, alacakBakiye: 0, netBalance: 180000 },
    { accountCode: "360.01.010", accountName: "Ödenecek KDV", borcBakiye: 0, alacakBakiye: 62000, netBalance: -62000 },
    { accountCode: "600.01.001", accountName: "Yurtiçi Satışlar", borcBakiye: 0, alacakBakiye: 500000, netBalance: -500000 },
    { accountCode: "770.01.001", accountName: "Genel Yönetim Giderleri", borcBakiye: 220000, alacakBakiye: 0, netBalance: 220000 },
  ];

  const declarationRecords = [
    { companyId: "test-company", period: "2026/05", type: "KDV", totalPayment: 50000 },
  ];

  const bankRows = [
    { tarih: "10.06.2026", amount: 50250, aciklama: "KDV ODEMESI" },
    { tarih: "10.06.2026", amount: 50250, aciklama: "KDV ODEMESI" },
    { tarih: "11.06.2026", amount: 15000, aciklama: "POS TAHSILATI" },
  ];

  const muavinRows = [
    { tarih: "11.06.2026", hesapKodu: "108.01.001", amount: 5000, aciklama: "POS TAHSILATI" },
  ];

  const result = analyzeKurganRisks({
    companyId: "test-company",
    companyName: "Test Firma",
    period: "2026/05",
    mizanRows,
    muavinRows,
    bankRows,
    declarationRecords,
  });

  return {
    totalRisks: result.summary.totalRisks,
    criticalRisks: result.summary.criticalRisks,
    highRisks: result.summary.highRisks,
    kasaRisk: result.findings.some((item) => item.type === KURGAN_RISK_TYPE.KASA_YUKSEK_BAKIYE),
    ortakAlacakRisk: result.findings.some((item) => item.type === KURGAN_RISK_TYPE.ORTAKLARDAN_ALACAK),
    devredenKdvRisk: result.findings.some((item) => item.type === KURGAN_RISK_TYPE.DEVREDEN_KDV),
    kdvMismatchRisk: result.findings.some((item) => item.type === KURGAN_RISK_TYPE.ODENECEK_KDV_TUTARSIZ),
    duplicateRisk: result.findings.some((item) => item.type === KURGAN_RISK_TYPE.MUKERRER_KAYIT),
    posMismatchRisk: result.findings.some((item) => item.type === KURGAN_RISK_TYPE.POS_BANKA_UYUMSUZ),
  };
}
