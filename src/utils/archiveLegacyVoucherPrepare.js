/**
 * Legacy archive → Fiş Kontrol on-demand prepare.
 * Page-open must NOT auto-run accounting. User click runs accounting+Luca once,
 * then IndexedDB handoff + navigation. No PDF / Drive / source / job / snapshot persist.
 */

export const LEGACY_ARCHIVE_NEEDS_PREPARE = "LEGACY_ARCHIVE_NEEDS_PREPARE";
export const LEGACY_ARCHIVE_PREPARE_INFO =
  "Arşiv hareketleri hazır. Fiş Kontrol için muhasebe satırları tek tıkla hazırlanacak.";
export const LEGACY_ARCHIVE_PREPARE_BUTTON = "Fişleri Hazırla ve Kontrol Et";
export const LEGACY_ARCHIVE_PREPARING = "Fişler hazırlanıyor…";
export const LEGACY_ARCHIVE_PREPARE_FAILED =
  "Fişler hazırlanamadı. Kart korundu; tekrar deneyin. Satır uydurulmadı.";

function text(value) {
  return value == null ? "" : String(value).trim();
}

/**
 * UI action for archived hydrate result card.
 * - direct_handoff: modern snapshot with real luca rows
 * - prepare_and_control: legacy movements without legs — primary CTA
 * - blocked: no usable path
 */
export function resolveArchiveFisKontrolAction({
  archivedHydrateResult = false,
  movementCount = 0,
  lucaRowCount = 0,
  lucaReady = false,
  hasAccountingLegs = false,
  archiveHandoffCode = "",
  preparing = false,
} = {}) {
  const movements = Math.max(0, Number(movementCount) || 0);
  const rows = Math.max(0, Number(lucaRowCount) || 0);
  const code = text(archiveHandoffCode);

  if (!archivedHydrateResult) {
    return {
      mode: "standard",
      showPrepareButton: false,
      showDirectHandoff: false,
      infoMessage: "",
      buttonLabel: "",
    };
  }

  if (preparing) {
    return {
      mode: "preparing",
      showPrepareButton: true,
      showDirectHandoff: false,
      infoMessage: LEGACY_ARCHIVE_PREPARING,
      buttonLabel: LEGACY_ARCHIVE_PREPARING,
      disabled: true,
      busy: true,
    };
  }

  if (lucaReady && rows > 0 && hasAccountingLegs) {
    return {
      mode: "direct_handoff",
      showPrepareButton: false,
      showDirectHandoff: true,
      infoMessage: "",
      buttonLabel: "Fiş Kontrol’e Git",
    };
  }

  if (
    movements > 0 &&
    (!hasAccountingLegs ||
      code === LEGACY_ARCHIVE_NEEDS_PREPARE ||
      code === "ACCOUNTING_LEGS_MISSING" ||
      code === "LUCA_MATERIALIZE_FAILED" ||
      code === "LEGACY_ARCHIVE_PREPARE_FAILED")
  ) {
    return {
      mode: "prepare_and_control",
      showPrepareButton: true,
      showDirectHandoff: false,
      infoMessage:
        code === "LEGACY_ARCHIVE_PREPARE_FAILED" ||
        code === "LUCA_MATERIALIZE_FAILED"
          ? LEGACY_ARCHIVE_PREPARE_FAILED
          : LEGACY_ARCHIVE_PREPARE_INFO,
      buttonLabel: LEGACY_ARCHIVE_PREPARE_BUTTON,
      disabled: false,
      busy: false,
    };
  }

  return {
    mode: "blocked",
    showPrepareButton: false,
    showDirectHandoff: false,
    infoMessage: text(archiveHandoffCode)
      ? LEGACY_ARCHIVE_PREPARE_FAILED
      : "Fiş Kontrol için arşiv sonucu kullanılamıyor.",
    buttonLabel: "",
  };
}

/**
 * Pure orchestration for tests — inject accounting/Luca/fis/save/nav deps.
 * Counts invocations; never calls PDF/OCR/Drive/persist APIs.
 */
