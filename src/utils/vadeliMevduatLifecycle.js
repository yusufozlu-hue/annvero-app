/**
 * Vadeli mevduat yaşam döngüsü (açılış → faiz → stopaj → kapanış /
 * vade dönüşü / anapara yenileme).
 *
 * Kural: Vadeli hesaplar arasında virman olmaz (otomatik / aday / reclass yok).
 * Açılış/kapanış karşı hesabı aynı firma + aynı bankanın VADESIZ 102 yaprağıdır.
 * accountingScenario: VADELI_LIFECYCLE (asla BANKA_ICI_VIRMAN değil).
 */

import { BANK_TRANSACTION_TYPE } from "@/src/utils/bankTransactionType";
import { normalizeParserText } from "@/src/utils/textNormalize";
import { MISSING_HESAP_CATEGORY } from "@/src/utils/previewExportValidation";
import {
  matchesVadeliLifecycleAmounts,
  matchesFaizStopajRate,
} from "@/src/utils/faizStopajiClassify";
import {
  BANK_ACCOUNT_MAPPING_SCOPE,
  resolveStatementAccountMapping,
} from "@/src/utils/bankProductAccountMapping";
import {
  resolveAccountingDecision,
  mapCentralDecisionToStatementResolve,
} from "@/src/utils/centralAccountingDecisionResolver";

export const VADELI_LIFECYCLE_ROLE = Object.freeze({
  ACILIS: "VADELI_ACILIS",
  KAPANIS: "VADELI_KAPANIS",
  FAIZ: "FAIZ_GELIRI",
  STOPAJ: "FAIZ_STOPAJI",
  VADE_DONUSU: "VADELI_VADE_DONUSU",
  ANAPARA_YENILEME: "VADELI_ANAPARA_YENILEME",
});

/** Açılış/kapanış/vade/yenileme satırları — BANKA_ICI_VIRMAN değil. */
export const VADELI_LIFECYCLE_SCENARIO = "VADELI_LIFECYCLE";

/**
 * Lifecycle algoritma sürümü — idempotency / pipelineVersion bileşeni.
 * Kod değişince bump: eski tamamlanmış 2/2 job yeni analiz yerine kullanılmaz.
 */
export const VADELI_LIFECYCLE_ALGORITHM_VERSION = "vl/2.3.0";

export const LIFECYCLE_OPEN_RE =
  /\b(HESAP\s*ACMA|VADEL[Iİ].*ACMA|MEVDUAT\s*ACMA|ACILIS)/i;
export const LIFECYCLE_CLOSE_RE =
  /\b(HESAP\s*KAPAT|VADEL[Iİ].*KAPAT|MEVDUAT\s*KAPAT|KAPANIS)/i;
export const LIFECYCLE_ROLLOVER_RE =
  /\b(VADE\s*DONUS|VADE\s*D[OÖ]N[UÜ][SŞ]|ROLLOVER|YENIDEN\s*VADEL|YEN[Iİ]DEN\s*VADEL)/i;
export const LIFECYCLE_RENEWAL_RE =
  /\b(ANAPARA\s*YENILE|MEVDUAT\s*YENILE|YENILEME|RENEWAL|PRINCIPAL\s*RENEW)/i;

const FAIZ_DESC_RE =
  /\b(FAIZ\s*GELIR|FAIZ\s*TAHAKKUK|FAIZ\s*TAHSIL|MEVDUAT\s*FAIZ|VADE\s*FAIZ|VADEL[Iİ]\s*FAIZ)/i;

const STOPAJ_DESC_RE =
  /\b(STOPAJ|MEVDUAT\s*FAIZ\s*STOPAJ|FAIZ\s*STOPAJ|FAIZ\s*VERGI)\b/i;

/** Kullanıcıya gösterilen eksik vadeli hesap mesajı / kategorisi */
export const VADELI_ACCOUNT_UNMATCHED_LABEL = "Vadeli mevduat hesabı eşleştirilmedi";

const AMOUNT_TOL = 1.0;

function absAmount(row = {}) {
  return Math.abs(Number(row.amount ?? row.tutar ?? 0) || 0);
}

function rowDesc(row = {}) {
  return normalizeParserText(row.description || row.aciklama || "");
}

function rowDirection(row = {}) {
  const d = String(row.direction || row.yon || "").toUpperCase();
  return d === "CIKIS" || d === "GIDEN" || d === "BORC" || d === "DEBIT"
    ? "CIKIS"
    : "GIRIS";
}

