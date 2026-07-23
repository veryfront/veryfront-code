import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BINARY_TAILWIND_PLUGIN_PACKAGES,
  getBinaryPluginBundleIncludes,
  getTailwindPluginBundleUrl,
  resolveTailwindPluginBundlePackage,
} from "./binary-plugin-includes.ts";

describe("build/binary-plugin-includes", () => {
  it("builds bundle URLs that match the runtime plugin loader contract", () => {
    assertEquals(
      getTailwindPluginBundleUrl("tailwindcss-animate@1.0.7"),
      "https://esm.sh/tailwindcss-animate@1.0.7?bundle&external=tailwindcss&target=denonext",
    );
  });

  it("resolves bare bundled plugin names to the pinned binary package", () => {
    assertEquals(
      resolveTailwindPluginBundlePackage("@tailwindcss/typography"),
      "@tailwindcss/typography@0.5.19",
    );
    assertEquals(
      getTailwindPluginBundleUrl("@tailwindcss/typography"),
      "https://esm.sh/@tailwindcss/typography@0.5.19?bundle&external=tailwindcss&target=denonext",
    );
  });

  it("keeps explicit plugin versions unchanged", () => {
    assertEquals(
      resolveTailwindPluginBundlePackage("@tailwindcss/typography@0.5.18"),
      "@tailwindcss/typography@0.5.18",
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

  it("rejects package specifiers that can alter the bundle URL", () => {
    for (
      const packageName of [
        "",
        " tailwindcss-animate",
        "tailwindcss-animate ",
        "tailwindcss-animate?target=node",
        "tailwindcss-animate#fragment",
        "tailwindcss-animate/extra",
        "../tailwindcss-animate",
        "https://example.com/plugin",
        "@scope",
        "@scope/plugin@",
        "@scope/plugin@1.0.0/path",
        "plugin%3Ftarget=node",
        "plugin\n@1.0.0",
      ]
    ) {
      assertThrows(
        () => getTailwindPluginBundleUrl(packageName),
        TypeError,
        "valid npm package specifier",
      );
    }
  });
});