export async function prepareLegacyArchiveVouchersForFisKontrol({
  movements = [],
  pipelineOptions = {},
  companyId = "",
  runId = "",
  authUserId = "",
  sourceId = "",
  contentFingerprint = "",
  runAccounting = null,
  buildLucaRows = null,
  runFisKontrol = null,
  saveDataset = null,
  buildHref = null,
  navigate = null,
} = {}) {
  const counts = {
    accountingInvocations: 0,
    lucaInvocations: 0,
    fisKontrolInvocations: 0,
    datasetSaves: 0,
    navigations: 0,
    pdfParse: 0,
    ocr: 0,
    sourcePersist: 0,
    jobPersist: 0,
    snapshotPersist: 0,
    drivePersist: 0,
  };

  if (!Array.isArray(movements) || movements.length === 0) {
    return {
      ok: false,
      code: "NO_MOVEMENTS",
      message: LEGACY_ARCHIVE_PREPARE_FAILED,
      counts,
      lucaRows: [],
      movements: [],
    };
  }
  if (typeof runAccounting !== "function" || typeof buildLucaRows !== "function") {
    return {
      ok: false,
      code: "MISSING_ENTRYPOINTS",
      message: LEGACY_ARCHIVE_PREPARE_FAILED,
      counts,
      lucaRows: [],
      movements,
    };
  }

  counts.accountingInvocations += 1;
  const analyzed = await runAccounting({
    ...pipelineOptions,
    movementRows: movements,
  });
  const nextMovements = Array.isArray(analyzed?.movementRows)
    ? analyzed.movementRows
    : [];
  if (!nextMovements.length) {
    return {
      ok: false,
      code: "ACCOUNTING_EMPTY",
      message: LEGACY_ARCHIVE_PREPARE_FAILED,
      counts,
      lucaRows: [],
      movements: nextMovements,
    };
  }

  counts.lucaInvocations += 1;
  const lucaResult = await buildLucaRows(nextMovements, pipelineOptions);
  const lucaRows = Array.isArray(lucaResult?.standardLucaRows)
    ? lucaResult.standardLucaRows
    : Array.isArray(lucaResult)
      ? lucaResult
      : [];
  const expected = nextMovements.length * 2;
  if (!lucaRows.length || (expected > 0 && lucaRows.length !== expected)) {
    return {
      ok: false,
      code: "LUCA_ROW_COUNT_MISMATCH",
      message: LEGACY_ARCHIVE_PREPARE_FAILED,
      counts,
      lucaRows: [],
      movements: nextMovements,
    };
  }

  if (typeof runFisKontrol === "function") {
    counts.fisKontrolInvocations += 1;
    const fis = runFisKontrol(lucaRows, { firmaId: companyId });
    const critical =
      Number(fis?.critical ?? fis?.errors ?? fis?.summary?.hata ?? 0) || 0;
    if (critical > 0) {
      return {
        ok: false,
        code: "FIS_KONTROL_FAILED",
        message: LEGACY_ARCHIVE_PREPARE_FAILED,
        counts,
        lucaRows: [],
        movements: nextMovements,
        fisKontrol: fis,
      };
    }
  }

  if (typeof saveDataset === "function") {
    counts.datasetSaves += 1;
    const saved = await saveDataset({
      companyId,
      runId,
      authUserId,
      sourceId,
      contentFingerprint,
      rows: lucaRows,
      movementCount: nextMovements.length,
    });
    if (!saved?.ok) {
      return {
        ok: false,
        code: "DATASET_SAVE_FAILED",
        message: LEGACY_ARCHIVE_PREPARE_FAILED,
        counts,
        lucaRows,
        movements: nextMovements,
      };
    }
    const href =
      typeof buildHref === "function"
        ? buildHref({
            companyId,
            runId: saved.runId || runId,
            source: "bank",
          })
        : "";
    if (typeof navigate === "function" && href) {
      counts.navigations += 1;
      navigate(href);
    }
    return {
      ok: true,
      code: "PREPARE_OK",
      message: "",
      counts,
      lucaRows,
      movements: nextMovements,
      href,
      runId: saved.runId || runId,
    };
  }

  return {
    ok: true,
    code: "PREPARE_OK",
    message: "",
    counts,
    lucaRows,
    movements: nextMovements,
    href: "",
  };
}
