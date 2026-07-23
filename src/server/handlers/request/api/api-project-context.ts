import type { HandlerContext } from "../../types.ts";

type FsWrapper = {
  isMultiProjectMode?: () => boolean;
  runWithContext?: <T>(
    slug: string,
    token: string,
    operation: () => Promise<T>,
    projectId?: string,
    options?: {
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    },
  ) => Promise<T>;
};

export type ApiProjectExecution =
  | { kind: "single" }
  | { kind: "invalid" }
  | {
    kind: "multi";
    productionMode: boolean;
    execute<T>(operation: () => Promise<T>): Promise<T>;
  };

/** Resolve the filesystem-owned project scope before API execution. */
export function resolveApiProjectExecution(ctx: HandlerContext): ApiProjectExecution {
  try {
    const fsWrapper = ctx.adapter.fs as FsWrapper;
    const isMultiProject = !!ctx.projectSlug &&
      typeof fsWrapper.isMultiProjectMode === "function" &&
      fsWrapper.isMultiProjectMode();
    if (!isMultiProject) return { kind: "single" };

    const { projectSlug, proxyToken } = ctx;
    if (!projectSlug || !proxyToken || typeof fsWrapper.runWithContext !== "function") {
      return { kind: "invalid" };
    }

    const runWithContext = fsWrapper.runWithContext.bind(fsWrapper);
    const productionMode = (ctx.resolvedEnvironment ?? ctx.requestContext?.mode) === "production";
    const branch = productionMode
      ? null
      : ctx.requestContext?.branch ?? ctx.parsedDomain?.branch ?? null;

    return {
      kind: "multi",
      productionMode,
      execute: (operation) =>
        runWithContext(projectSlug, proxyToken, operation, ctx.projectId, {
          productionMode,
          releaseId: ctx.releaseId,
          branch,
          environmentName: ctx.environmentName,
        }),
    };
  } catch {
    return { kind: "invalid" };
  }
}
