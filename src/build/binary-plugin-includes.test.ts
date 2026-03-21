import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BINARY_TAILWIND_PLUGIN_PACKAGES,
  getBinaryPluginBundleIncludes,
  getTailwindPluginBundleUrl,
} from "./binary-plugin-includes.ts";

describe("build/binary-plugin-includes", () => {
  it("builds bundle URLs that match the runtime plugin loader contract", () => {
    assertEquals(
      getTailwindPluginBundleUrl("tailwindcss-animate@1.0.7"),
      "https://esm.sh/tailwindcss-animate@1.0.7?bundle&external=tailwindcss&target=denonext",
    );
  });

  it("returns bundle includes for every pinned binary plugin", () => {
    assertEquals(
      getBinaryPluginBundleIncludes(),
      BINARY_TAILWIND_PLUGIN_PACKAGES.map((pkg) =>
        `https://esm.sh/${pkg}?bundle&external=tailwindcss&target=denonext`
      ),
    );
  });
});
