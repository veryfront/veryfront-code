import { assertExists } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { reset, tryResolve } from "#veryfront/extensions/contracts.ts";
import { CSSProcessorName } from "#veryfront/extensions/css/index.ts";
import { registerTailwindExtension } from "#veryfront/html/styles-builder/__tests__/css-processor-setup.ts";
import { withTestContext } from "./context.ts";

it("registers the CSSProcessor fixture after a registry reset", async () => {
  reset();
  try {
    await withTestContext("css-contract-restoration", async () => {
      assertExists(tryResolve(CSSProcessorName));
    });
  } finally {
    await registerTailwindExtension();
  }
});
