import type * as React from "react";
import { createError, toError } from "#veryfront/errors";

/** The `$$typeof` tags React puts on component types, as opposed to elements. */
const REACT_COMPONENT_TAGS: ReadonlySet<symbol> = new Set([
  Symbol.for("react.memo"),
  Symbol.for("react.forward_ref"),
  Symbol.for("react.lazy"),
  Symbol.for("react.context"),
  Symbol.for("react.provider"),
  Symbol.for("react.consumer"),
]);

/**
 * Detects React component-type objects, which separates a component from an
 * ordinary data export such as an App Router `metadata` object.
 *
 * The tags are matched individually rather than accepting any symbol-valued
 * `$$typeof`, because a React *element* carries one too. An element is a
 * rendered node, not a component type, so selecting one would hand React
 * something it cannot instantiate.
 */
function isReactComponentObject(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;

  const tag = (value as { $$typeof?: unknown }).$$typeof;
  return typeof tag === "symbol" && REACT_COMPONENT_TAGS.has(tag);
}

/**
 * Detects React's symbol-valued built-in types.
 *
 * `Fragment`, `Suspense`, `StrictMode`, `Profiler` and friends are registered
 * symbols rather than functions or tagged objects, and a layout is allowed to
 * be one. Matching on the registry key covers them all, and any type React adds
 * later, without pinning a list that would silently fall behind.
 *
 * A bare symbol cannot be an element, so this does not reopen the element case
 * that `REACT_COMPONENT_TAGS` exists to exclude.
 */
function isReactBuiltinType(value: unknown): boolean {
  if (typeof value !== "symbol") return false;

  return Symbol.keyFor(value)?.startsWith("react.") ?? false;
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

  // Read one key at a time rather than materialising every value up front. A
  // module namespace exposes its exports as getters, and one can throw while a
  // usable component sits further along, as happens with a circular import.
  for (const key of Object.keys(moduleObj)) {
    if (key === "default" || key === "__esModule") continue;

    let value: unknown;
    try {
      value = moduleObj[key];
    } catch (_) {
      /* expected: an export can throw on access, such as a circular import */
      continue;
    }

    if (
      typeof value === "function" || isReactComponentObject(value) ||
      isReactBuiltinType(value)
    ) {
      return value;
    }
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
