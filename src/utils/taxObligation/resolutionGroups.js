/**
 * Vergi/SGK çözüm merkezi grupları — okuma/iskelet (apply yok).
 */
import { classifyObligationPayment } from "./classify.js";
import { decideAccrualMatch } from "./matchEngine.js";
import { classifyPaymentScenario } from "./paymentScenarios.js";
import { MATCH_STATUS_LABEL } from "./types.js";
import { roundMoney } from "./normalize.js";

function rowDesc(row = {}) {
  return String(
    row.detayAciklama || row.fisAciklama || row.aciklama || row.description || ""
  ).trim();
}

function rowAmt(row = {}) {
  return Math.abs(Number(row.borc || 0) || Number(row.alacak || 0) || 0);
}

function rowDate(row = {}) {
  return String(row.fisTarihi || row.evrakTarihi || row.date || "").trim();
}

function directionLabel(direction = "") {
  const d = String(direction || "").toUpperCase();
  if (d === "GIRIS" || d === "GELEN") return "Gelen";
  if (d === "CIKIS" || d === "GIDEN") return "Giden";
  return "—";
}

function buildTaxRowTransaction(row = {}) {
  const direction = String(row.direction || "").trim();
  const amount = rowAmt(row);
  const desc = rowDesc(row);
  const statusLabel =
    String(row.missingHesapCategory || "").trim() ||
    (row.riskDurumu === "HESAP_EKSIK" ? "Hesap eksik" : "") ||
    "Vergi / SGK";
  return {
    id: String(row.id || ""),
    date: rowDate(row),
    description: desc,
    direction,
    directionLabel: directionLabel(direction),
    amount,
    transactionType: String(row.transactionType || "Vergi/SGK"),
    statusLabel,
    bankName: String(row.bankaAdi || row.bankName || "").trim(),
    analysisKey: String(row.analysisKey || ""),
    suggestedAccount: String(row.hesapKodu || row.accountCode || "").trim(),
    statusOrSuggestion: statusLabel,
  };
}

/**
 * Eksik vergi/SGK satırlarından mutabakat kartları (uygulama yok).
 * Satırlar `buildCariResolutionGroups` tarafından ön-bucket edilir —
 * burada ikinci dar filtre ile satır düşürmeyiz (sayaç/liste tutarsızlığı).
 */
export function buildTaxObligationResolutionGroups(
  rows = [],
  accruals = [],
  context = {}
) {
  const companyId = context.selectedCompany?.id || context.companyId || "";
  const groups = [];

  for (const row of rows || []) {
    if (!row) continue;
    const desc = rowDesc(row);
    const classified = classifyObligationPayment(desc);
    const amount = rowAmt(row);
    const payment = {
      companyId,
      obligationType: classified.obligationType || row.transactionType || "",
      amount,
      description: desc,
      periodKey: "",
      accrualNumber: "",
      dueDate: "",
    };

    const decision = decideAccrualMatch(accruals, payment);
    const selected = decision.selected;
    let scenario = null;
    if (selected) {
      scenario = classifyPaymentScenario({
        bankAmount: amount,
        accrual: selected,
        verifiedSupportAmount: context.verifiedSupportAmount || 0,
        verifiedIncentiveCancellationAmount:
          context.verifiedIncentiveCancellationAmount || 0,
        verifiedLateFeeAmount: context.verifiedLateFeeAmount || 0,
        taxSgkAccountMappings:
          context.selectedCompany?.taxSgkAccountMappings || {},
      });
    }

    const status = scenario?.status || decision.status;
    const direction = String(row.direction || "").trim();
    const payDate = rowDate(row);
    const partyName =
      classified.obligationType ||
      String(row.missingHesapCategory || "").trim() ||
      String(row.transactionType || "").trim() ||
      "Vergi / SGK";
    groups.push({
      id: `tax-obl:${row.id || groups.length}`,
      taxObligationGroup: true,
      applyDisabled: true,
      status: "remaining",
      partyName,
      obligationType: classified.obligationType || "",
      classification: classified.classification || "",
      transactionType: String(row.transactionType || partyName),
      direction,
      directionLabel: directionLabel(direction),
      periodLabel: selected?.period_key || "—",
      paymentDate: payDate,
      dateFrom: payDate,
      dateTo: payDate,
      bankAmount: roundMoney(amount),
      accrualId: selected?.id || "",
      accrualNumber: selected?.accrual_number || "",
      accrualTotal: selected ? roundMoney(selected.total_payable) : null,
      principal: selected ? roundMoney(selected.total_principal) : null,
      stampTax: selected ? roundMoney(selected.total_stamp_tax) : null,
      penalty: selected ? roundMoney(selected.total_penalty) : null,
      lateFee: selected ? roundMoney(selected.total_late_fee) : null,
      incentive: selected
        ? roundMoney(selected.total_incentive_on_document)
        : null,
      gap: scenario ? roundMoney(scenario.gap) : null,
      matchStatus: status,
      matchStatusLabel: MATCH_STATUS_LABEL[status] || status,
      confidence: decision.confidence || 0,
      candidates: decision.candidates || [],
      candidatesReady: true,
      rowIds: [row.id].filter(Boolean),
      samples: [desc.slice(0, 160)].filter(Boolean),
      count: 1,
      totalAmount: roundMoney(amount),
      vendorMessage: selected
        ? "Tahakkuk seçimi ve Luca dağılımı sonraki pakette. Bu ekranda yalnızca inceleme yapılır; otomatik uygulama kapalıdır."
        : "Bu ödeme için tahakkuk kaydı bulunamadı. Mali Yükümlülük Merkezi’nden belge yükleyin.",
      transactions: [buildTaxRowTransaction(row)],
      confidenceLabel: hydratedConfidenceLabel(status, decision.confidence),
    });
  }

  return groups.sort((a, b) => b.bankAmount - a.bankAmount);
}

function hydratedConfidenceLabel(status, confidence) {
  if (status === "ACCRUAL_PENDING") return "Tahakkuk bekleniyor";
  if (status === "MULTIPLE_CANDIDATES") return "Birden fazla aday";
  if (Number(confidence) >= 70) return "Yüksek eşleşme adayı";
  if (Number(confidence) >= 40) return "Orta";
  return "İnceleme gerekli";
}
