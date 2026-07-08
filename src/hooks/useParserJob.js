"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cancelActiveParseJob } from "@/src/utils/workerParserBridge";
import { logParserJobCancelled } from "@/src/utils/parserJobLogger";

const IDLE_STATE = {
  status: "idle",
  percent: 0,
  stage: "",
  detail: "",
  timeoutWarning: false,
  error: "",
};

export function useParserJob({
  timeoutWarningMs = 20_000,
  logMeta = {},
} = {}) {
  const [state, setState] = useState(IDLE_STATE);
  const timeoutWarningRef = useRef(null);

  const clearWarningTimer = useCallback(() => {
    if (timeoutWarningRef.current) {
      clearTimeout(timeoutWarningRef.current);
      timeoutWarningRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearWarningTimer();
    setState(IDLE_STATE);
  }, [clearWarningTimer]);

  const begin = useCallback(
    ({ stage = "Hazırlanıyor", detail = "" } = {}) => {
      clearWarningTimer();
      setState({
        status: "running",
        percent: 0,
        stage,
        detail,
        timeoutWarning: false,
        error: "",
      });

      timeoutWarningRef.current = setTimeout(() => {
        setState((current) =>
          current.status === "running" ? { ...current, timeoutWarning: true } : current
        );
      }, timeoutWarningMs);
    },
    [clearWarningTimer, timeoutWarningMs]
  );

  const onProgress = useCallback((message = {}) => {
    setState((current) => ({
      ...current,
      status: "running",
      stage: message.stage || current.stage,
      detail: message.detail || "",
      percent:
        typeof message.percent === "number"
          ? Math.max(0, Math.min(100, message.percent))
          : current.percent,
    }));
  }, []);

  const markSuccess = useCallback(
    (detail = "Tamamlandı") => {
      clearWarningTimer();
      setState({
        status: "done",
        percent: 100,
        stage: "Tamamlandı",
        detail,
        timeoutWarning: false,
        error: "",
      });
    },
    [clearWarningTimer]
  );

  const markError = useCallback(
    (error) => {
      clearWarningTimer();
      setState({
        status: "error",
        percent: 0,
        stage: "Hata",
        detail: "",
        timeoutWarning: false,
        error: error?.message || String(error || "İşlem başarısız."),
      });
    },
    [clearWarningTimer]
  );

  const cancel = useCallback(
    (reason = "user") => {
      cancelActiveParseJob(reason);
      clearWarningTimer();
      if (reason === "user") {
        logParserJobCancelled({ ...logMeta, reason });
      }
      setState({
        status: "cancelled",
        percent: 0,
        stage: "İptal edildi",
        detail: "",
        timeoutWarning: false,
        error: "",
      });
    },
    [clearWarningTimer, logMeta]
  );

  useEffect(() => {
    return () => {
      clearWarningTimer();
      cancelActiveParseJob("unmount");
    };
  }, [clearWarningTimer]);

  return {
    ...state,
    isRunning: state.status === "running",
    isDone: state.status === "done",
    isError: state.status === "error",
    isCancelled: state.status === "cancelled",
    begin,
    onProgress,
    markSuccess,
    markError,
    cancel,
    reset,
  };
}
