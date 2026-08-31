/**
 * Browser-safe stub for node:crypto inside the classic analyze worker bundle.
 * Analyze path does not need real fingerprints; correction V2 stays on main thread/UI.
 */
export function createHash(_algo = "sha256") {
  let material = "";
  return {
    update(data = "", _encoding) {
      material += String(data ?? "");
      return this;
    },
    digest(_encoding) {
      // Deterministic non-cryptographic stand-in — not used for security decisions.
      let hash = 0x811c9dc5;
      for (let i = 0; i < material.length; i += 1) {
        hash ^= material.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, "0").repeat(8).slice(0, 64);
    },
  };
}

export default { createHash };
