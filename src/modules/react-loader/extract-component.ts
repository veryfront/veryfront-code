import type * as React from "react";
import { createError, toError } from "#veryfront/errors";

/**
 * The `$$typeof` tags that mark a rendered node rather than a component type.
 *
 * An element or a portal is the *result* of rendering, so handing one to React
 * as a component fails. Everything else React tags is a component type of some
 * kind: `memo`, `forwardRef`, `lazy`, context, provider, consumer, and the
 * client and server references the RSC path produces.
 */
const REACT_NODE_TAGS: ReadonlySet<symbol> = new Set([
  Symbol.for("react.element"),
  Symbol.for("react.transitional.element"),
  Symbol.for("react.portal"),
]);

/** Reports whether a symbol is one React registered, such as `react.memo`. */
function isReactTag(tag: unknown): tag is symbol {
  return typeof tag === "symbol" && (Symbol.keyFor(tag)?.startsWith("react.") ?? false);
}

/**
 * Detects React's component-type objects, which separates a component from an
 * ordinary data export such as an App Router `metadata` object.
 *
 * Excluding the node tags is what matters here, rather than listing the
 * component tags: React keeps adding component types, and this module has no
 * business tracking that list. Anything React tags that is not a rendered node
 * is something the caller can render.
 */
function isReactComponentObject(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;

  const tag = (value as { $$typeof?: unknown }).$$typeof;
  return isReactTag(tag) && !REACT_NODE_TAGS.has(tag);
}

/**
 * The built-in components React exports as bare symbols.
 *
 * Verified against `react@19.2.4` by enumerating its symbol-valued exports, and
 * cross-checked with `react-is`, whose `isValidElementType` accepts
 * `react.fragment`, `react.suspense`, `react.strict_mode` and `react.profiler`
 * standing alone and rejects every `$$typeof` marker. `Activity` is included
 * because React exports it as a component; `react-is` has not caught up, and
 * React's own export is what the renderer follows.
 *
 * This is a whitelist while the object check is an exclusion list, and the
 * asymmetry is real rather than an oversight. Component *wrappers* are
 * open-ended, so excluding the rendered-node tags is the claim that stays true
 * there. Bare symbols are the opposite: only these few are element types, and
 * every other `react.*` symbol is a marker `react-is` re-exports, which React
 * rejects if it reaches the renderer.
 */
const REACT_BUILTIN_TYPES: ReadonlySet<symbol> = new Set([
  Symbol.for("react.fragment"),
  Symbol.for("react.suspense"),
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
