"use client";

import { Component } from "react";

/** Tek satır/render hatası tüm Banka Parser sayfasını düşürmesin. */
export default class PreviewErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[PreviewErrorBoundary]", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-4 text-sm text-amber-100">
          <p className="font-semibold">
            Önizleme oluşturulurken bir hata oluştu. Tekrar deneyin.
          </p>
          <p className="mt-2 text-xs text-amber-200/80">
            Dosya seçimi ve üst menü kullanılabilir durumda. Ön izlemeyi yeniden
            oluşturabilirsiniz.
          </p>
          <button
            type="button"
            className="mt-3 rounded border border-amber-700/70 px-3 py-1.5 text-xs hover:bg-amber-900/40"
            onClick={() => this.setState({ error: null })}
          >
            Yeniden dene
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
