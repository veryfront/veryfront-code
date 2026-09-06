import { captureFrameworkReader } from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/framework-capture.ts";
import { FRAMEWORK_SRC_DIR } from "#veryfront/platform/compat/framework-source-resolver.ts";
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
console.log("framework-capture-ok");
