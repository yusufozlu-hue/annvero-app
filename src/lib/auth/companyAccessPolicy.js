/**
 * Runtime firma yetkisi politikası (saf, sunucusuz).
 * Tek yetki kaynağı: annvero_company_members (aktif, user_id = auth uid).
 * Legacy profile.company_ids / user_metadata / app_metadata yetki VERMEZ.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAuthUserUuid(value = "") {
  return UUID_RE.test(String(value || "").trim());
}

export function normalizeCompanyIds(companyIds) {
  const list = Array.isArray(companyIds) ? companyIds : [];
  return Array.from(
    new Set(
      list
        .map((value) => String(value || "").trim())
        .filter((value) => Boolean(value) && value !== "null" && value !== "undefined")
    )
  );
}

/**
 * Membership satırlarından company id listesi.
 * expectedUserId verilirse başka user_id satırları atılır.
 */
export function selectActiveMembershipCompanyIds(rows = [], expectedUserId = "") {
  const expected = String(expectedUserId || "").trim();
  const ids = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.is_active === false) continue;
    const uid = String(row.user_id || "").trim();
    if (expected && uid && uid !== expected) continue;
    const cid = String(row.company_id || "").trim();
    if (cid) ids.push(cid);
  }
  return normalizeCompanyIds(ids);
}

/**
 * Runtime companyIds çözümlemesi — davranış testi için saf.
 *
 * @returns {{
 *   ok: boolean,
 *   companyIds: string[],
 *   companyIdsSource: string,
 *   deniedReason: string|null
 * }}
 */
export function resolveRuntimeCompanyAccess({
  authUserId = "",
  profileAuthUserId = "",
  membershipRows = null,
  membershipError = null,
  legacyProfileCompanyIds = [],
  userMetadataCompanyIds = [],
  appMetadataCompanyIds = [],
  clientProvidedCompanyIds = [],
  isElevatedTrusted = false,
} = {}) {
  void legacyProfileCompanyIds;
  void userMetadataCompanyIds;
  void appMetadataCompanyIds;
  void clientProvidedCompanyIds;

  if (isElevatedTrusted) {
    return {
      ok: true,
      companyIds: [],
      companyIdsSource: "elevated_trusted",
      deniedReason: null,
    };
  }

  const authId = String(authUserId || "").trim();
  if (!isAuthUserUuid(authId)) {
    return {
      ok: false,
      companyIds: [],
      companyIdsSource: "none",
      deniedReason: "missing_auth_user_id",
    };
  }

  const profileAuth = String(profileAuthUserId || "").trim();
  if (!isAuthUserUuid(profileAuth)) {
    return {
      ok: false,
      companyIds: [],
      companyIdsSource: "none",
      deniedReason: "profile_unbound",
    };
  }

  if (profileAuth !== authId) {
    return {
      ok: false,
      companyIds: [],
      companyIdsSource: "none",
      deniedReason: "auth_profile_mismatch",
    };
  }

  if (membershipError) {
    return {
      ok: false,
      companyIds: [],
      companyIdsSource: "none",
      deniedReason: "membership_query_error",
    };
  }

  if (membershipRows === null || membershipRows === undefined) {
    return {
      ok: false,
      companyIds: [],
      companyIdsSource: "none",
      deniedReason: "membership_not_loaded",
    };
  }

  return {
    ok: true,
    companyIds: selectActiveMembershipCompanyIds(membershipRows, authId),
    companyIdsSource: "membership",
    deniedReason: null,
  };
}

/**
 * Unscoped liste: elevated → null (tümü); aksi halde membership id'leri.
 * Boş dizi = sıfır firma (unscoped query yok).
 */
export function resolveAccessibleCompanyScope({
  isElevatedTrusted = false,
  companyIds = [],
  companyIdsSource = "none",
} = {}) {
  if (isElevatedTrusted) return null;
  if (companyIdsSource !== "membership") return [];
  return normalizeCompanyIds(companyIds);
}
