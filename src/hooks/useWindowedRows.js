"use client";

import { useCallback, useMemo, useRef, useState } from "react";

const DEFAULT_OVERSCAN = 6;

export function useWindowedRows({
  rows = [],
  enabled = false,
  rowHeight = 48,
  overscan = DEFAULT_OVERSCAN,
} = {}) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  const onScroll = useCallback(() => {
    if (!containerRef.current) return;
    setScrollTop(containerRef.current.scrollTop);
  }, []);

  const { windowRows, offsetY, totalHeight, startIndex } = useMemo(() => {
    if (!enabled) {
      return {
        windowRows: rows,
        offsetY: 0,
        totalHeight: rows.length * rowHeight,
        startIndex: 0,
      };
    }

    const viewport = containerRef.current?.clientHeight || 600;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(viewport / rowHeight) + overscan * 2;
    const end = Math.min(rows.length, start + visibleCount);

    return {
      windowRows: rows.slice(start, end),
      offsetY: start * rowHeight,
      totalHeight: rows.length * rowHeight,
      startIndex: start,
    };
  }, [enabled, rows, rowHeight, scrollTop, overscan]);

  return {
    containerRef,
    onScroll,
    windowRows,
    offsetY,
    totalHeight,
    startIndex,
  };
}
