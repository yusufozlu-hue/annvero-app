"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AnnveroEditableDataTable from "@/src/components/AnnveroEditableDataTable";
import { useEditableRowDrafts } from "@/src/hooks/useEditableRowDrafts";

export function useAnnveroGridHistory({ limit = 30 } = {}) {
  const stackRef = useRef([]);
  const pointerRef = useRef(-1);
  const [, forceRender] = useState(0);

  const push = useCallback(
    (snapshot) => {
      const next = stackRef.current.slice(0, pointerRef.current + 1);
      next.push(snapshot);
      if (next.length > limit) next.shift();
      stackRef.current = next;
      pointerRef.current = next.length - 1;
      forceRender((v) => v + 1);
    },
    [limit]
  );

  const undo = useCallback(() => {
    if (pointerRef.current <= 0) return null;
    pointerRef.current -= 1;
    forceRender((v) => v + 1);
    return stackRef.current[pointerRef.current];
  }, []);

  const redo = useCallback(() => {
    if (pointerRef.current >= stackRef.current.length - 1) return null;
    pointerRef.current += 1;
    forceRender((v) => v + 1);
    return stackRef.current[pointerRef.current];
  }, []);

  return {
    push,
    undo,
    redo,
    canUndo: pointerRef.current > 0,
    canRedo: pointerRef.current < stackRef.current.length - 1,
  };
}

export default function AnnveroUnifiedEditableGrid({
  rows = [],
  columns = [],
  rowKey = "id",
  buildDraft,
  onRowsCommit,
  enableBulk = false,
  enableVirtualScroll = false,
  pageSize = 50,
  exportFilename = "annvero-grid.csv",
  renderRowActions,
  bulkToolbar = null,
  className = "",
  isLoading = false,
  showToolbar = true,
}) {
  const {
    drafts,
    syncDraftsFromRows,
    updateDraft,
    selectedIds,
    toggleRowSelection,
    toggleSelectAll,
    editingRowId,
    setEditingRowId,
    cancelRowEdit,
    commitRowEdit,
    validationErrors,
    applyBulkPatch,
    clearSelection,
  } = useEditableRowDrafts({ rows, buildDraft, rowKey });

  const history = useAnnveroGridHistory();

  useEffect(() => {
    syncDraftsFromRows(rows);
  }, [rows, syncDraftsFromRows]);

  const handleDraftChange = useCallback(
    (rowId, field, value) => {
      history.push({ rowId, field, value, drafts });
      updateDraft(rowId, field, value);
    },
    [history, updateDraft, drafts]
  );

  const handleCommitEdit = useCallback(
    (rowId) => {
      commitRowEdit(rowId);
      onRowsCommit?.(rowId, drafts[rowId]);
    },
    [commitRowEdit, onRowsCommit, drafts]
  );

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!history.canUndo}
          onClick={() => {
            const snapshot = history.undo();
            if (snapshot?.drafts) syncDraftsFromRows(rows);
          }}
          className="rounded-lg border border-slate-700 px-2 py-1 text-xs disabled:opacity-40"
        >
          Geri al
        </button>
        <button
          type="button"
          disabled={!history.canRedo}
          onClick={() => history.redo()}
          className="rounded-lg border border-slate-700 px-2 py-1 text-xs disabled:opacity-40"
        >
          Yinele
        </button>
        {enableBulk && selectedIds.length ? (
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-lg border border-slate-700 px-2 py-1 text-xs"
          >
            Seçimi temizle ({selectedIds.length})
          </button>
        ) : null}
      </div>

      <AnnveroEditableDataTable
        columns={columns}
        rows={rows}
        rowKey={rowKey}
        drafts={drafts}
        selectedIds={enableBulk ? selectedIds : []}
        editingRowId={editingRowId}
        validationErrors={validationErrors}
        onToggleSelect={enableBulk ? toggleRowSelection : undefined}
        onToggleSelectAll={enableBulk ? () => toggleSelectAll() : undefined}
        onDraftChange={handleDraftChange}
        onStartEdit={setEditingRowId}
        onCancelEdit={cancelRowEdit}
        onCommitEdit={handleCommitEdit}
        renderRowActions={renderRowActions}
        bulkToolbar={bulkToolbar}
        enableVirtualScroll={enableVirtualScroll}
        pageSize={pageSize}
        exportFilename={exportFilename}
        isLoading={isLoading}
        showToolbar={showToolbar}
      />
    </div>
  );
}
