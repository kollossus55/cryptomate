import React from "react";

export default class ChartErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("AdvancedChart render error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300">
          <p className="font-semibold mb-2">Chart failed to render</p>
          <pre className="text-xs whitespace-pre-wrap break-words">
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-3 px-3 py-1 text-xs rounded bg-red-600 hover:bg-red-700 text-white"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}