/**
 * Transform pipeline types.
 *
 * Defines the plugin-based architecture for ESM transforms.
 * Each stage handles one concern, making the pipeline testable and maintainable.
 */
/**
 * Transform stages in execution order.
 * Each stage runs after the previous completes.
 */
export var TransformStage;
(function (TransformStage) {
    /** MDX → JSX compilation */
    TransformStage[TransformStage["PARSE"] = 0] = "PARSE";
    /** esbuild JSX → JS compilation */
    TransformStage[TransformStage["COMPILE"] = 1] = "COMPILE";
    /** @/ alias resolution */
    TransformStage[TransformStage["RESOLVE_ALIASES"] = 2] = "RESOLVE_ALIASES";
    /** react/jsx-runtime → esm.sh URLs (cached to file:// for SSR later) */
    TransformStage[TransformStage["RESOLVE_REACT"] = 3] = "RESOLVE_REACT";
    /** Context packages (@tanstack/react-query, etc.) → unified URLs */
    TransformStage[TransformStage["RESOLVE_CONTEXT"] = 4] = "RESOLVE_CONTEXT";
    /** ./relative imports → full paths or module server URLs */
    TransformStage[TransformStage["RESOLVE_RELATIVE"] = 5] = "RESOLVE_RELATIVE";
    /** Bare npm imports → esm.sh URLs (cached to file:// for SSR later) */
    TransformStage[TransformStage["RESOLVE_BARE"] = 6] = "RESOLVE_BARE";
    /** Final cleanup, caching, HTTP normalization */
    TransformStage[TransformStage["FINALIZE"] = 7] = "FINALIZE";
})(TransformStage || (TransformStage = {}));
