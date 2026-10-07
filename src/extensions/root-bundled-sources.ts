/**
 * Source entries shipped in the root package instead of standalone npm packages.
 *
 * @internal
 */
export const ROOT_BUNDLED_EXTENSION_SOURCES: Readonly<Record<string, string>> = Object.freeze({
  "@veryfront/ext-eval-report-mlflow": "extensions/ext-eval-report-mlflow/src/index.ts",
});
