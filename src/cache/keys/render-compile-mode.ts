/********************************************************************************
 * Render Cache Compile Mode
 *
 * The compile mode of a render is part of its cache identity: it decides
 * minification, tree shaking and inline sourcemaps for the hydration bundle and
 * the page module a cached render carries. `environment` does not imply it, so
 * it gets its own key segment.
 *
 * @module core/cache/keys/render-compile-mode
 ********************************************************************************/

/** Compile mode of every artifact reachable from one render cache prefix. */
export type RenderCompileMode = "development" | "production";

/** Segment that names the compile mode inside a render cache key. */
export const RENDER_COMPILE_MODE_SEGMENTS: Readonly<Record<RenderCompileMode, string>> = {
  development: "cdev",
  production: "cprod",
};

const RENDER_COMPILE_MODE_SEGMENT_VALUES: readonly string[] = Object.values(
  RENDER_COMPILE_MODE_SEGMENTS,
);

/** True when `segment` names a compile mode in a render cache key. */
export function isRenderCompileModeSegment(segment: string | undefined): boolean {
  return segment !== undefined && RENDER_COMPILE_MODE_SEGMENT_VALUES.includes(segment);
}
