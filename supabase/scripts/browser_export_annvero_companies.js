(function exportAnnveroCompaniesFromBrowserStorage() {
  const COMPANY_STORAGE_KEYS = [
    "annvero_companies_v24",
    "annvero_companies_v23",
    "annvero_companies_v22",
    "annvero_companies_v21",
    "annvero_companies_v2",
  ];

  const OFIS_TAKIP_STORAGE_KEY = "annvero-ofis-takip-v1";

  function readJson(storage, key) {
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function getCompanyName(company) {
    return String(company?.companyName || company?.name || company?.title || company?.unvan || "").trim();
  }

  function normalizeCompanyRecord(company, source) {
    if (!company || typeof company !== "object") return null;

    const id = String(company.id || company.companyId || company.firmaId || company.mukellefId || "").trim();
    const companyName = getCompanyName(company);

    if (!id || !companyName) return null;

    const data = { ...company, id, companyName };

    return {
      id,
      company_name: companyName,
      data,
      updated_at: new Date().toISOString(),
      _export_source: source,
    };
  }

  function readCompaniesFromArray(value, source) {
    if (!Array.isArray(value)) return [];

    return value
      .map((row) => normalizeCompanyRecord(row, source))
      .filter(Boolean);
  }

  function collectFromKnownKeys(storageType, storage) {
    const found = [];

    for (const key of COMPANY_STORAGE_KEYS) {
      const rows = readCompaniesFromArray(readJson(storage, key), `${storageType}:${key}`);
      if (rows.length) {
        found.push({ key, storageType, rows });
      }
    }

    const ofisState = readJson(storage, OFIS_TAKIP_STORAGE_KEY);
    if (ofisState && Array.isArray(ofisState.mukellefler)) {
      const legacyRows = ofisState.mukellefler
        .map((row, index) =>
          normalizeCompanyRecord(
            {
              id: row.id || row.companyId || row.mukellefId || `legacy-ofis-${index + 1}`,
              companyName: row.unvan || row.companyName || row.name || row.title,
              ...row,
            },
            `${storageType}:${OFIS_TAKIP_STORAGE_KEY}:mukellefler`
          )
        )
        .filter(Boolean);

      if (legacyRows.length) {
        found.push({
          key: `${OFIS_TAKIP_STORAGE_KEY}:mukellefler`,
          storageType,
          rows: legacyRows,
        });
      }
    }

    return found;
  }

  function collectFromAnnveroKeyScan(storageType, storage) {
    const found = [];

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !/annvero/i.test(key)) continue;
      if (COMPANY_STORAGE_KEYS.includes(key) || key === OFIS_TAKIP_STORAGE_KEY) continue;

      const parsed = readJson(storage, key);
      if (Array.isArray(parsed)) {
        const rows = readCompaniesFromArray(parsed, `${storageType}:scan:${key}`);
        if (rows.length) found.push({ key, storageType, rows });
        continue;
      }

      if (parsed && typeof parsed === "object" && Array.isArray(parsed.companies)) {
        const rows = readCompaniesFromArray(parsed.companies, `${storageType}:scan:${key}:companies`);
        if (rows.length) found.push({ key: `${key}:companies`, storageType, rows });
      }
    }

    return found;
  }

  function mergeByCompanyId(groups) {
    const map = new Map();

    for (const group of groups) {
      for (const row of group.rows) {
        const existing = map.get(row.id);
        if (!existing) {
          map.set(row.id, row);
          continue;
        }

        map.set(row.id, {
          ...existing,
          company_name: existing.company_name || row.company_name,
          data: { ...row.data, ...existing.data, companyName: existing.company_name || row.company_name },
          _export_source: `${existing._export_source} | ${row._export_source}`,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.company_name.localeCompare(b.company_name, "tr", { sensitivity: "base" })
    );
  }

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const localGroups = [
    ...collectFromKnownKeys("localStorage", localStorage),
    ...collectFromAnnveroKeyScan("localStorage", localStorage),
  ];

  const sessionGroups = [
    ...collectFromKnownKeys("sessionStorage", sessionStorage),
    ...collectFromAnnveroKeyScan("sessionStorage", sessionStorage),
  ];

  const mergedCompanies = mergeByCompanyId([...localGroups, ...sessionGroups]);

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    origin: window.location.origin,
    summary: {
      localStorageSources: localGroups.map((group) => ({
        key: group.key,
        count: group.rows.length,
      })),
      sessionStorageSources: sessionGroups.map((group) => ({
        key: group.key,
        count: group.rows.length,
      })),
      totalCompanies: mergedCompanies.length,
    },
    companies: mergedCompanies.map(({ _export_source, ...row }) => row),
    migrate_api_body: {
      companies: mergedCompanies.map(({ _export_source, ...row }) => row),
    },
    rawSources: [...localGroups, ...sessionGroups].map((group) => ({
      storageType: group.storageType,
      key: group.key,
      count: group.rows.length,
    })),
  };

  if (!mergedCompanies.length) {
    console.warn("ANNVERO firma kaydı bulunamadı.", {
      checkedCompanyKeys: COMPANY_STORAGE_KEYS,
      checkedOfisKey: OFIS_TAKIP_STORAGE_KEY,
      scannedPattern: "localStorage/sessionStorage keys matching /annvero/i",
    });
    return exportPayload;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `annvero-companies-export-${stamp}.json`;

  downloadJson(filename, exportPayload);

  console.info("ANNVERO firma export tamamlandı.");
  console.info("İndirilen dosya:", filename);
  console.info("Toplam firma:", mergedCompanies.length);
  console.info("Kaynaklar:", exportPayload.rawSources);
  console.info("SQL/API için doğrudan dizi:", exportPayload.companies);
  console.info("Migrate API body:", exportPayload.migrate_api_body);

  return exportPayload;
})();
