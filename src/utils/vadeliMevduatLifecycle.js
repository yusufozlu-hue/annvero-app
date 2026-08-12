/**
 * Vadeli mevduat yaşam döngüsü (açılış → faiz → stopaj → kapanış).
 *
 * Kural: Vadeli hesaplar arasında virman olmaz. Açılış/kapanış karşı hesabı
 * aynı firma + aynı bankanın VADESIZ 102 yaprak hesabı olmalıdır.
 */

import { BANK_TRANSACTION_TYPE } from "@/src/utils/bankTransactionType";
import { normalizeParserText } from "@/src/utils/textNormalize";
import { MISSING_HESAP_CATEGORY } from "@/src/utils/previewExportValidation";
import {
  matchesVadeliLifecycleAmounts,
  matchesFaizStopajRate,
} from "@/src/utils/faizStopajiClassify";

export const VADELI_LIFECYCLE_ROLE = Object.freeze({
  ACILIS: "VADELI_ACILIS",
  KAPANIS: "VADELI_KAPANIS",
  FAIZ: "FAIZ_GELIRI",
  STOPAJ: "FAIZ_STOPAJI",
});

/**
 * Lifecycle algoritma sürümü — idempotency / pipelineVersion bileşeni.
 * Kod değişince bump: eski tamamlanmış 2/2 job yeni analiz yerine kullanılmaz.
 */
export const VADELI_LIFECYCLE_ALGORITHM_VERSION = "vl/2.1.0";

export const LIFECYCLE_OPEN_RE =
  /\b(HESAP\s*ACMA|VADEL[Iİ].*ACMA|MEVDUAT\s*ACMA|ACILIS)/i;
export const LIFECYCLE_CLOSE_RE =
  /\b(HESAP\s*KAPAT|VADEL[Iİ].*KAPAT|MEVDUAT\s*KAPAT|KAPANIS)/i;

const FAIZ_DESC_RE =
  /\b(FAIZ\s*GELIR|FAIZ\s*TAHAKKUK|FAIZ\s*TAHSIL|MEVDUAT\s*FAIZ|VADE\s*FAIZ|VADEL[Iİ]\s*FAIZ)/i;

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

/**
 * Statement hesabını banka adı .find() ile değil; hesap no / IBAN / banka /
 * PB / accountType ile bağla. Birden fazla eşit aday → ambiguous.
 */
