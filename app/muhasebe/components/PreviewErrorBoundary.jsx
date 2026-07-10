"use client";

import { Component } from "react";

/** Beyaz ekran yerine hata mesajı gösterir */
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
        <div className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-100">
          <p className="font-semibold">Önizleme render hatası</p>
          <p className="mt-2 text-xs text-red-200/90">
            {this.state.error?.message || String(this.state.error)}
          </p>
          <button
            type="button"
            className="mt-3 rounded border border-red-700 px-3 py-1.5 text-xs hover:bg-red-900/50"
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
