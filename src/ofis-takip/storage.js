import { OFIS_TAKIP_STORAGE_KEY } from "./constants";
import { createDefaultOfisTakipState } from "./defaultState";

export function loadOfisTakipState() {
  if (typeof window === "undefined") {
    return createDefaultOfisTakipState();
  }

  const saved = localStorage.getItem(OFIS_TAKIP_STORAGE_KEY);

  if (!saved) {
    return createDefaultOfisTakipState();
  }

  try {
    const parsed = JSON.parse(saved);
    const defaults = createDefaultOfisTakipState();

    return {
      ...defaults,
      version: parsed.version || defaults.version,
      settings: {
        ...defaults.settings,
        ...(parsed.settings || {}),
      },
      yapilacaklar: parsed.yapilacaklar || [],
      hatirlatmalar: parsed.hatirlatmalar || [],
      vergiTakvimi: parsed.vergiTakvimi || defaults.vergiTakvimi,
      _legacyMukellefler: parsed.mukellefler || [],
    };
  } catch {
    return createDefaultOfisTakipState();
  }
}

export function saveOfisTakipState(state) {
  if (typeof window === "undefined") {
    return;
  }

  const payload = {
    version: state.version || 1,
    settings: state.settings || {},
    yapilacaklar: state.yapilacaklar || [],
    hatirlatmalar: state.hatirlatmalar || [],
    vergiTakvimi: state.vergiTakvimi || [],
  };

  localStorage.setItem(OFIS_TAKIP_STORAGE_KEY, JSON.stringify(payload));
}
