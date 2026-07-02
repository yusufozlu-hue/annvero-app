import {
  getSeedParameterById,
  getSeedParametersByModule,
  MEVZUAT_PARAMETER_SEEDS,
} from "@/src/config/mevzuatParameterSeedData";

const TABLE_NAME = "mevzuat_parametreleri";

export const SEED_FALLBACK_NOTICE =
  "Varsayılan mevzuat parametreleri gösteriliyor. Kaydettiğinizde Supabase'e aktarılacaktır.";

function mapDbRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    module_key: row.module_key,
    parameter_key: row.parameter_key,
    parameter_name: row.parameter_name,
    year: Number(row.year),
    period: row.period || "Yıllık",
    value: String(row.value ?? ""),
    description: row.description || "",
    valid_from: row.valid_from || null,
    valid_to: row.valid_to || null,
    is_active: row.is_active !== false,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    source: "supabase",
  };
}

function buildSeedRows(moduleKey) {
  return getSeedParametersByModule(moduleKey).map((row) => ({
    ...row,
    source: "config",
  }));
}

function buildSeedFallbackResult(moduleKey, reason = SEED_FALLBACK_NOTICE) {
  return {
    rows: buildSeedRows(moduleKey),
    meta: {
      source: "seed",
      notice: reason,
      supabaseConnected: false,
    },
  };
}

function isRecoverableSupabaseReadError(error) {
  if (!error) return false;

  const code = String(error.code || "");
  const message = String(error.message || "").toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "PGRST116" ||
    code === "42501" ||
    code === "PGRST301" ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("permission denied") ||
    message.includes("not found") ||
    message.includes("relation")
  );
}

function mergeSeedWithDbRows(moduleKey, dbRows) {
  const seeds = getSeedParametersByModule(moduleKey);
  const dbMap = new Map((dbRows || []).map((row) => [row.parameter_key, row]));

  return seeds.map((seed) => {
    const dbRow = dbMap.get(seed.parameter_key);
    return dbRow ? mapDbRow(dbRow) : { ...seed, source: "config" };
  });
}

/**
 * Repository: Supabase okur; bağlantı/hata/boş tablo durumunda config seed fallback.
 */
export const mevzuatParametreleriRepository = {
  async listByModule(supabase, moduleKey) {
    const seeds = buildSeedRows(moduleKey);

    if (!moduleKey) {
      return {
        rows: [],
        meta: { source: "empty", notice: null, supabaseConnected: Boolean(supabase) },
      };
    }

    if (!seeds.length) {
      return {
        rows: [],
        meta: {
          source: "empty",
          notice: "Bu modül için tanımlı seed parametre bulunamadı.",
          supabaseConnected: Boolean(supabase),
        },
      };
    }

    if (!supabase) {
      return buildSeedFallbackResult(moduleKey);
    }

    try {
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .select("*")
        .eq("module_key", moduleKey)
        .order("year", { ascending: false })
        .order("parameter_name", { ascending: true });

      if (error) {
        if (isRecoverableSupabaseReadError(error)) {
          return buildSeedFallbackResult(moduleKey);
        }
        throw error;
      }

      if (!data?.length) {
        return buildSeedFallbackResult(moduleKey);
      }

      return {
        rows: mergeSeedWithDbRows(moduleKey, data),
        meta: {
          source: "merged",
          notice: null,
          supabaseConnected: true,
        },
      };
    } catch (error) {
      if (isRecoverableSupabaseReadError(error)) {
        return buildSeedFallbackResult(moduleKey);
      }

      console.error("[mevzuatParametreleriRepository.listByModule]", error);
      return buildSeedFallbackResult(moduleKey);
    }
  },

  async upsertParameter(supabase, payload) {
    const seed = getSeedParameterById(payload.id);
    const record = {
      id: payload.id,
      module_key: payload.module_key || seed?.module_key,
      parameter_key: payload.parameter_key || seed?.parameter_key,
      parameter_name: payload.parameter_name,
      year: Number(payload.year),
      period: payload.period,
      value: String(payload.value ?? ""),
      description: payload.description || "",
      valid_from: payload.valid_from || null,
      valid_to: payload.valid_to || null,
      is_active: payload.is_active !== false,
      updated_at: new Date().toISOString(),
    };

    if (!supabase) {
      return {
        row: { ...seed, ...record, id: payload.id, source: "config-local" },
        meta: { savedToSupabase: false, notice: SEED_FALLBACK_NOTICE },
      };
    }

    try {
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .upsert(record, { onConflict: "id" })
        .select("*")
        .maybeSingle();

      if (error) {
        if (isRecoverableSupabaseReadError(error)) {
          const err = new Error("SUPABASE_TABLE_MISSING");
          err.code = "SUPABASE_TABLE_MISSING";
          throw err;
        }
        throw error;
      }

      return {
        row: mapDbRow(data),
        meta: { savedToSupabase: true, notice: null },
      };
    } catch (error) {
      if (isRecoverableSupabaseReadError(error)) {
        const err = new Error("SUPABASE_TABLE_MISSING");
        err.code = "SUPABASE_TABLE_MISSING";
        throw err;
      }
      throw error;
    }
  },

  listAllSeeds() {
    return MEVZUAT_PARAMETER_SEEDS;
  },
};
