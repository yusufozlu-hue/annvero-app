/**
 * Firma kimlik alanları (VKN / MERSIS) — mükerrer unvan vs gerçek mükerrer ayrımı.
 * Drive ID / token içermez.
 */

export function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

/** 10 haneli vergi kimlik no (VKN). TCKN (11) burada zorunlu engel değil. */
export function extractCompanyVkn(companyOrData) {
  const data =
    companyOrData?.data && typeof companyOrData.data === "object"
      ? companyOrData.data
      : companyOrData && typeof companyOrData === "object"
        ? companyOrData
        : {};
  return digitsOnly(
    data.taxNumber || data.vkn || data.vergiNo || companyOrData?.taxNumber || ""
  );
}

export function extractCompanyMersis(companyOrData) {
  const data =
    companyOrData?.data && typeof companyOrData.data === "object"
      ? companyOrData.data
      : companyOrData && typeof companyOrData === "object"
        ? companyOrData
        : {};
  return digitsOnly(
    data.mersis || data.mersisNo || companyOrData?.mersis || companyOrData?.mersisNo || ""
  );
}

export function isValidVkn(vkn) {
  const d = digitsOnly(vkn);
  return d.length === 10;
}

export function isValidMersis(mersis) {
  const d = digitsOnly(mersis);
  return d.length >= 10;
}

export function normalizeCompanyTitleKey(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr");
}

export function companyTitleOf(company) {
  return String(
    company?.company_name ||
      company?.companyName ||
      company?.data?.companyName ||
      ""
  ).trim();
}

/**
 * İki kayıt farklı geçerli hukuki kimlik taşıyor mu?
 * Aynı unvan + farklı VKN/MERSIS → ayrı firmalar (case A).
 */
export function areClearlyDistinctLegalEntities(a, b) {
  const va = extractCompanyVkn(a);
  const vb = extractCompanyVkn(b);
  const ma = extractCompanyMersis(a);
  const mb = extractCompanyMersis(b);

  if (isValidVkn(va) && isValidVkn(vb) && va !== vb) return true;
  if (isValidMersis(ma) && isValidMersis(mb) && ma !== mb) return true;
  return false;
}

/**
 * Aynı geçerli VKN (veya her ikisinde MERSIS aynı) → gerçek mükerrer adayı.
 */
export function shareSameStrongIdentity(a, b) {
  const va = extractCompanyVkn(a);
  const vb = extractCompanyVkn(b);
  const ma = extractCompanyMersis(a);
  const mb = extractCompanyMersis(b);

  if (isValidVkn(va) && isValidVkn(vb) && va === vb) return true;
  if (isValidMersis(ma) && isValidMersis(mb) && ma === mb) return true;
  return false;
}

/**
 * Aynı normalize unvan grubunda, kimlikle ayrılamayan company_id’ler.
 * Farklı geçerli VKN/MERSIS’li eşler DUPLICATE_NAME_SKIPPED’e girmez.
 */
export function buildAmbiguousSameNameCompanyIdSet(companies = []) {
  const byName = new Map();
  for (const company of companies) {
    const id = String(company?.id || "").trim();
    if (!id) continue;
    const key = normalizeCompanyTitleKey(companyTitleOf(company));
    if (!key) continue;
    const list = byName.get(key) || [];
    list.push(company);
    byName.set(key, list);
  }

  const ambiguous = new Set();
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i];
      const idA = String(a.id);
      const others = list.filter((_, j) => j !== i);
      const allDistinct = others.every((b) =>
        areClearlyDistinctLegalEntities(a, b)
      );
      if (!allDistinct) ambiguous.add(idA);
    }
  }
  return ambiguous;
}

/** @deprecated alias — provision katmanı identity-aware set kullanır */
export function buildDuplicateNameCompanyIdSet(companies = []) {
  return buildAmbiguousSameNameCompanyIdSet(companies);
}

/**
 * Liste / Drive görünen ad. Aynı unvanlı farklı VKN’ler için son 4 hane.
 */
export function formatCompanyDisplayName(company, peers = []) {
  const name = companyTitleOf(company) || "ANNVERO Firma";
  const vkn = extractCompanyVkn(company);
  if (!isValidVkn(vkn)) return name;

  const key = normalizeCompanyTitleKey(name);
  const sameNamePeers = (peers || []).filter((p) => {
    const pid = String(p?.id || "");
    if (!pid || pid === String(company?.id || "")) return false;
    const active = p?.data?.isActive !== false && p?.isActive !== false;
    if (!active) return false;
    return normalizeCompanyTitleKey(companyTitleOf(p)) === key;
  });

  if (sameNamePeers.length === 0) return name;
  return `${name} — VKN son 4 hane ${vkn.slice(-4)}`;
}

export function findActiveCompanyWithSameVkn(companies, vkn, excludeId = "") {
  const target = digitsOnly(vkn);
  if (!isValidVkn(target)) return null;
  for (const c of companies || []) {
    const id = String(c?.id || "");
    if (!id || id === String(excludeId || "")) continue;
    const active = c?.data?.isActive !== false && c?.isActive !== false;
    if (!active) continue;
    if (extractCompanyVkn(c) === target) return c;
  }
  return null;
}

export function isUnderMukerrerInceleme(company, peers = []) {
  const data =
    company?.data && typeof company.data === "object" ? company.data : company;
  if (data?.duplicate_of || data?.duplicateOf) return true;
  const set = buildAmbiguousSameNameCompanyIdSet(peers.length ? peers : [company]);
  return set.has(String(company?.id || ""));
}