export function resolveStatementBankAccount({
  company = null,
  accountNumber = "",
  iban = "",
  bankName = "",
  currency = "TL",
  accountType = "",
  lucaHint = "",
} = {}) {
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
    return { ok: false, ambiguous: false, bank: null, code: "", reason: "no_match" };
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
  // Güçlü bağ: IBAN veya hesap no veya (banka+tür+hint)
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
 * Statement içindeki 4’lü yaşam döngüsü demetini bul.
 */
export function detectVadeliLifecycleBundle(movements = []) {
  const rows = Array.isArray(movements) ? movements : [];
  const opens = rows.filter(
    (r) => rowDirection(r) === "GIRIS" && LIFECYCLE_OPEN_RE.test(rowDesc(r))
  );
  const closes = rows.filter(
    (r) => rowDirection(r) === "CIKIS" && LIFECYCLE_CLOSE_RE.test(rowDesc(r))
  );
  const faizRows = rows.filter(
    (r) =>
      rowDirection(r) === "GIRIS" &&
      (String(r.transactionType || "") === BANK_TRANSACTION_TYPE.FAIZ_GELIRI ||
        FAIZ_DESC_RE.test(rowDesc(r)))
  );

  for (const open of opens) {
    for (const faiz of faizRows) {
      for (const close of closes) {
        const principal = absAmount(open);
        const faizAmt = absAmount(faiz);
        const closing = absAmount(close);
        // stopaj adayları: CIKIS, open/close/faiz değil
        const stopajCandidates = rows.filter((r) => {
          if (r === open || r === faiz || r === close) return false;
          if (rowDirection(r) !== "CIKIS") return false;
          const t = String(r.transactionType || "");
          if (t === BANK_TRANSACTION_TYPE.FAIZ_GELIRI) return false;
          if (LIFECYCLE_OPEN_RE.test(rowDesc(r))) return false;
          if (LIFECYCLE_CLOSE_RE.test(rowDesc(r))) return false;
          return absAmount(r) > 0;
        });

        for (const stopaj of stopajCandidates) {
          const stopajAmt = absAmount(stopaj);
          const expected =
            Math.round((principal + faizAmt - stopajAmt) * 100) / 100;
          if (Math.abs(closing - expected) > AMOUNT_TOL) continue;

          const rate = matchesFaizStopajRate(stopajAmt, faizAmt);
          const life = matchesVadeliLifecycleAmounts(rows, stopaj, faiz);
          // Tutar denklemi zaten tuttu; soft "Vergi ödemesi" de kabul
          const stopajTypeOk =
            String(stopaj.transactionType || "") ===
              BANK_TRANSACTION_TYPE.FAIZ_STOPAJI ||
            rate.ok ||
            life.ok ||
            /\b(VERGI|STOPAJ)\b/i.test(rowDesc(stopaj));

          if (!stopajTypeOk) continue;

          return {
            ok: true,
            open,
            faiz,
            stopaj,
            close,
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

  return { ok: false };
}

function findPlanAccount(companyPlans = [], prefixes = []) {
  const plans = Array.isArray(companyPlans) ? companyPlans : [];
  for (const prefix of prefixes) {
    const hit = plans.find((p) => {
      if (p?.isActive === false) return false;
      const code = compactCode(p.accountCode || p.code || "");
      return code === prefix || code.startsWith(`${prefix}.`) || code.startsWith(prefix);
    });
    if (hit) return compactCode(hit.accountCode || hit.code || "");
  }
  return "";
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
 * Mapper post-pass: yaşam döngüsünü sınıflandır ve hesapları uygula.
 */
export function applyVadeliMevduatLifecycle(movements = [], context = {}) {
  const list = Array.isArray(movements) ? movements.map((m) => ({ ...m })) : [];
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

  const bundle = detectVadeliLifecycleBundle(list);
  if (!bundle.ok) {
    return {
      movements: list,
      applied: false,
      bundle: null,
      memoryRecords: [],
      unresolvedReason: "no_lifecycle_bundle",
    };
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
    lucaHint:
      bundle.open?.accountCode ||
      context.statementLucaHint ||
      "",
  });

  // Statement bağlanamazsa mevcut accountCode üzerinden dene (mapper ön seçimi)
  let statementBank = statement.bank;
  let statementCode = statement.code;
  if (!statement.ok) {
    const fallbackCode = compactCode(bundle.open?.accountCode || "");
    const byCode = findBankByLucaCode(company, fallbackCode);
    if (byCode && getBankAccountType(byCode) === "VADELI") {
      statementBank = byCode;
      statementCode = fallbackCode;
    } else if (
      byCode &&
      !byCode.accountType &&
      isLeaf102Code(fallbackCode) &&
      hintAccount
    ) {
      // Tip eksik kart — hesap no ile aynı satırsa vadeli kabul
      const dig = digitsOnly(byCode.accountNumber || byCode.hesapNo || "");
      const hintDig = digitsOnly(hintAccount);
      if (
        dig &&
        hintDig &&
        (dig === hintDig || dig.endsWith(hintDig) || hintDig.endsWith(dig))
      ) {
        statementBank = { ...byCode, accountType: "VADELI" };
        statementCode = fallbackCode;
      }
    }
  }

  // Firma banka kartı boş/eksik: hesap planından tek kesin VADELI 102
  if (!statementCode || !statementBank) {
    const fromPlan = resolve102RoleFromAccountPlan({
      companyPlans,
      bankName: selectedBank,
      currency,
      accountType: "VADELI",
      accountNumber: hintAccount,
    });
    if (fromPlan.ok) {
      statementBank = fromPlan.bank;
      statementCode = fromPlan.code;
    }
  }

  if (!statementCode || !statementBank) {
    return {
      movements: list,
      applied: false,
      bundle,
      memoryRecords: [],
      unresolvedReason: statement.reason || "statement_unresolved",
    };
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

  const faizCode =
    findPlanAccount(companyPlans, ["642.01.001", "642.01", "642"]) ||
    compactCode(bundle.faiz?.counterAccountCode || "") ||
    "642.01.001";
  const stopajCode =
    findPlanAccount(companyPlans, ["193.01.001", "193.01", "193"]) ||
    "193.01.001";

  const patchRow = (row, patch) => {
    const id = movementId(row);
    const idx = list.findIndex(
      (m, i) => (movementId(m) || `idx:${i}`) === (id || `idx:${list.indexOf(row)}`)
    );
    if (idx < 0) return;
    list[idx] = { ...list[idx], ...patch };
  };

  // Açılış
  if (vadesiz.ok && !isVadeliToVadeliTransfer(statementBank, vadesiz.bank)) {
    const openWarn = clearTaxWarnings(bundle.open);
    openWarn.push("Vadeli mevduat açılışı (vadesiz 102)");
    patchRow(bundle.open, {
      transactionType: BANK_TRANSACTION_TYPE.VADELI_ACILIS,
      accountCode: statementCode,
      counterAccountCode: vadesiz.code,
      cariRequired: false,
      personelRequired: false,
      accountingScenario: "BANKA_ICI_VIRMAN",
      missingHesapCategory: "",
      warning: openWarn.join(" | "),
      vadeliLifecycleRole: VADELI_LIFECYCLE_ROLE.ACILIS,
      vadeliLifecycleMeta: {
        statementCode,
        counterCode: vadesiz.code,
        bundle: true,
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
      accountingScenario: "BANKA_ICI_VIRMAN",
      missingHesapCategory: "",
      warning: closeWarn.join(" | "),
      vadeliLifecycleRole: VADELI_LIFECYCLE_ROLE.KAPANIS,
      vadeliLifecycleMeta: {
        statementCode,
        counterCode: vadesiz.code,
        bundle: true,
      },
      matchedRule: {
        source: "vadeliMevduatLifecycle",
        islem: "VADELI_KAPANIS",
        anahtar: "vadeli-kapanis",
        transactionType: BANK_TRANSACTION_TYPE.VADELI_KAPANIS,
      },
    });
  } else {
    // Belirsiz / yok → incelemede bırak, yine de tipleri işaretle
    const reason = vadesiz.ambiguous
      ? "Birden fazla vadesiz 102 adayı — otomatik seçilmedi"
      : "Vadesiz 102 karşı hesap bulunamadı";
    patchRow(bundle.open, {
      transactionType: BANK_TRANSACTION_TYPE.VADELI_ACILIS,
      accountCode: statementCode,
      counterAccountCode: "",
      cariRequired: false,
      missingHesapCategory: MISSING_HESAP_CATEGORY.DIGER || "Diğer",
      warning: [...clearTaxWarnings(bundle.open), reason].join(" | "),
      vadeliLifecycleRole: VADELI_LIFECYCLE_ROLE.ACILIS,
    });
    patchRow(bundle.close, {
      transactionType: BANK_TRANSACTION_TYPE.VADELI_KAPANIS,
      accountCode: statementCode,
      counterAccountCode: "",
      cariRequired: false,
      missingHesapCategory: MISSING_HESAP_CATEGORY.DIGER || "Diğer",
      warning: [...clearTaxWarnings(bundle.close), reason].join(" | "),
      vadeliLifecycleRole: VADELI_LIFECYCLE_ROLE.KAPANIS,
    });
  }

  // Faiz — mevcut 642 davranışını koru / güçlendir
  {
    const faizWarn = clearTaxWarnings(bundle.faiz);
    faizWarn.push("Sistem kuralı: Banka faiz geliri");
    patchRow(bundle.faiz, {
      transactionType: BANK_TRANSACTION_TYPE.FAIZ_GELIRI,
      accountCode: statementCode,
      counterAccountCode: faizCode,
      cariRequired: false,
      personelRequired: false,
      accountingScenario: "FINANS",
      missingHesapCategory: "",
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

  // Stopaj — yalnız lifecycle doğrulanmışsa 193 autofill
  {
    const stopajWarn = clearTaxWarnings(bundle.stopaj);
    stopajWarn.push("Faiz stopajı (193 Peşin Ödenen Vergiler)");
    patchRow(bundle.stopaj, {
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
        ...(bundle.stopaj.faizStopajiMeta || {}),
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

  return {
    movements: list,
    applied: true,
    bundle: {
      openId: movementId(bundle.open),
      faizId: movementId(bundle.faiz),
      stopajId: movementId(bundle.stopaj),
      closeId: movementId(bundle.close),
      principal: bundle.principal,
      faizAmount: bundle.faizAmount,
      stopajAmount: bundle.stopajAmount,
      closing: bundle.closing,
      statementCode,
      vadesizCode: vadesiz.ok ? vadesiz.code : "",
      vadesizOk: vadesiz.ok,
      vadesizAmbiguous: Boolean(vadesiz.ambiguous),
      faizCode,
      stopajCode,
    },
    memoryRecords,
    unresolvedReason: vadesiz.ok ? "" : vadesiz.reason || "vadesiz_unresolved",
  };
}