function digitsOnly(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function compactCode(value = "") {
  return String(value || "").trim().replace(/\s+/g, "");
}

function normalizeCurrency(value = "") {
  const raw = String(value || "TL").trim().toUpperCase();
  if (!raw || raw === "TRY" || raw === "TL." || raw === "YTL") return "TL";
  return raw;
}

function normalizeIban(value = "") {
  return normalizeParserText(value).replace(/\s+/g, "").toUpperCase();
}

function normalizeAccountType(value = "") {
  const t = String(value || "VADESIZ").trim().toUpperCase();
  if (t === "VADELI" || t === "TERM" || t === "TIME") return "VADELI";
  if (t === "VADESIZ" || t === "DEMAND" || t === "CHECKING") return "VADESIZ";
  return t || "VADESIZ";
}

function bankNameTokens(name = "") {
  const text = normalizeParserText(name).toUpperCase();
  const tokens = new Set();
  if (!text) return tokens;
  if (/VAKIF|VAKIFLAR/.test(text)) tokens.add("VAKIFBANK");
  if (/ZIRAAT|T\.?C\.?\s*ZIRAAT/.test(text)) tokens.add("ZIRAAT");
  if (/IS\s*BANK|TURKIYE\s*IS/.test(text)) tokens.add("ISBANK");
  if (/GARANTI|GARANTİ/.test(text)) tokens.add("GARANTI");
  if (/YAPI\s*KREDI|YAPIKREDI/.test(text)) tokens.add("YAPIKREDI");
  if (/AKBANK/.test(text)) tokens.add("AKBANK");
  if (/HALK/.test(text)) tokens.add("HALKBANK");
  if (/DENIZ/.test(text)) tokens.add("DENIZBANK");
  if (/TEB|TURK\s*EKONOMI/.test(text)) tokens.add("TEB");
  if (/KUVEYT/.test(text)) tokens.add("KUVEYT");
  if (/QNB|FINANSBANK/.test(text)) tokens.add("QNB");
  if (/ING/.test(text)) tokens.add("ING");
  tokens.add(text.replace(/\s+/g, ""));
  return tokens;
}

export function bankNamesCompatible(a = "", b = "") {
  const left = bankNameTokens(a);
  const right = bankNameTokens(b);
  if (!left.size || !right.size) return false;
  for (const token of left) {
    if (right.has(token)) return true;
  }
  return false;
}

export function listCompanyBankAccounts(company = null) {
  if (!company) return [];
  const list = [
    ...(Array.isArray(company.bankAccounts) ? company.bankAccounts : []),
    ...(Array.isArray(company.banks) ? company.banks : []),
  ];
  const seen = new Set();
  const out = [];
  for (const bank of list) {
    if (!bank || bank.isActive === false) continue;
    const code = compactCode(bank.lucaAccountCode || bank.accountCode || "");
    const key = `${code}|${normalizeIban(bank.iban)}|${digitsOnly(
      bank.accountNumber || bank.hesapNo || ""
    )}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(bank);
  }
  return out;
}

export function isLeaf102Code(code = "") {
  const c = compactCode(code);
  return Boolean(c && c.startsWith("102.") && c !== "102");
}

export function getBankAccountType(bank = null) {
  return normalizeAccountType(bank?.accountType);
}

export { BANK_ACCOUNT_MAPPING_SCOPE };

/**
 * Legacy mapping-only yolu (shadow / regresyon karşılaştırması).
 */
export function resolveStatementBankAccountLegacyMapping({
  company = null,
  accountNumber = "",
  iban = "",
  bankName = "",
  currency = "TL",
  accountType = "",
} = {}) {
  return resolveStatementAccountMapping({
    company,
    accountNumber,
    iban,
    bankName,
    currency,
    accountType,
  });
}

/**
 * Statement hesabını banka adı .find() ile değil; hesap no / IBAN / banka /
 * PB / accountType ile bağla. Birden fazla eşit aday → ambiguous.
 *
 * Öncelik (merkezi resolver — Faz 1):
 * A) belge override  B) EXACT  C) BANK_PRODUCT_CURRENCY  D) USER_LEARNED  E) SYSTEM
 * Ardından legacy skor fallback (ürün kuralı yokken).
 */
export function resolveStatementBankAccount({
  company = null,
  companyId = "",
  accountNumber = "",
  iban = "",
  bankName = "",
  currency = "TL",
  accountType = "",
  lucaHint = "",
  accountPlan = null,
  learningMemory = null,
  documentResolutions = null,
  sourceDocumentId = "",
  sourceMovementId = "",
  systemCandidates = null,
  direction = "",
  transactionType = "",
  description = "",
} = {}) {
  const centralDecision = resolveAccountingDecision({
    company,
    companyId: companyId || company?.id,
    accountPlan,
    bankName,
    accountNumber,
    iban,
    productType: accountType,
    currency,
    description,
    direction,
    transactionType,
    sourceDocumentId,
    sourceMovementId,
    documentResolutions,
    learningMemory,
    systemCandidates,
    lucaLeg: "bank",
  });
  const centralMapped = mapCentralDecisionToStatementResolve(
    centralDecision,
    "no_match"
  );
  if (centralMapped.ok) {
    return {
      ok: true,
      ambiguous: false,
      bank: {
        bankName: bankName || "",
        accountType: accountType || "VADELI",
        lucaAccountCode: centralMapped.code,
        accountCode: centralMapped.code,
        currency,
        accountNumber: accountNumber || "",
        mappingScope: centralMapped.mappingScope,
      },
      code: centralMapped.code,
      accountType: accountType || "VADELI",
      score: centralMapped.score,
      reasons: centralMapped.reasons || ["central_resolver"],
      mappingScope: centralMapped.mappingScope,
      centralSource: centralMapped.centralSource,
      centralScopeKey: centralMapped.centralScopeKey,
    };
  }
  if (centralMapped.ambiguous) {
    return {
      ok: false,
      ambiguous: true,
      bank: null,
      code: "",
      reason: centralMapped.reason || centralDecision.reason || "review_required",
      centralSource: centralMapped.centralSource,
      centralScopeKey: centralMapped.centralScopeKey,
    };
  }

  const mapped = resolveStatementAccountMapping({
    company,
    accountNumber,
    iban,
    bankName,
    currency,
    accountType,
  });
  if (mapped.ok) {
    return {
      ok: true,
      ambiguous: false,
      bank: mapped.bank || {
        bankName: mapped.bankName || bankName,
        accountType: mapped.accountType || accountType || "VADELI",
        lucaAccountCode: mapped.code,
        accountCode: mapped.code,
        currency: mapped.currency || currency,
        accountNumber: accountNumber || "",
        mappingScope: mapped.scope,
      },
      code: mapped.code,
      accountType: mapped.accountType || accountType,
      score: mapped.scope === BANK_ACCOUNT_MAPPING_SCOPE.EXACT_ACCOUNT ? 100 : 80,
      reasons:
        mapped.scope === BANK_ACCOUNT_MAPPING_SCOPE.EXACT_ACCOUNT
          ? ["exact_account"]
          : ["bank_product_currency"],
      mappingScope: mapped.scope,
    };
  }

  // Exact skor yolu (lucaHint / partial) — ürün kuralı yokken
  const banks = listCompanyBankAccounts(company);
  const wantDigits = digitsOnly(accountNumber);
  const wantIban = normalizeIban(iban);
  const wantCurrency = normalizeCurrency(currency);
  const wantType = accountType ? normalizeAccountType(accountType) : "";
  const hintCode = compactCode(lucaHint);

  const scored = [];
  for (const bank of banks) {
    let score = 0;
    const reasons = [];
    const bankDigits = digitsOnly(bank.accountNumber || bank.hesapNo || "");
    const bankIban = normalizeIban(bank.iban || "");
    const bankCurrency = normalizeCurrency(bank.currency || bank.paraBirimi || "TL");
    const bankType = getBankAccountType(bank);
    const code = compactCode(bank.lucaAccountCode || bank.accountCode || "");

    if (wantIban && bankIban && wantIban === bankIban) {
      score += 100;
      reasons.push("iban");
    }
    if (wantDigits && bankDigits) {
      if (wantDigits === bankDigits) {
        score += 90;
        reasons.push("account_number");
      } else if (
        wantDigits.length >= 8 &&
        bankDigits.length >= 8 &&
        (wantDigits.endsWith(bankDigits) ||
          bankDigits.endsWith(wantDigits) ||
          wantDigits.includes(bankDigits) ||
          bankDigits.includes(wantDigits))
      ) {
        score += 70;
        reasons.push("account_number_partial");
      }
    }
    if (hintCode && code && hintCode === code) {
      score += 60;
      reasons.push("luca_hint");
    }
    if (bankName && bankNamesCompatible(bank.bankName || bank.accountName || "", bankName)) {
      score += 20;
      reasons.push("bank");
    }
    if (bankCurrency === wantCurrency) {
      score += 10;
      reasons.push("currency");
    } else if (wantCurrency) {
      score -= 40;
      reasons.push("currency_mismatch");
    }
    if (wantType && bankType === wantType) {
      score += 25;
      reasons.push("account_type");
    }

    if (score > 0 && isLeaf102Code(code)) {
      scored.push({ bank, code, score, reasons, accountType: bankType });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) {
    return {
      ok: false,
      ambiguous: Boolean(mapped.ambiguous),
      bank: null,
      code: "",
      reason: mapped.reason || "no_match",
    };
  }
  const best = scored[0];
  const ties = scored.filter((s) => s.score === best.score);
  if (ties.length > 1) {
    return {
      ok: false,
      ambiguous: true,
      bank: null,
      code: "",
      candidates: ties,
      reason: "ambiguous_statement_account",
    };
  }
  const strong =
    best.reasons.includes("iban") ||
    best.reasons.includes("account_number") ||
    best.reasons.includes("account_number_partial") ||
    (best.reasons.includes("luca_hint") && best.reasons.includes("bank"));
  if (!strong) {
    return {
      ok: false,
      ambiguous: false,
      bank: null,
      code: "",
      reason: "weak_statement_match",
      best,
    };
  }
  return {
    ok: true,
    ambiguous: false,
    bank: best.bank,
    code: best.code,
    accountType: best.accountType,
    score: best.score,
    reasons: best.reasons,
    mappingScope: BANK_ACCOUNT_MAPPING_SCOPE.EXACT_ACCOUNT,
  };
}

/**
 * Aynı firma + aynı banka + VADESIZ + aynı PB + yaprak 102.
 * Birden fazla eşit aday → otomatik seçme (inceleme).
 */
export function resolveVadesizCounter102({
  company = null,
  sourceBank = null,
  currency = "TL",
  bankName = "",
} = {}) {
  const banks = listCompanyBankAccounts(company);
  const sourceCode = compactCode(
    sourceBank?.lucaAccountCode || sourceBank?.accountCode || ""
  );
  const sourceType = getBankAccountType(sourceBank);
  const wantCurrency = normalizeCurrency(
    currency || sourceBank?.currency || sourceBank?.paraBirimi || "TL"
  );
  const wantBank =
    bankName || sourceBank?.bankName || sourceBank?.accountName || "";

  if (sourceType === "VADELI" && !sourceCode) {
    return { ok: false, ambiguous: false, code: "", reason: "missing_source" };
  }

  const candidates = [];
  for (const bank of banks) {
    const code = compactCode(bank.lucaAccountCode || bank.accountCode || "");
    if (!isLeaf102Code(code)) continue;
    if (code === sourceCode) continue;
    if (getBankAccountType(bank) !== "VADESIZ") continue;
    const bankCurrency = normalizeCurrency(bank.currency || bank.paraBirimi || "TL");
    if (bankCurrency !== wantCurrency) continue;
    if (
      wantBank &&
      !bankNamesCompatible(bank.bankName || bank.accountName || "", wantBank)
    ) {
      continue;
    }
    candidates.push({ bank, code });
  }

  if (candidates.length === 0) {
    return { ok: false, ambiguous: false, code: "", reason: "no_vadesiz" };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      ambiguous: true,
      code: "",
      candidates,
      reason: "ambiguous_vadesiz",
    };
  }
  return {
    ok: true,
    ambiguous: false,
    code: candidates[0].code,
    bank: candidates[0].bank,
    reason: "unique_vadesiz",
  };
}

export function isVadeliToVadeliTransfer(sourceBank = null, targetBank = null) {
  if (!sourceBank || !targetBank) return false;
  return (
    getBankAccountType(sourceBank) === "VADELI" &&
    getBankAccountType(targetBank) === "VADELI"
  );
}

/** Virman yalnız açık VADESIZ↔VADESIZ 102 çiftinde. */
export function isVadesizToVadesizTransfer(sourceBank = null, targetBank = null) {
  if (!sourceBank || !targetBank) return false;
  return (
    getBankAccountType(sourceBank) === "VADESIZ" &&
    getBankAccountType(targetBank) === "VADESIZ"
  );
}

/**
 * VADELİ↔VADELİ sınıflandırma — açıklama tek başına yetmez.
 * Hesap niteliği + yön + (mümkünse) tutar/bundle sinyali gerekir.
 * @returns {{ role: string, confidence: "high"|"review", reasons: string[] } | null}
 */
export function classifyVadeliToVadeliMovement({
  sourceBank = null,
  targetBank = null,
  description = "",
  direction = "",
  amount = 0,
  relatedMovements = [],
} = {}) {
  if (!isVadeliToVadeliTransfer(sourceBank, targetBank)) return null;

  const desc = normalizeParserText(description);
  const dir = String(direction || "").toUpperCase();
  const amt = Math.abs(Number(amount) || 0);
  const reasons = ["vadeli_to_vadeli_accounts"];

  const rolloverHint = LIFECYCLE_ROLLOVER_RE.test(desc);
  const renewalHint = LIFECYCLE_RENEWAL_RE.test(desc);
  if (rolloverHint) reasons.push("desc_rollover");
  if (renewalHint) reasons.push("desc_renewal");

  // Karşı hareket: aynı tutar, ters yön, diğer vadeli — bundle sinyali
  const peers = Array.isArray(relatedMovements) ? relatedMovements : [];
  const mirror = peers.find((m) => {
    if (!m || m === sourceBank) return false;
    const peerAmt = Math.abs(Number(m.amount ?? m.tutar ?? 0) || 0);
    if (amt < AMOUNT_TOL || Math.abs(peerAmt - amt) > AMOUNT_TOL) return false;
    const peerDir = String(m.direction || m.yon || "").toUpperCase();
    const opposite =
      (dir === "GIRIS" || dir === "GELEN") &&
      (peerDir === "CIKIS" || peerDir === "GIDEN" || peerDir === "BORC")
        ? true
        : (dir === "CIKIS" || dir === "GIDEN" || dir === "BORC") &&
          (peerDir === "GIRIS" || peerDir === "GELEN");
    return opposite;
  });
  if (mirror) reasons.push("mirror_amount_opposite_direction");

  const accountEvidence = Boolean(sourceBank && targetBank);
  const strong =
    accountEvidence &&
    Boolean(mirror) &&
    (rolloverHint || renewalHint);

  if (strong && renewalHint && !rolloverHint) {
    return {
      role: VADELI_LIFECYCLE_ROLE.ANAPARA_YENILEME,
      confidence: "high",
      reasons,
    };
  }
  if (strong && rolloverHint) {
    return {
      role: VADELI_LIFECYCLE_ROLE.VADE_DONUSU,
      confidence: "high",
      reasons,
    };
  }

  // Açıklama tek başına veya zayıf sinyal → inceleme (virman değil)
  return {
    role: "",
    confidence: "review",
    reasons: [...reasons, "insufficient_lifecycle_evidence"],
  };
}

export function findBankByLucaCode(company = null, lucaCode = "") {
  const code = compactCode(lucaCode);
  if (!code) return null;
  return (
    listCompanyBankAccounts(company).find(
      (b) => compactCode(b.lucaAccountCode || b.accountCode || "") === code
    ) || null
  );
}

/**
 * Keyword gate — bundle doğrulanmasa bile açılış/kapanış/faiz/stopaj tipini işaretle.
 * Hesap atamaz; cari/virman yanlış sınıflamasını önler.
 */
export function applyVadeliKeywordGate(movements = []) {
  const list = Array.isArray(movements) ? movements : [];
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (!row) continue;
    const desc = rowDesc(row);
    const dir = rowDirection(row);
    const existing = String(row.transactionType || "");

    if (dir === "GIRIS" && LIFECYCLE_OPEN_RE.test(desc)) {
      if (
        !existing ||
        existing === "BILINMEYEN" ||
        existing === BANK_TRANSACTION_TYPE.GELEN_HAVALE ||
        existing === "BANKA_ICI_VIRMAN"
      ) {
        list[i] = {
          ...row,
          transactionType: BANK_TRANSACTION_TYPE.VADELI_ACILIS,
          cariRequired: false,
          personelRequired: false,
          virmanCandidate: false,
          accountingScenario: VADELI_LIFECYCLE_SCENARIO,
          vadeliLifecycleRole:
            row.vadeliLifecycleRole || VADELI_LIFECYCLE_ROLE.ACILIS,
          vadeliKeywordGate: true,
        };
      }
      continue;
    }
    if (dir === "CIKIS" && LIFECYCLE_CLOSE_RE.test(desc)) {
      if (
        !existing ||
        existing === "BILINMEYEN" ||
        existing === BANK_TRANSACTION_TYPE.GIDEN_HAVALE ||
        existing === "BANKA_ICI_VIRMAN"
      ) {
        list[i] = {
          ...row,
          transactionType: BANK_TRANSACTION_TYPE.VADELI_KAPANIS,
          cariRequired: false,
          personelRequired: false,
          virmanCandidate: false,
          accountingScenario: VADELI_LIFECYCLE_SCENARIO,
          vadeliLifecycleRole:
            row.vadeliLifecycleRole || VADELI_LIFECYCLE_ROLE.KAPANIS,
          vadeliKeywordGate: true,
        };
      }
      continue;
    }
    if (
      dir === "GIRIS" &&
      FAIZ_DESC_RE.test(desc) &&
      existing !== BANK_TRANSACTION_TYPE.FAIZ_GELIRI
    ) {
      list[i] = {
        ...row,
        transactionType: BANK_TRANSACTION_TYPE.FAIZ_GELIRI,
        cariRequired: false,
        personelRequired: false,
        virmanCandidate: false,
        vadeliLifecycleRole: row.vadeliLifecycleRole || VADELI_LIFECYCLE_ROLE.FAIZ,
        vadeliKeywordGate: true,
      };
      continue;
    }
    if (
      dir === "CIKIS" &&
      (STOPAJ_DESC_RE.test(desc) ||
        String(row.transactionType || "") === BANK_TRANSACTION_TYPE.FAIZ_STOPAJI) &&
      existing !== BANK_TRANSACTION_TYPE.FAIZ_STOPAJI
    ) {
      list[i] = {
        ...row,
        transactionType: BANK_TRANSACTION_TYPE.FAIZ_STOPAJI,
        cariRequired: false,
        personelRequired: false,
        virmanCandidate: false,
        vadeliLifecycleRole: row.vadeliLifecycleRole || VADELI_LIFECYCLE_ROLE.STOPAJ,
        vadeliKeywordGate: true,
      };
    }
  }
  return list;
}

function isStopajCandidate(row, open, close) {
  if (!row || row === open || row === close) return false;
  if (rowDirection(row) !== "CIKIS") return false;
  const t = String(row.transactionType || "");
  if (t === BANK_TRANSACTION_TYPE.FAIZ_GELIRI) return false;
  if (LIFECYCLE_OPEN_RE.test(rowDesc(row))) return false;
  if (LIFECYCLE_CLOSE_RE.test(rowDesc(row))) return false;
  if (t === BANK_TRANSACTION_TYPE.FAIZ_STOPAJI) return true;
  if (STOPAJ_DESC_RE.test(rowDesc(row))) return true;
  if (/\b(VERGI|STOPAJ)\b/i.test(rowDesc(row))) return true;
  return absAmount(row) > 0 && absAmount(row) < absAmount(open || { amount: Infinity });
}

function isFaizCandidate(row) {
  if (!row || rowDirection(row) !== "GIRIS") return false;
  return (
    String(row.transactionType || "") === BANK_TRANSACTION_TYPE.FAIZ_GELIRI ||
    FAIZ_DESC_RE.test(rowDesc(row))
  );
}

/**
 * Statement içindeki yaşam döngüsü demetini bul.
 * Tek dönem (4’lü) veya N dönem (açılış + Σ(faiz−stopaj) = kapanış).
 */
export function detectVadeliLifecycleBundle(movements = []) {
  const rows = Array.isArray(movements) ? movements : [];
  const opens = rows.filter(
    (r) => rowDirection(r) === "GIRIS" && LIFECYCLE_OPEN_RE.test(rowDesc(r))
  );
  const closes = rows.filter(
    (r) => rowDirection(r) === "CIKIS" && LIFECYCLE_CLOSE_RE.test(rowDesc(r))
  );

  // 1) Klasik tek faiz/stopaj demeti
  const faizRows = rows.filter(isFaizCandidate);
  for (const open of opens) {
    for (const faiz of faizRows) {
      for (const close of closes) {
        const principal = absAmount(open);
        const faizAmt = absAmount(faiz);
        const closing = absAmount(close);
        const stopajCandidates = rows.filter((r) => isStopajCandidate(r, open, close));

        for (const stopaj of stopajCandidates) {
          const stopajAmt = absAmount(stopaj);
          const expected =
            Math.round((principal + faizAmt - stopajAmt) * 100) / 100;
          if (Math.abs(closing - expected) > AMOUNT_TOL) continue;

          const rate = matchesFaizStopajRate(stopajAmt, faizAmt);
          const life = matchesVadeliLifecycleAmounts(rows, stopaj, faiz);
          const stopajTypeOk =
            String(stopaj.transactionType || "") ===
              BANK_TRANSACTION_TYPE.FAIZ_STOPAJI ||
            rate.ok ||
            life.ok ||
            /\b(VERGI|STOPAJ)\b/i.test(rowDesc(stopaj));

          if (!stopajTypeOk) continue;

          return {
            ok: true,
            mode: "single_period",
            open,
            faiz,
            stopaj,
            close,
            faizRows: [faiz],
            stopajRows: [stopaj],
            principal,
            faizAmount: faizAmt,
            stopajAmount: stopajAmt,
            closing,
            expected,
            rate: rate.ok ? rate.rate : null,
          };
        }
      }
    }
  }

  // 2) N dönem: principal + Σ(faiz − stopaj) = kapanış
  for (const open of opens) {
    for (const close of closes) {
      const principal = absAmount(open);
      const closing = absAmount(close);
      const periodFaiz = rows.filter(
        (r) => r !== open && isFaizCandidate(r)
      );
      const periodStopaj = rows.filter((r) => isStopajCandidate(r, open, close));
      if (!periodFaiz.length || !periodStopaj.length) continue;

      const faizSum = periodFaiz.reduce((s, r) => s + absAmount(r), 0);
      const stopajSum = periodStopaj.reduce((s, r) => s + absAmount(r), 0);
      const expected =
        Math.round((principal + faizSum - stopajSum) * 100) / 100;
      if (Math.abs(closing - expected) > AMOUNT_TOL) continue;

      // Her faiz için oran-uyumlu en az bir stopaj veya toplam oran
      const rate = matchesFaizStopajRate(stopajSum, faizSum);

      return {
        ok: true,
        mode: "multi_period",
        open,
        faiz: periodFaiz[0],
        stopaj: periodStopaj[0],
        close,
        faizRows: periodFaiz,
        stopajRows: periodStopaj,
        principal,
        faizAmount: faizSum,
        stopajAmount: stopajSum,
        closing,
        expected,
        rate: rate.ok ? rate.rate : null,
      };
    }
  }

  return { ok: false };
}

function planRowName(plan = {}) {
  return normalizeParserText(
    plan.accountName || plan.name || plan.hesapAdi || plan.description || ""
  );
}

function planRowCode(plan = {}) {
  return compactCode(plan.accountCode || plan.code || plan.hesapKodu || "");
}

function planImpliesAccountType(plan = {}, wantType = "", options = {}) {
  const want = normalizeAccountType(wantType);
  const name = planRowName(plan);
  // V001/V002 kodları tek başına tür ayırt etmez; ad zorunlu.
  if (want === "VADELI") {
    return (
      /\bVADEL[Iİ]\b|TERM\s*DEPOSIT/.test(name) && !/\bVADESIZ\b/.test(name)
    );
  }
  if (want === "VADESIZ") {
    // Vadeli etiketli satır asla VADESIZ sayılmaz (Türkçe İ normalize sonrası).
    if (/\bVADEL[Iİ]\b|TERM\s*DEPOSIT/.test(name)) return false;
    if (/\bVADESIZ\b|\bDEMAND\b|\bCHECKING\b/.test(name)) return true;
    // Prod planlarında vadesiz satırlarda sıkça "VADESIZ" kelimesi yok
    // (örn. "VAKIFBANK TL … ÖNBÜRO"). Aynı banka + yaprak 102 + vadeli değil.
    if (options.allowImplicitDemand && isLeaf102Code(planRowCode(plan))) {
      return true;
    }
    return false;
  }
  return false;
}

function planCurrencyOk(plan = {}, currency = "TL") {
  const want = normalizeCurrency(currency);
  const name = planRowName(plan);
  if (!want) return true;
  if (want === "TL") {
    if (/\b(USD|EUR|GBP|CHF)\b/.test(name)) return false;
    return true;
  }
  return name.includes(want) || !/\b(USD|EUR|GBP|CHF|TL|TRY)\b/.test(name);
}

/**
 * Firma banka kartı boş/eksikse hesap planındaki yaprak 102 satırlarından
 * VADELI / VADESIZ çözümle. Belirsiz çoklu adayda otomatik seçim yok.
 */
export function resolve102RoleFromAccountPlan({
  companyPlans = [],
  bankName = "",
  currency = "TL",
  accountType = "",
  accountNumber = "",
  excludeCodes = [],
} = {}) {
  const wantType = normalizeAccountType(accountType);
  if (wantType !== "VADELI" && wantType !== "VADESIZ") {
    return { ok: false, ambiguous: false, code: "", reason: "bad_type" };
  }
  const exclude = new Set(
    (excludeCodes || []).map((c) => compactCode(c)).filter(Boolean)
  );
  const wantDigits = digitsOnly(accountNumber);

  const scorePlans = (allowImplicitDemand) => {
    const scored = [];
    for (const plan of companyPlans || []) {
      if (plan?.isActive === false) continue;
      const code = planRowCode(plan);
      if (!isLeaf102Code(code) || exclude.has(code)) continue;
      if (!planImpliesAccountType(plan, wantType, { allowImplicitDemand })) {
        continue;
      }
      if (!planCurrencyOk(plan, currency)) continue;

      let score = 10;
      const reasons = ["plan_type"];
      const name = planRowName(plan);

      if (bankName && bankNamesCompatible(name, bankName)) {
        score += 30;
        reasons.push("bank");
      } else if (bankName) {
        // Banka adı verilmişse diğer banka adayları havuza girmez (aşağıda elenir)
        reasons.push("bank_absent");
      }

      if (wantDigits && wantDigits.length >= 8) {
        const nameDigits = digitsOnly(name);
        if (
          nameDigits &&
          (nameDigits.includes(wantDigits) ||
            wantDigits.includes(nameDigits) ||
            nameDigits.endsWith(wantDigits.slice(-10)) ||
            wantDigits.endsWith(nameDigits.slice(-10)))
        ) {
          score += 50;
          reasons.push("account_number");
        }
      }

      if (wantType === "VADESIZ") {
        if (/\bVADESIZ\b|\bDEMAND\b|\bCHECKING\b/.test(name)) {
          score += 25;
          reasons.push("explicit_vadesiz");
        }
        if (/\bONBURO\b|\bON\s*BURO\b/.test(name)) {
          score += 20;
          reasons.push("onburo");
        }
      }

      scored.push({ code, plan, score, reasons, name });
    }
    scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
    return scored;
  };

  // VADESIZ: önce açık etiket; yoksa aynı bankanın vadeli-olmayan yaprak 102'leri
  let scored = scorePlans(false);
  if (
    wantType === "VADESIZ" &&
    bankName &&
    !scored.some((s) => s.reasons.includes("bank"))
  ) {
    scored = scorePlans(true);
  } else if (wantType === "VADESIZ" && !scored.length) {
    scored = scorePlans(true);
  }

  if (!scored.length) {
    return { ok: false, ambiguous: false, code: "", reason: "no_plan_match" };
  }

  // Banka adı verildiyse yalnızca aynı banka — yabancı bankaya sessiz kaçış yok
  let pool = scored;
  if (bankName) {
    const withBank = scored.filter((s) => s.reasons.includes("bank"));
    if (!withBank.length) {
      return {
        ok: false,
        ambiguous: false,
        code: "",
        reason: "no_bank_plan_match",
        candidates: scored.slice(0, 12),
      };
    }
    pool = withBank;
  }

  const best = pool[0];
  const ties = pool.filter((s) => s.score === best.score);
  if (ties.length > 1) {
    return {
      ok: false,
      ambiguous: true,
      code: "",
      reason: "ambiguous_plan_102",
      candidates: ties,
    };
  }

  // Güçlü bağ: hesap no veya (banka + tür)
  const strong =
    best.reasons.includes("account_number") ||
    best.reasons.includes("bank") ||
    best.reasons.includes("explicit_vadesiz") ||
    best.reasons.includes("onburo") ||
    pool.length === 1;
  if (!strong) {
    return {
      ok: false,
      ambiguous: false,
      code: "",
      reason: "weak_plan_match",
      best,
    };
  }

  return {
    ok: true,
    ambiguous: false,
    code: best.code,
    reason: "plan_unique",
    reasons: best.reasons,
    bank: {
      bankName: bankName || "",
      accountName: best.name,
      accountType: wantType,
      lucaAccountCode: best.code,
      accountNumber: accountNumber || "",
      currency: normalizeCurrency(currency),
      isActive: true,
      fromAccountPlan: true,
    },
  };
}

function clearTaxWarnings(row) {
  const warn = String(row.warning || "")
    .split("|")
    .map((w) => w.trim())
    .filter(Boolean)
    .filter(
      (w) =>
        !/VERGI\/SGK|TAHAKKUK|MALI YUKUMLULUK|Kural bulunamad[ıi]|Finans işlem türü çözülemedi|Hesap planında bulunamad[ıi]/i.test(
          normalizeParserText(w)
        )
    );
  return warn;
}

function movementId(row = {}) {
  return row.sourceMovementId || row.sourceRowId || row.id || "";
}

/**
 * Tenant-safe hafıza anahtarı: firma + banka + PB + tür + yön + lifecycle rolü.
 */
export function buildVadeliLifecycleMemoryKey({
  companyId = "",
  bankName = "",
  currency = "TL",
  accountType = "",
  direction = "",
  lifecycleRole = "",
} = {}) {
  return [
    "vd",
    String(companyId || "").trim(),
    normalizeParserText(bankName).replace(/\s+/g, ""),
    normalizeCurrency(currency),
    normalizeAccountType(accountType),
    String(direction || "").toUpperCase(),
    String(lifecycleRole || "").toUpperCase(),
  ].join("|");
}

export function buildVadeliLifecycleMemoryRecords({
  companyId = "",
  bankName = "",
  currency = "TL",
  statementAccountType = "VADELI",
  statementCode = "",
  vadesizCode = "",
  faizCode = "",
  stopajCode = "",
} = {}) {
  if (!companyId) return [];
  const base = {
    companyId,
    bankName,
    currency: normalizeCurrency(currency),
    source: "vadeliMevduatLifecycle",
    confidence: 96,
    decisionType: "GL",
  };
  const records = [];
  if (vadesizCode && statementCode) {
    records.push({
      ...base,
      analysisKey: buildVadeliLifecycleMemoryKey({
        companyId,
        bankName,
        currency,
        accountType: statementAccountType,
        direction: "GIRIS",
        lifecycleRole: VADELI_LIFECYCLE_ROLE.ACILIS,
      }),
      direction: "GIRIS",
      transactionType: BANK_TRANSACTION_TYPE.VADELI_ACILIS,
      accountCode: vadesizCode,
      statementAccountCode: statementCode,
      lifecycleRole: VADELI_LIFECYCLE_ROLE.ACILIS,
      accountType: "VADESIZ",
      counterAccountType: "VADESIZ",
    });
    records.push({
      ...base,
      analysisKey: buildVadeliLifecycleMemoryKey({
        companyId,
        bankName,
        currency,
        accountType: statementAccountType,
        direction: "CIKIS",
        lifecycleRole: VADELI_LIFECYCLE_ROLE.KAPANIS,
      }),
      direction: "CIKIS",
      transactionType: BANK_TRANSACTION_TYPE.VADELI_KAPANIS,
      accountCode: vadesizCode,
      statementAccountCode: statementCode,
      lifecycleRole: VADELI_LIFECYCLE_ROLE.KAPANIS,
      accountType: "VADESIZ",
      counterAccountType: "VADESIZ",
    });
  }
  if (faizCode) {
    records.push({
      ...base,
      analysisKey: buildVadeliLifecycleMemoryKey({
        companyId,
        bankName,
        currency,
        accountType: statementAccountType,
        direction: "GIRIS",
        lifecycleRole: VADELI_LIFECYCLE_ROLE.FAIZ,
      }),
      direction: "GIRIS",
      transactionType: BANK_TRANSACTION_TYPE.FAIZ_GELIRI,
      accountCode: faizCode,
      statementAccountCode: statementCode,
      lifecycleRole: VADELI_LIFECYCLE_ROLE.FAIZ,
    });
  }
  if (stopajCode) {
    records.push({
      ...base,
      analysisKey: buildVadeliLifecycleMemoryKey({
        companyId,
        bankName,
        currency,
        accountType: statementAccountType,
        direction: "CIKIS",
        lifecycleRole: VADELI_LIFECYCLE_ROLE.STOPAJ,
      }),
      direction: "CIKIS",
      transactionType: BANK_TRANSACTION_TYPE.FAIZ_STOPAJI,
      accountCode: stopajCode,
      statementAccountCode: statementCode,
      lifecycleRole: VADELI_LIFECYCLE_ROLE.STOPAJ,
    });
  }
  return records;
}

/**
 * Hafıza önerisi vadeli→vadeli ise reddet (deterministik güvenlik).
 */
export function isForbiddenVadeliMemorySuggestion({
  statementAccountType = "",
  suggestedAccountCode = "",
  company = null,
} = {}) {
  if (normalizeAccountType(statementAccountType) !== "VADELI") return false;
  const target = findBankByLucaCode(company, suggestedAccountCode);
  if (!target) {
    // 102.* ama firma kartında yoksa yine de vadeli kod pattern'i kontrol etme
    return false;
  }
  return getBankAccountType(target) === "VADELI";
}

/**
 * VADELİ bacaklarda virman bayraklarını temizle; VADELİ↔VADELİ için
 * vade dönüşü / anapara yenileme (çoklu kanıt) veya güvenli inceleme.
 */
export function applyVadeliVirmanSafetyAndRollover(movements = [], context = {}) {
  const list = Array.isArray(movements) ? movements : [];
  const company =
    context.selectedCompany || context.company || context.firma || null;

  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (!row) continue;

    const statementCode = compactCode(
      row.accountCode || row.bankAccountCode || ""
    );
    let counterCode = compactCode(row.counterAccountCode || "");
    const sourceBank =
      findBankByLucaCode(company, statementCode) ||
      (getBankAccountType({ accountType: context.statementAccountType }) ===
      "VADELI"
        ? { accountType: "VADELI", lucaAccountCode: statementCode }
        : null);
    let targetBank = counterCode
      ? findBankByLucaCode(company, counterCode)
      : null;

    // Karşı hesap kodu yoksa evidence IBAN/hesap no ile diğer VADELİ'yi bul
    if (!targetBank && company) {
      const evidence = normalizeParserText(
        `${row.description || ""} ${row.aciklama || ""} ${row.detayAciklama || ""} ${row.karsiIban || ""}`
      );
      const evidenceDigits = digitsOnly(evidence);
      for (const bank of listCompanyBankAccounts(company)) {
        if (getBankAccountType(bank) !== "VADELI") continue;
        const code = compactCode(bank.lucaAccountCode || bank.accountCode || "");
        if (!code || code === statementCode) continue;
        const bankIban = normalizeIban(bank.iban || "");
        const bankDig = digitsOnly(bank.accountNumber || bank.hesapNo || "");
        if (
          (bankIban && evidence.includes(bankIban)) ||
          (bankDig.length >= 8 && evidenceDigits.includes(bankDig))
        ) {
          targetBank = bank;
          counterCode = code;
          break;
        }
      }
    }

    const statementIsVadeli =
      getBankAccountType(sourceBank) === "VADELI" ||
      normalizeAccountType(context.statementAccountType) === "VADELI" ||
      String(row.vadeliLifecycleRole || "").startsWith("VADELI_") ||
      String(row.transactionType || "").startsWith("VADELI_");

    // Virman senaryo/bayrak temizliği — VADELİ bacak asla virman sayılmaz
    if (statementIsVadeli || isVadeliToVadeliTransfer(sourceBank, targetBank)) {
      const scrub = {
        virmanCandidate: false,
        bankInternalTransfer: false,
      };
      const tx = String(row.transactionType || "");
      if (
        tx === "BANKA_ICI_VIRMAN" ||
        tx === "BANKALAR_ARASI_VIRMAN" ||
        tx === "VIRMAN" ||
        tx === "BANK_INTERNAL_TRANSFER"
      ) {
        scrub.transactionType = "BILINMEYEN";
      }
      if (
        String(row.accountingScenario || "") === "BANKA_ICI_VIRMAN" ||
        String(row.accountingScenario || "") === "BANKALAR_ARASI_VIRMAN"
      ) {
        // Lifecycle rolleri korunur; senaryo VADELI_LIFECYCLE'a çekilir
        if (
          row.transactionType === BANK_TRANSACTION_TYPE.VADELI_ACILIS ||
          row.transactionType === BANK_TRANSACTION_TYPE.VADELI_KAPANIS ||
          row.transactionType === BANK_TRANSACTION_TYPE.VADELI_VADE_DONUSU ||
          row.transactionType === BANK_TRANSACTION_TYPE.VADELI_ANAPARA_YENILEME ||
          row.vadeliLifecycleRole ||
          scrub.transactionType === "BILINMEYEN"
        ) {
          scrub.accountingScenario =
            row.vadeliLifecycleRole ||
            row.transactionType === BANK_TRANSACTION_TYPE.VADELI_ACILIS ||
            row.transactionType === BANK_TRANSACTION_TYPE.VADELI_KAPANIS ||
            row.transactionType === BANK_TRANSACTION_TYPE.VADELI_VADE_DONUSU ||
            row.transactionType === BANK_TRANSACTION_TYPE.VADELI_ANAPARA_YENILEME
              ? VADELI_LIFECYCLE_SCENARIO
              : "";
        } else {
          scrub.accountingScenario = "";
        }
      }
      list[i] = { ...row, ...scrub };
    }

    if (!isVadeliToVadeliTransfer(sourceBank, targetBank)) continue;
    // Zaten lifecycle açılış/kapanış (vadesiz karşı) değil — vadeli↔vadeli
    if (
      row.vadeliLifecycleRole === VADELI_LIFECYCLE_ROLE.ACILIS ||
      row.vadeliLifecycleRole === VADELI_LIFECYCLE_ROLE.KAPANIS
    ) {
      continue;
    }

    const classified = classifyVadeliToVadeliMovement({
      sourceBank,
      targetBank,
      description: row.description || row.aciklama || "",
      direction: row.direction || row.yon || "",
      amount: row.amount ?? row.tutar ?? 0,
      relatedMovements: list.filter((_, j) => j !== i),
    });
    if (!classified) continue;

    if (classified.confidence === "high") {
      const isRenewal =
        classified.role === VADELI_LIFECYCLE_ROLE.ANAPARA_YENILEME;
      const tx = isRenewal
        ? BANK_TRANSACTION_TYPE.VADELI_ANAPARA_YENILEME
        : BANK_TRANSACTION_TYPE.VADELI_VADE_DONUSU;
      const warn = isRenewal
        ? "Vadeli anapara yenileme (vadeli↔vadeli; virman değil)"
        : "Vadeli vade dönüşü (vadeli↔vadeli; virman değil)";
      list[i] = {
        ...list[i],
        transactionType: tx,
        accountingScenario: VADELI_LIFECYCLE_SCENARIO,
        cariRequired: false,
        personelRequired: false,
        virmanCandidate: false,
        bankInternalTransfer: false,
        missingHesapCategory: "",
        vadeliLifecycleRole: classified.role,
        warning: [...clearTaxWarnings(list[i]), warn].join(" | "),
        matchedRule: {
          source: "vadeliMevduatLifecycle",
          islem: tx,
          anahtar: isRenewal ? "vadeli-yenileme" : "vadeli-vade-donusu",
          transactionType: tx,
          reasons: classified.reasons,
        },
      };
    } else {
      // Belirsiz VADELİ↔VADELİ → inceleme; virman yok
      list[i] = {
        ...list[i],
        virmanCandidate: false,
        bankInternalTransfer: false,
        accountingScenario:
          list[i].accountingScenario === "BANKA_ICI_VIRMAN" ||
          list[i].accountingScenario === "BANKALAR_ARASI_VIRMAN"
            ? ""
            : list[i].accountingScenario || "",
        missingHesapCategory: MISSING_HESAP_CATEGORY.DIGER || "Diğer",
        warning: [
          ...clearTaxWarnings(list[i]),
          "Vadeli↔vadeli hareket otomatik virman yapılamaz — inceleme",
        ].join(" | "),
        vadeliLifecycleMeta: {
          ...(list[i].vadeliLifecycleMeta || {}),
          vadeliToVadeliReview: true,
          reasons: classified.reasons,
        },
      };
    }
  }

  return list;
}

function findUniquePlanAccount(companyPlans = [], prefixes = []) {
  const plans = Array.isArray(companyPlans) ? companyPlans : [];
  const hits = [];
  for (const prefix of prefixes) {
    for (const p of plans) {
      if (p?.isActive === false) continue;
      const code = compactCode(p.accountCode || p.code || "");
      if (!code) continue;
      if (code === prefix || code.startsWith(`${prefix}.`) || code.startsWith(prefix)) {
        if (!hits.includes(code)) hits.push(code);
      }
    }
    if (hits.length) break;
  }
  if (hits.length === 1) return { ok: true, code: hits[0], ambiguous: false };
  if (hits.length > 1) return { ok: false, code: "", ambiguous: true, candidates: hits };
  return { ok: false, code: "", ambiguous: false };
}

/**
 * Mapper post-pass: yaşam döngüsünü sınıflandır ve hesapları uygula.
 */
export function applyVadeliMevduatLifecycle(movements = [], context = {}) {
  const list = applyVadeliKeywordGate(
    Array.isArray(movements) ? movements.map((m) => ({ ...m })) : []
  );
  const company =
    context.selectedCompany || context.company || context.firma || null;
  const companyId = String(
    context.companyId || company?.id || company?.companyId || ""
  ).trim();
  const selectedBank = String(
    context.selectedBank || context.bankName || ""
  ).trim();
  const companyPlans = context.companyPlans || context.accountPlan || [];
  const currency = normalizeCurrency(
    context.currency || context.paraBirimi || "TL"
  );

  const finish = (payload) => {
    applyVadeliVirmanSafetyAndRollover(payload.movements, context);
    return payload;
  };

  const markVadeliUnmatched = (reason = "") => {
    for (let i = 0; i < list.length; i += 1) {
      const row = list[i];
      const role = String(row.vadeliLifecycleRole || "");
      const tx = String(row.transactionType || "");
      const isVadeliRow =
        role.startsWith("VADELI_") ||
        tx === BANK_TRANSACTION_TYPE.VADELI_ACILIS ||
        tx === BANK_TRANSACTION_TYPE.VADELI_KAPANIS ||
        tx === BANK_TRANSACTION_TYPE.FAIZ_GELIRI ||
        tx === BANK_TRANSACTION_TYPE.FAIZ_STOPAJI ||
        LIFECYCLE_OPEN_RE.test(rowDesc(row)) ||
        LIFECYCLE_CLOSE_RE.test(rowDesc(row));
      if (!isVadeliRow) continue;
      list[i] = {
        ...row,
        cariRequired: false,
        personelRequired: false,
        virmanCandidate: false,
        bankInternalTransfer: false,
        missingHesapCategory: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
        warning: [
          ...clearTaxWarnings(row),
          VADELI_ACCOUNT_UNMATCHED_LABEL,
          reason,
        ]
          .filter(Boolean)
          .join(" | "),
      };
    }
  };

  const bundle = detectVadeliLifecycleBundle(list);
  if (!bundle.ok) {
    const hasVadeliKeyword = list.some(
      (r) =>
        r.vadeliKeywordGate ||
        String(r.transactionType || "").startsWith("VADELI_") ||
        LIFECYCLE_OPEN_RE.test(rowDesc(r)) ||
        LIFECYCLE_CLOSE_RE.test(rowDesc(r))
    );
    if (hasVadeliKeyword) {
      const hintAccount =
        context.statementAccountHint ||
        context.accountNumber ||
        context.hesapNo ||
        "";
      const statementProbe = resolveStatementBankAccount({
        company,
        accountNumber: hintAccount,
        iban: context.statementIban || context.iban || "",
        bankName: selectedBank,
        currency,
        accountType: "VADELI",
        lucaHint: context.statementLucaHint || "",
      });
      if (!statementProbe.ok) {
        markVadeliUnmatched(statementProbe.reason || "no_lifecycle_bundle");
      }
    }
    return finish({
      movements: list,
      applied: false,
      bundle: null,
      memoryRecords: [],
      unresolvedReason: "no_lifecycle_bundle",
    });
  }

  const hintAccount =
    context.statementAccountHint ||
    context.accountNumber ||
    context.hesapNo ||
    bundle.open?.rawRow?.hesapNo ||
    bundle.open?.accountNumber ||
    "";
  const hintIban =
    context.statementIban ||
    context.iban ||
    bundle.open?.rawRow?.iban ||
    bundle.open?.iban ||
    "";

  const statement = resolveStatementBankAccount({
    company,
    accountNumber: hintAccount,
    iban: hintIban,
    bankName: selectedBank,
    currency,
    accountType: "VADELI",
    lucaHint: context.statementLucaHint || "",
  });

  let statementBank = statement.bank;
  let statementCode = statement.code;

  if (!statement.ok) {
    const candidateCode = compactCode(bundle.open?.accountCode || "");
    const byCode = findBankByLucaCode(company, candidateCode);
    if (byCode && getBankAccountType(byCode) === "VADELI" && hintAccount) {
      const dig = digitsOnly(byCode.accountNumber || byCode.hesapNo || "");
      const hintDig = digitsOnly(hintAccount);
      if (
        dig &&
        hintDig &&
        (dig === hintDig || dig.endsWith(hintDig) || hintDig.endsWith(dig))
      ) {
        statementBank = byCode;
        statementCode = candidateCode;
      }
    }
  }

  if ((!statementCode || !statementBank) && hintAccount) {
    const fromPlan = resolve102RoleFromAccountPlan({
      companyPlans,
      bankName: selectedBank,
      currency,
      accountType: "VADELI",
      accountNumber: hintAccount,
    });
    if (fromPlan.ok && (fromPlan.reasons || []).includes("account_number")) {
      statementBank = fromPlan.bank;
      statementCode = fromPlan.code;
    }
  }

  if (!statementCode || !statementBank) {
    markVadeliUnmatched(statement.reason || "statement_unresolved");
    return finish({
      movements: list,
      applied: false,
      bundle,
      memoryRecords: [],
      unresolvedReason: statement.reason || "statement_unresolved",
    });
  }

  if (getBankAccountType(statementBank) === "VADELI") {
    // ok
  } else if (context.forceStatementVadeli) {
    statementBank = { ...statementBank, accountType: "VADELI" };
  }

  let vadesiz = resolveVadesizCounter102({
    company,
    sourceBank: statementBank,
    currency,
    bankName: selectedBank || statementBank.bankName,
  });

  if (!vadesiz.ok) {
    const fromPlan = resolve102RoleFromAccountPlan({
      companyPlans,
      bankName: selectedBank || statementBank.bankName || "",
      currency,
      accountType: "VADESIZ",
      excludeCodes: [statementCode],
    });
    if (fromPlan.ok) {
      vadesiz = {
        ok: true,
        ambiguous: false,
        code: fromPlan.code,
        bank: fromPlan.bank,
        reason: "plan_unique_vadesiz",
      };
    }
  }

  const faizResolved = findUniquePlanAccount(companyPlans, [
    "642.01.001",
    "642.01",
    "642",
  ]);
  const faizCode =
    faizResolved.ok
      ? faizResolved.code
      : compactCode(bundle.faiz?.counterAccountCode || "") ||
        (faizResolved.ambiguous ? "" : "642.01.001");

  const stopajResolved = findUniquePlanAccount(companyPlans, [
    "193.01.001",
    "193.01",
    "193",
  ]);
  const stopajCode = stopajResolved.ok ? stopajResolved.code : "";

  const patchRow = (row, patch) => {
    const id = movementId(row);
    const idx = list.findIndex(
      (m, i) => (movementId(m) || `idx:${i}`) === (id || `idx:${list.indexOf(row)}`)
    );
    if (idx < 0) return;
    list[idx] = { ...list[idx], ...patch };
  };

  const faizRows = bundle.faizRows || (bundle.faiz ? [bundle.faiz] : []);
  const stopajRows = bundle.stopajRows || (bundle.stopaj ? [bundle.stopaj] : []);

  if (vadesiz.ok && !isVadeliToVadeliTransfer(statementBank, vadesiz.bank)) {
    const openWarn = clearTaxWarnings(bundle.open);
    openWarn.push("Vadeli mevduat açılışı (vadesiz 102)");
    patchRow(bundle.open, {
      transactionType: BANK_TRANSACTION_TYPE.VADELI_ACILIS,
      accountCode: statementCode,
      counterAccountCode: vadesiz.code,
      cariRequired: false,
      personelRequired: false,
      accountingScenario: VADELI_LIFECYCLE_SCENARIO,
      missingHesapCategory: "",
      warning: openWarn.join(" | "),
      vadeliLifecycleRole: VADELI_LIFECYCLE_ROLE.ACILIS,
      vadeliLifecycleMeta: {
        statementCode,
        counterCode: vadesiz.code,
        bundle: true,
        mode: bundle.mode || "single_period",
      },
      matchedRule: {
        source: "vadeliMevduatLifecycle",
        islem: "VADELI_ACILIS",
        anahtar: "vadeli-acilis",
        transactionType: BANK_TRANSACTION_TYPE.VADELI_ACILIS,
      },
    });

    const closeWarn = clearTaxWarnings(bundle.close);
    closeWarn.push("Vadeli mevduat kapanışı (vadesiz 102)");
    patchRow(bundle.close, {
      transactionType: BANK_TRANSACTION_TYPE.VADELI_KAPANIS,
      accountCode: statementCode,
      counterAccountCode: vadesiz.code,
      cariRequired: false,
      personelRequired: false,
      accountingScenario: VADELI_LIFECYCLE_SCENARIO,
      missingHesapCategory: "",
      warning: closeWarn.join(" | "),
      vadeliLifecycleRole: VADELI_LIFECYCLE_ROLE.KAPANIS,
      vadeliLifecycleMeta: {
        statementCode,
        counterCode: vadesiz.code,
        bundle: true,
        mode: bundle.mode || "single_period",
      },
      matchedRule: {
        source: "vadeliMevduatLifecycle",
        islem: "VADELI_KAPANIS",
        anahtar: "vadeli-kapanis",
        transactionType: BANK_TRANSACTION_TYPE.VADELI_KAPANIS,
      },
    });
  } else {
    const reason = vadesiz.ambiguous
      ? "Birden fazla vadesiz 102 adayı — otomatik seçilmedi"
      : "Vadesiz 102 karşı hesap bulunamadı";
    patchRow(bundle.open, {
      transactionType: BANK_TRANSACTION_TYPE.VADELI_ACILIS,
      accountCode: statementCode,
      counterAccountCode: "",
      cariRequired: false,
      missingHesapCategory: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
      warning: [...clearTaxWarnings(bundle.open), reason].join(" | "),
      vadeliLifecycleRole: VADELI_LIFECYCLE_ROLE.ACILIS,
    });
    patchRow(bundle.close, {
      transactionType: BANK_TRANSACTION_TYPE.VADELI_KAPANIS,
      accountCode: statementCode,
      counterAccountCode: "",
      cariRequired: false,
      missingHesapCategory: MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
      warning: [...clearTaxWarnings(bundle.close), reason].join(" | "),
      vadeliLifecycleRole: VADELI_LIFECYCLE_ROLE.KAPANIS,
    });
  }

  for (const faizRow of faizRows) {
    const faizWarn = clearTaxWarnings(faizRow);
    faizWarn.push("Sistem kuralı: Banka faiz geliri");
    patchRow(faizRow, {
      transactionType: BANK_TRANSACTION_TYPE.FAIZ_GELIRI,
      accountCode: statementCode,
      counterAccountCode: faizCode,
      cariRequired: false,
      personelRequired: false,
      accountingScenario: "FINANS",
      missingHesapCategory: faizCode
        ? ""
        : MISSING_HESAP_CATEGORY.VADELI_HESAP_ESLESMEDI,
      warning: faizWarn.join(" | "),
      vadeliLifecycleRole: VADELI_LIFECYCLE_ROLE.FAIZ,
      matchedRule: {
        source: "vadeliMevduatLifecycle",
        islem: "FAIZ_GELIRI",
        anahtar: "faiz-gelir",
        transactionType: BANK_TRANSACTION_TYPE.FAIZ_GELIRI,
      },
    });
  }

  for (const stopajRow of stopajRows) {
    const stopajWarn = clearTaxWarnings(stopajRow);
    if (stopajCode) {
      stopajWarn.push("Faiz stopajı (193 Peşin Ödenen Vergiler)");
      patchRow(stopajRow, {
        transactionType: BANK_TRANSACTION_TYPE.FAIZ_STOPAJI,
        accountCode: statementCode,
        counterAccountCode: stopajCode,
        cariRequired: false,
        personelRequired: false,
        accountingScenario: "FINANS",
        missingHesapCategory: "",
        warning: stopajWarn.join(" | "),
        vadeliLifecycleRole: VADELI_LIFECYCLE_ROLE.STOPAJ,
        faizStopajiMeta: {
          ...(stopajRow.faizStopajiMeta || {}),
          lifecycleConfirmed: true,
          rate: bundle.rate,
          autoFilled193: true,
        },
        matchedRule: {
          source: "vadeliMevduatLifecycle",
          islem: "FAIZ_STOPAJI",
          anahtar: "faiz-stopaj",
          transactionType: BANK_TRANSACTION_TYPE.FAIZ_STOPAJI,
        },
      });
    } else {
      stopajWarn.push(
        stopajResolved.ambiguous
          ? "Birden fazla 193 adayı — stopaj hesabı seçilmeli"
          : "193 peşin vergi hesabı bulunamadı — seçim gerekli"
      );
      patchRow(stopajRow, {
        transactionType: BANK_TRANSACTION_TYPE.FAIZ_STOPAJI,
        accountCode: statementCode,
        counterAccountCode: "",
        cariRequired: false,
        personelRequired: false,
        accountingScenario: "FINANS",
        missingHesapCategory: MISSING_HESAP_CATEGORY.FAIZ_STOPAJI_HESAP,
        warning: stopajWarn.join(" | "),
        vadeliLifecycleRole: VADELI_LIFECYCLE_ROLE.STOPAJ,
        faizStopajiMeta: {
          ...(stopajRow.faizStopajiMeta || {}),
          lifecycleConfirmed: true,
          rate: bundle.rate,
          autoFilled193: false,
          stopajAmbiguous: Boolean(stopajResolved.ambiguous),
        },
        matchedRule: {
          source: "vadeliMevduatLifecycle",
          islem: "FAIZ_STOPAJI",
          anahtar: "faiz-stopaj",
          transactionType: BANK_TRANSACTION_TYPE.FAIZ_STOPAJI,
        },
      });
    }
  }

  const memoryRecords = buildVadeliLifecycleMemoryRecords({
    companyId,
    bankName: selectedBank || statementBank.bankName || "",
    currency,
    statementAccountType: "VADELI",
    statementCode,
    vadesizCode: vadesiz.ok ? vadesiz.code : "",
    faizCode,
    stopajCode,
  });

  return finish({
    movements: list,
    applied: true,
    bundle: {
      openId: movementId(bundle.open),
      faizId: movementId(bundle.faiz),
      stopajId: movementId(bundle.stopaj),
      closeId: movementId(bundle.close),
      faizIds: faizRows.map(movementId),
      stopajIds: stopajRows.map(movementId),
      mode: bundle.mode || "single_period",
      principal: bundle.principal,
      faizAmount: bundle.faizAmount,
      stopajAmount: bundle.stopajAmount,
      closing: bundle.closing,
      expected: bundle.expected,
      statementCode,
      vadesizCode: vadesiz.ok ? vadesiz.code : "",
      vadesizOk: vadesiz.ok,
      vadesizAmbiguous: Boolean(vadesiz.ambiguous),
      faizCode,
      stopajCode,
    },
    memoryRecords,
    unresolvedReason: vadesiz.ok ? "" : vadesiz.reason || "vadesiz_unresolved",
  });
}
