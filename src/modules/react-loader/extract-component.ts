import type * as React from "react";
import { createError, toError } from "#veryfront/errors";

/**
 * A React component is either a function (function or class component) or an
 * object, which is what `React.memo`, `React.forwardRef` and `React.lazy`
 * produce. Nothing else can be rendered.
 *
 * The check matters most for the `__esModule` marker. Transpilers place that
 * boolean first in the namespace they emit for a module with only named
 * exports, so selecting the first key blindly returns `true` instead of a
 * component, and the failure then surfaces during render rather than here.
 */
function isRenderable(value: unknown): boolean {
  return typeof value === "function" || (typeof value === "object" && value !== null);
}

/** Picks the default export, else the first named export that can be rendered. */
function selectComponent(moduleObj: Record<string, unknown>): unknown {
  if (isRenderable(moduleObj.default)) return moduleObj.default;

  for (const [key, value] of Object.entries(moduleObj)) {
    if (key === "__esModule") continue;
    if (isRenderable(value)) return value;
  }

  return undefined;
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
  const component = selectComponent(moduleObj);

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
