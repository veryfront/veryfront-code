import { Component, type ErrorInfo, type ReactNode } from "react";

interface RenderErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  resetKey: unknown;
}

interface RenderErrorBoundaryState {
  hasError: boolean;
}

/** Contain render failures without exposing component errors in the page. */
export class RenderErrorBoundary
  extends Component<RenderErrorBoundaryProps, RenderErrorBoundaryState> {
  override state: RenderErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RenderErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    console.error("[Veryfront SPA] Component render failed");
  }

  override componentDidUpdate(previous: RenderErrorBoundaryProps): void {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  override render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
