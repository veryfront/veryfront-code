import type * as React from "react";
import { createError, toError } from "#veryfront/errors";

/**
 * Detects the component objects `React.memo`, `React.forwardRef` and
 * `React.lazy` produce. All of them carry a well-known symbol on `$$typeof`,
 * which is what separates a component from an ordinary data export such as an
 * App Router `metadata` object.
 */
function isReactComponentObject(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    typeof (value as { $$typeof?: unknown }).$$typeof === "symbol";
}

/**
 * Picks the first named export that can be rendered.
 *
 * The `__esModule` marker is skipped explicitly. Transpilers place that boolean
 * first in the namespace they emit for a module with only named exports, so
 * taking the first key blindly yielded `true` instead of a component, and the
 * failure surfaced during render rather than here.
 *
 * Functions and React-tagged objects are both components, so declaration order
 * decides between them: a module exporting `{ Page: memo(...), loader() {} }`
 * resolves to `Page`. An untagged object is neither obviously a component nor
 * obviously not one, so it is kept only as a last resort, which leaves a module
 * exporting `metadata` alongside its component resolving to the component while
 * still tolerating a component shape this function does not recognise.
 */
function firstRenderableExport(moduleObj: Record<string, unknown>): unknown {
  let untaggedObject: unknown;

  for (const [key, value] of Object.entries(moduleObj)) {
    if (key === "default" || key === "__esModule") continue;
    if (typeof value === "function" || isReactComponentObject(value)) return value;
    if (untaggedObject === undefined && typeof value === "object" && value !== null) {
      untaggedObject = value;
    }
  }

  return untaggedObject;
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
