export async function fetchGibAnnouncements() {
  return [];
}

export async function fetchSgkAnnouncements() {
  return [];
}

export async function fetchOfficialGazetteAnnouncements() {
  return [];
}

export async function fetchTurmobAnnouncements() {
  return [];
}

export async function fetchIsmmmoAnnouncements() {
  return [];
}

export async function fetchTcmbAnnouncements() {
  return [];
}

export async function fetchTradeMinistryAnnouncements() {
  return [];
}

export async function fetchKosgebAnnouncements() {
  return [];
}

export async function fetchAllMevzuatHapNotuSources() {
  const results = await Promise.allSettled([
    fetchGibAnnouncements(),
    fetchSgkAnnouncements(),
    fetchOfficialGazetteAnnouncements(),
    fetchTurmobAnnouncements(),
    fetchIsmmmoAnnouncements(),
    fetchTcmbAnnouncements(),
    fetchTradeMinistryAnnouncements(),
    fetchKosgebAnnouncements(),
  ]);

  return results.flatMap((result) =>
    result.status === "fulfilled" && Array.isArray(result.value) ? result.value : []
  );
}
