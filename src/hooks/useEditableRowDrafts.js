"use client";

import { useCallback, useMemo, useRef, useState } from "react";

function cloneDraft(value) {
  if (!value || typeof value !== "object") return value;
  return { ...value };
}

export function useEditableRowDrafts({
  rows = [],
  buildDraft,
  rowKey = "id",
} = {}) {
  const originalRef = useRef({});

  const [drafts, setDrafts] = useState({});
  const [selectedIds, setSelectedIds] = useState([]);
  const [editingRowId, setEditingRowId] = useState("");
  const [focusedCell, setFocusedCell] = useState({ rowId: "", field: "" });

  const syncDraftsFromRows = useCallback(
    (nextRows = []) => {
      const next = {};
      const originals = {};
      nextRows.forEach((row) => {
        const draft = buildDraft ? buildDraft(row) : { ...row };
        next[row[rowKey]] = draft;
        originals[row[rowKey]] = cloneDraft(draft);
      });
      originalRef.current = originals;
      setDrafts(next);
    },
    [buildDraft, rowKey]
  );

  const getDraft = useCallback(
    (rowId, fallbackRow) => drafts[rowId] || (buildDraft ? buildDraft(fallbackRow) : {}),
    [drafts, buildDraft]
  );

  const updateDraft = useCallback((rowId, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [rowId]: {
        ...(prev[rowId] || {}),
        [field]: value,
      },
    }));
  }, []);

  const patchDraft = useCallback((rowId, patch = {}) => {
    setDrafts((prev) => ({
      ...prev,
      [rowId]: {
        ...(prev[rowId] || {}),
        ...patch,
      },
    }));
  }, []);

  const cancelRowEdit = useCallback((rowId) => {
    const original = originalRef.current[rowId];
    if (!original) return;
    setDrafts((prev) => ({ ...prev, [rowId]: cloneDraft(original) }));
    setEditingRowId((current) => (current === rowId ? "" : current));
  }, []);

  const commitRowEdit = useCallback((rowId) => {
    const draft = drafts[rowId];
    if (draft) originalRef.current[rowId] = cloneDraft(draft);
    setEditingRowId((current) => (current === rowId ? "" : current));
  }, [drafts]);

  const toggleRowSelection = useCallback((rowId) => {
    setSelectedIds((prev) =>
      prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId]
    );
  }, []);

  const toggleSelectAll = useCallback(
    (predicate = () => true) => {
      const eligible = rows.filter(predicate).map((row) => row[rowKey]);
      const allSelected = eligible.length > 0 && eligible.every((id) => selectedIds.includes(id));
      if (allSelected) {
        setSelectedIds((prev) => prev.filter((id) => !eligible.includes(id)));
        return;
      }
      setSelectedIds((prev) => Array.from(new Set([...prev, ...eligible])));
    },
    [rows, rowKey, selectedIds]
  );

  const applyBulkPatch = useCallback((patch = {}, ids = selectedIds) => {
    setDrafts((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        next[id] = { ...(next[id] || {}), ...patch };
      });
      return next;
    });
  }, [selectedIds]);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

  const dirtyRowIds = useMemo(() => {
    return Object.keys(drafts).filter((rowId) => {
      const current = drafts[rowId];
      const original = originalRef.current[rowId];
      if (!current || !original) return false;
      return JSON.stringify(current) !== JSON.stringify(original);
    });
  }, [drafts]);

  const validationErrors = useMemo(() => {
    const errors = {};
    dirtyRowIds.forEach((rowId) => {
      const draft = drafts[rowId];
      if (!String(draft?.accountCode || "").trim()) {
        errors[rowId] = "Hesap kodu zorunlu";
      }
    });
    return errors;
  }, [dirtyRowIds, drafts]);

  return {
    drafts,
    setDrafts,
    syncDraftsFromRows,
    getDraft,
    updateDraft,
    patchDraft,
    cancelRowEdit,
    commitRowEdit,
    editingRowId,
    setEditingRowId,
    focusedCell,
    setFocusedCell,
    selectedIds,
    setSelectedIds,
    toggleRowSelection,
    toggleSelectAll,
    applyBulkPatch,
    clearSelection,
    dirtyRowIds,
    validationErrors,
  };
}
