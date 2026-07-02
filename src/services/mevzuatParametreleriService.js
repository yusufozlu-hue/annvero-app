import {
  mevzuatParametreleriRepository,
  SEED_FALLBACK_NOTICE,
} from "@/src/repositories/mevzuatParametreleriRepository";
import { getSeedParametersByModule } from "@/src/config/mevzuatParameterSeedData";

export { SEED_FALLBACK_NOTICE };

export const mevzuatParametreleriService = {
  async listModuleParameters(supabase, moduleKey) {
    try {
      const result = await mevzuatParametreleriRepository.listByModule(
        supabase,
        moduleKey
      );

      if (result.rows?.length) {
        return result;
      }

      return {
        rows: getSeedParametersByModule(moduleKey).map((row) => ({
          ...row,
          source: "config",
        })),
        meta: {
          source: "seed",
          notice: SEED_FALLBACK_NOTICE,
          supabaseConnected: Boolean(supabase),
        },
      };
    } catch (error) {
      console.error("[mevzuatParametreleriService.listModuleParameters]", error);

      return {
        rows: getSeedParametersByModule(moduleKey).map((row) => ({
          ...row,
          source: "config",
        })),
        meta: {
          source: "seed",
          notice: SEED_FALLBACK_NOTICE,
          supabaseConnected: Boolean(supabase),
        },
      };
    }
  },

  async saveParameter(supabase, payload) {
    if (!payload?.id) {
      throw new Error("Parametre kimliği zorunludur.");
    }

    try {
      return await mevzuatParametreleriRepository.upsertParameter(supabase, payload);
    } catch (error) {
      console.error("[mevzuatParametreleriService.saveParameter]", error);
      throw error;
    }
  },
};
