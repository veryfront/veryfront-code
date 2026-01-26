import * as React from "react";
export interface AIErrorBoundaryProps {
    children: React.ReactNode;
    fallback?: React.ReactNode | ((error: Error, reset: () => void) => React.ReactNode);
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
    errorMessage?: string;
}
interface AIErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}
export declare class AIErrorBoundary extends React.Component<AIErrorBoundaryProps, AIErrorBoundaryState> {
    constructor(props: AIErrorBoundaryProps);
    static getDerivedStateFromError(error: Error): AIErrorBoundaryState;
    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void;
    reset: () => void;
    render(): React.ReactNode;
}
export declare function useAIErrorHandler(): {
    error: Error | null;
    handleError: (error: Error) => void;
    clearError: () => void;
    hasError: boolean;
};
export {};
//# sourceMappingURL=error-boundary.d.ts.map