import type * as React from "react";
import { createError, toError } from "#veryfront/errors";

/**
 * A React component is either a function (function or class component) or an
 * object, which is what `React.memo`, `React.forwardRef` and `React.lazy`
 * produce. Nothing else can be rendered.
 */
function isRenderable(value: unknown): boolean {
  return typeof value === "function" || (typeof value === "object" && value !== null);
}

/**
 * Picks the first named export that can be rendered.
 *
 * The `__esModule` marker is skipped explicitly. Transpilers place that boolean
 * first in the namespace they emit for a module with only named exports, so
 * taking the first key blindly yielded `true` instead of a component and the
 * failure surfaced during render rather than here.
 *
 * Functions are preferred over objects so that a module pairing data with a
 * component, such as an App Router page exporting `metadata` alongside its
 * component, resolves to the component. Objects are still accepted, because
 * `React.memo`, `React.forwardRef` and `React.lazy` all produce one.
 */
function firstRenderableExport(moduleObj: Record<string, unknown>): unknown {
  let objectExport: unknown;

  for (const [key, value] of Object.entries(moduleObj)) {
    if (key === "default" || key === "__esModule") continue;
    if (typeof value === "function") return value;
    if (objectExport === undefined && isRenderable(value)) objectExport = value;
  }

  return objectExport;
}

export function extractComponent(
  mod: unknown,
  filePath: string,
): React.ComponentType<Record<string, unknown>> {
  if (!mod || typeof mod !== "object") {
    throw toError(
      createError({
        type: "build",
        message: `No component exported from ${filePath}`,
        context: { file: filePath, phase: "transform" },
      }),
    );
  }

  const moduleObj = mod as Record<string, unknown>;
  const component = moduleObj.default ?? firstRenderableExport(moduleObj);

  if (!component) {
    throw toError(
      createError({
        type: "build",
        message: `No component exported from ${filePath}`,
        context: { file: filePath, phase: "transform" },
      }),
    );
  }

  return component as React.ComponentType<Record<string, unknown>>;
}
