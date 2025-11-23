import * as React from "react";
import { rendererLogger, rendererLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

// Type for reserved components (loading, error, not-found)
// Using unknown props since different reserved components have different prop requirements
type ReservedComponent = React.ComponentType<unknown>;

// Reserved runtime components mapping (kept for compatibility)
export const RESERVED_COMPONENTS = {
  loading: "loading.tsx",
  error: "error.tsx",
  notFound: "not-found.tsx",
};

export function collectAncestorDirs(segmentDir: string, appRootDir: string): string[] {
  const normalize = (p: string) => p.replace(/\\+/g, "/").replace(/\/\.+\//g, "/");
  const getDirname = (p: string) => normalize(p).replace(/\/?[^/]+\/?$/, "");
  const dirs: string[] = [];
  let current = normalize(segmentDir);
  const root = normalize(appRootDir);
  while (current.startsWith(root)) {
    dirs.push(current);
    const parent = getDirname(current) || "/";
    if (parent === current || parent.length < root.length) break;
    current = parent;
  }
  return dirs;
}

export function createErrorBoundary(ErrorComponent: ReservedComponent) {
  // Create a proper React Error Boundary class component
  return class ErrorBoundary extends React.Component<
    { children?: React.ReactNode },
    { hasError: boolean; error?: Error }
  > {
    constructor(props: { children?: React.ReactNode }) {
      super(props);
      this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error) {
      return { hasError: true, error };
    }

    override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
      logger.error("Error boundary caught error:", error, errorInfo);
    }

    override render() {
      if (this.state.hasError && ErrorComponent) {
        const Reserved = ErrorComponent as React.ComponentType<Record<string, unknown>>;
        return React.createElement(Reserved, {
          error: this.state.error,
          reset: () => this.setState({ hasError: false }),
        });
      }
      return this.props.children;
    }
  };
}

export async function tryLoadReservedInDirs(
  dirs: string[],
  which: keyof typeof RESERVED_COMPONENTS,
  projectDir: string,
  _mode: "development" | "production",
  adapter: RuntimeAdapter,
): Promise<ReservedComponent | null> {
  const join = (a: string, b: string) => `${a.replace(/\/$/, "")}/${b.replace(/^\//, "")}`;
  const candidateName = RESERVED_COMPONENTS[which];
  for (const dir of dirs) {
    for (const ext of [".tsx", ".jsx"]) {
      const file = join(dir, candidateName.replace(/\.tsx$/, ext));
      try {
        const src = await adapter.fs.readFile(file);
        // Use new ESM component loader
        const { loadComponentFromSource } = await import(
          "@veryfront/modules/react-loader/component-loader.ts"
        );
        const Cmp = await loadComponentFromSource(
          src,
          file,
          projectDir,
          adapter,
          { projectId: projectDir, dev: true },
        );
        if (typeof Cmp === "function") return Cmp as ReservedComponent;
      } catch (e) {
        try {
          const { rendererLogger } = await import("@veryfront/utils/logger/logger.ts");
          rendererLogger.debug("reserved component probe miss", e);
        } catch (logError) {
          // Log error during logging attempt - avoid recursive failures
          rendererLogger.warn("Failed to log reserved component probe miss:", logError);
        }
      }
    }
  }
  return null;
}
