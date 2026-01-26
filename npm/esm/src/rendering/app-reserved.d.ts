import * as BundledReact from "react";
import type { RuntimeAdapter } from "../platform/adapters/base.js";
type ReservedComponent = BundledReact.ComponentType<{
    error?: Error;
    reset?: () => void;
}>;
export declare const RESERVED_COMPONENTS: {
    loading: string;
    error: string;
    notFound: string;
};
export declare function collectAncestorDirs(segmentDir: string, appRootDir: string): string[];
interface ErrorBoundaryState {
    hasError: boolean;
    error?: Error;
}
interface ErrorBoundaryProps {
    children?: BundledReact.ReactNode;
}
type ReactLike = {
    createElement: typeof BundledReact.createElement;
};
export declare function createErrorBoundary(ErrorComponent: ReservedComponent, ReactLib?: ReactLike): typeof BundledReact.Component<ErrorBoundaryProps, ErrorBoundaryState>;
export declare function tryLoadReservedInDirs(dirs: string[], which: keyof typeof RESERVED_COMPONENTS, projectDir: string, _mode: "development" | "production", adapter: RuntimeAdapter, projectId?: string, contentSourceId?: string): Promise<ReservedComponent | null>;
export {};
//# sourceMappingURL=app-reserved.d.ts.map