import { captureFrameworkReader } from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/framework-capture.ts";
import { FRAMEWORK_SRC_DIR } from "#veryfront/platform/compat/framework-source-resolver.ts";
import { resolveRootBundledExtensionSourcePath } from "#veryfront/transforms/pipeline/stages/ssr-vf-modules/path-resolver.ts";
import { join } from "#veryfront/compat/path";

const result = await captureFrameworkReader().readUtf8(
  join(FRAMEWORK_SRC_DIR, "agent/identity-contracts.ts"),
  FRAMEWORK_SRC_DIR,
  64 * 1024,
  "Framework source",
);
if (!result.content.includes("AGENT_CATALOG_KINDS")) {
  throw new Error("Embedded source was not captured");
}
const bundledPath = await resolveRootBundledExtensionSourcePath(
  "@veryfront/ext-eval-report-mlflow",
);
if (!bundledPath?.endsWith(".ts.src")) {
  throw new Error("Pristine root-bundled extension source was not embedded");
}
const bundledSource = await Deno.readTextFile(bundledPath);
if (!bundledSource.includes('from "veryfront/platform/env"')) {
  throw new Error("Embedded root-bundled SDK import was rewritten at compile time");
}
console.log("framework-capture-ok");
