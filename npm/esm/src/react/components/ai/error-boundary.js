import * as React from "react";
export class AIErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, errorInfo) {
        console.error("[AIErrorBoundary] Caught error:", error, errorInfo);
        this.props.onError?.(error, errorInfo);
    }
    reset = () => {
        this.setState({ hasError: false, error: null });
    };
    render() {
        const { hasError, error } = this.state;
        if (!hasError || !error)
            return this.props.children;
        const { fallback } = this.props;
        if (fallback) {
            return typeof fallback === "function" ? fallback(error, this.reset) : fallback;
        }
        return (React.createElement("div", { className: "border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-2xl p-6", role: "alert" },
            React.createElement("div", { className: "flex items-start gap-4" },
                React.createElement("div", { className: "w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0" },
                    React.createElement("svg", { className: "w-5 h-5 text-red-600 dark:text-red-400", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor" },
                        React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" }))),
                React.createElement("div", { className: "flex-1 min-w-0" },
                    React.createElement("h3", { className: "text-base font-semibold text-red-900 dark:text-red-100" }, this.props.errorMessage ?? "An error occurred in the AI component"),
                    React.createElement("p", { className: "mt-1.5 text-sm text-red-700 dark:text-red-300 leading-relaxed" }, error.message),
                    React.createElement("button", { type: "button", onClick: this.reset, className: "mt-4 px-5 py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 active:scale-[0.98] rounded-full transition-all" }, "Try Again")))));
    }
}
export function useAIErrorHandler() {
    const [error, setError] = React.useState(null);
    const handleError = React.useCallback((err) => {
        console.error("[useAIErrorHandler] Error:", err);
        setError(err);
    }, []);
    const clearError = React.useCallback(() => {
        setError(null);
    }, []);
    return { error, handleError, clearError, hasError: error !== null };
}
