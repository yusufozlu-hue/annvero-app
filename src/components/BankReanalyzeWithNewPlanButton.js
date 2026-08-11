"use client";

import { createElement, useState } from "react";

/**
 * Buton onClick gövdesi — interaction testleri doğrudan burayı çağırır.
 * İlk senkron adım: local busy. Parent async; çift tıklama local/parent busy ile kesilir.
 */
export function runReanalyzeButtonClick({
  reanalyzeBusy,
  isExporting,
  setLocalReanalyzeBusy,
  onReanalyzeWithNewPlan,
  event,
}) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (reanalyzeBusy || isExporting) return { started: false };
  setLocalReanalyzeBusy(true);
  let settled = false;
  const clearLocal = () => {
    if (settled) return;
    settled = true;
    setLocalReanalyzeBusy(false);
  };
  try {
    const maybePromise = onReanalyzeWithNewPlan?.();
    if (maybePromise != null && typeof maybePromise.then === "function") {
      maybePromise.then(clearLocal, clearLocal);
      return { started: true, promise: maybePromise };
    }
    clearLocal();
    return { started: true, promise: null };
  } catch (err) {
    clearLocal();
    throw err;
  }
}

/**
 * Sonuç kartındaki “Yeni hesap planıyla yeniden analiz et” butonu.
 */
export function BankReanalyzeWithNewPlanButton({
  onReanalyzeWithNewPlan,
  isReanalyzing = false,
  isExporting = false,
}) {
  const [localReanalyzeBusy, setLocalReanalyzeBusy] = useState(false);
  const reanalyzeBusy = Boolean(isReanalyzing || localReanalyzeBusy);

  return createElement(
    "button",
    {
      type: "button",
      onClick: (event) =>
        runReanalyzeButtonClick({
          reanalyzeBusy,
          isExporting,
          setLocalReanalyzeBusy,
          onReanalyzeWithNewPlan,
          event,
        }),
      disabled: reanalyzeBusy || isExporting,
      "aria-busy": reanalyzeBusy ? "true" : "false",
      className:
        "inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50",
      "data-testid": "bank-reanalyze-with-new-plan",
    },
    reanalyzeBusy
      ? createElement(
          "span",
          { className: "inline-flex items-center gap-2" },
          createElement("span", {
            className:
              "inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white",
            "aria-hidden": "true",
          }),
          "Yeniden analiz ediliyor…"
        )
      : "Yeni hesap planıyla yeniden analiz et"
  );
}
