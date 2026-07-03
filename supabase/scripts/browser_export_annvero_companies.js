/**
 * Eski Supabase erişimi olmadan firma verisi kurtarma script'i.
 *
 * Kullanım:
 * 1) Canlı sitede veya localhost'ta Firma Yönetimi kullandığınız tarayıcıda F12 -> Console
 * 2) Bu dosyanın tamamını yapıştırıp Enter
 * 3) Çıkan companies_export_json değerini kopyalayın
 * 4) supabase/scripts/import_companies_from_local_json.sql içinde '[]'::jsonb yerine yapıştırın
 *    veya POST /api/companies/migrate endpoint'ine { companies: [...] } olarak gönderin
 */
(function exportAnnveroCompaniesFromLocalStorage() {
  const STORAGE_KEYS = [
    "annvero_companies_v24",
    "annvero_companies_v23",
    "annvero_companies_v22",
    "annvero_companies_v21",
    "annvero_companies_v2",
  ];

  function readCompaniesFromKey(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  let sourceKey = null;
  let companies = [];

  for (const key of STORAGE_KEYS) {
    const rows = readCompaniesFromKey(key);
    if (rows.length > 0) {
      sourceKey = key;
      companies = rows;
      break;
    }
  }

  if (!companies.length) {
    console.warn("localStorage'da firma kaydı bulunamadı.", { checkedKeys: STORAGE_KEYS });
    return { found: false, checkedKeys: STORAGE_KEYS };
  }

  const payload = companies
    .filter((company) => company?.id && (company.companyName || company.name || company.title))
    .map((company) => {
      const companyName = String(company.companyName || company.name || company.title || "").trim();
      const data = { ...company, companyName };

      return {
        id: String(company.id),
        company_name: companyName,
        data,
        updated_at: new Date().toISOString(),
      };
    });

  console.info("Kaynak localStorage key:", sourceKey);
  console.info("Dışa aktarılan firma sayısı:", payload.length);
  console.info("Migrate API body:", { companies: payload });
  console.info("SQL import JSON (companies_export_json):");
  console.log(JSON.stringify(payload));

  return {
    found: true,
    sourceKey,
    count: payload.length,
    companies_export_json: payload,
    migrate_api_body: { companies: payload },
  };
})();
