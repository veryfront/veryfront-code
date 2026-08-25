import type * as React from "react";
import { createError, toError } from "#veryfront/errors";

/** React object tags that are valid element types across supported runtimes. */
const REACT_COMPONENT_OBJECT_TAGS: ReadonlySet<symbol> = new Set([
  Symbol.for("react.memo"),
  Symbol.for("react.forward_ref"),
  Symbol.for("react.lazy"),
  Symbol.for("react.context"),
  // React 18 exposes Provider as a distinct type; React 19 renders Context
  // directly and exposes Consumer separately. Supporting both keeps compiled
  // modules portable across the React versions Veryfront accepts.
  Symbol.for("react.provider"),
  Symbol.for("react.consumer"),
  Symbol.for("react.module.reference"),
  Symbol.for("react.client.reference"),
]);

/**
 * Detects React's component-type objects, which separates a component from an
 * ordinary data export such as an App Router `metadata` object.
 *
 * The allowlist is deliberate: `Symbol.for("react.*")` is a public namespace,
 * not proof that an object is a renderable React type. React also uses it for
 * rendered nodes and internal markers, and applications can mint arbitrary
 * entries in the same registry. The structural `getModuleId` branch matches
 * React-is's compatibility contract for Flight references without a tag.
 */
function isReactComponentObject(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;

  const component = value as { $$typeof?: unknown; getModuleId?: unknown };
  const tag = component.$$typeof;
  return (typeof tag === "symbol" && REACT_COMPONENT_OBJECT_TAGS.has(tag)) ||
    component.getModuleId !== undefined;
}

/** Reports whether an object carries a React-style symbol marker. */
function hasSymbolTypeTag(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return typeof (value as { $$typeof?: unknown }).$$typeof === "symbol";
}

/**
 * The built-in components React exports as bare symbols.
 *
 * Verified against `react@19.2.4` by enumerating its symbol-valued exports, and
 * cross-checked with `react-is`, whose `isValidElementType` accepts Fragment,
 * Suspense, SuspenseList, StrictMode and Profiler standing alone and rejects
 * every `$$typeof` marker. `Activity` is included because React exports it as a
 * component; `react-is` has not caught up, and React's own export is what the
 * renderer follows.
 *
 * Bare symbols need their own whitelist: every other `react.*` symbol is a
 * marker `react-is` re-exports, which React rejects if it reaches the renderer.
 */
const REACT_BUILTIN_TYPES: ReadonlySet<symbol> = new Set([
  Symbol.for("react.fragment"),
  Symbol.for("react.suspense"),
  Symbol.for("react.suspense_list"),
  Symbol.for("react.strict_mode"),
  Symbol.for("react.profiler"),
  Symbol.for("react.activity"),
]);

/** Detects React's symbol-valued built-in components, such as `Fragment`. */
function isReactBuiltinType(value: unknown): boolean {
  return typeof value === "symbol" && REACT_BUILTIN_TYPES.has(value);
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
    if (
      untaggedObject === undefined &&
      typeof value === "object" &&
      value !== null &&
      !hasSymbolTypeTag(value)
    ) {
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
