/**
 * Public style artifact helpers used by CLI and worker entrypoints.
 *
 * @module rendering/styles
 */

export {
  buildPreparedCSSArtifactFromFiles,
  type PreparedCSSArtifactBuildResult,
} from "../html/styles-builder/css-pregeneration.ts";
export {
  createStyleScopeProfile,
  type StyleScopeProfile,
} from "../html/styles-builder/style-scope-profile.ts";
export { resolveStyleContentVersion } from "../html/styles-builder/content-version.ts";
