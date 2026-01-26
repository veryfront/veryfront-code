import * as BundledReact from "react";
import { rendererLogger as logger } from "../utils/index.js";
export const RESERVED_COMPONENTS = {
    loading: "loading.tsx",
    error: "error.tsx",
    notFound: "not-found.tsx",
};
export function collectAncestorDirs(segmentDir, appRootDir) {
    const normalize = (p) => p.replace(/\\+/g, "/").replace(/\/\.+\//g, "/");
    const getDirname = (p) => normalize(p).replace(/\/?[^/]+\/?$/, "");
    const dirs = [];
    let current = normalize(segmentDir);
    const root = normalize(appRootDir);
    while (current.startsWith(root)) {
        dirs.push(current);
        const parent = getDirname(current) || "/";
        if (parent === current || parent.length < root.length)
            break;
        current = parent;
    }
    return dirs;
}
export function createErrorBoundary(ErrorComponent, ReactLib = BundledReact) {
    return class ErrorBoundary extends BundledReact.Component {
        constructor(props) {
            super(props);
            this.state = { hasError: false };
        }
        static getDerivedStateFromError(error) {
            return { hasError: true, error };
        }
        componentDidCatch(error, errorInfo) {
            logger.error("Error boundary caught error:", error, errorInfo);
        }
        render() {
            if (!this.state.hasError || !ErrorComponent)
                return this.props.children;
            return ReactLib.createElement(ErrorComponent, {
                error: this.state.error,
                reset: () => this.setState({ hasError: false }),
            });
        }
    };
}
export async function tryLoadReservedInDirs(dirs, which, projectDir, _mode, adapter, projectId, contentSourceId) {
    const join = (a, b) => `${a.replace(/\/$/, "")}/${b.replace(/^\//, "")}`;
    const candidateName = RESERVED_COMPONENTS[which];
    const { loadComponentFromSource } = await import("../modules/react-loader/component-loader.js");
    for (const dir of dirs) {
        for (const ext of [".tsx", ".jsx"]) {
            const file = join(dir, candidateName.replace(/\.tsx$/, ext));
            try {
                const src = await adapter.fs.readFile(file);
                const Cmp = await loadComponentFromSource(src, file, projectDir, adapter, {
                    projectId: projectId ?? projectDir,
                    dev: true,
                    contentSourceId,
                });
                if (typeof Cmp === "function")
                    return Cmp;
            }
            catch {
                // Component not found in this path, continue to next
            }
        }
    }
    return null;
}
