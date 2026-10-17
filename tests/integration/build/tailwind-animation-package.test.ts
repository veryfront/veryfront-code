import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { fromFileUrl } from "#std/path";
import { createExtensionPackageSpec } from "../../../scripts/build/npm-extension-package-metadata.ts";
import { vendorComponentsByWorkspaceManifest } from "../../../scripts/build/vendor-source-components.ts";
const root = new URL("../../../", import.meta.url);
const rootDirectory = fromFileUrl(root);
const rootConfig = {
  exports: {
    "./extensions": "./src/extensions/index.ts",
    "./extensions/css": "./src/extensions/css/index.ts",
    "./errors": "./src/errors/index.ts",
  },
};

it("animation CSS extension publishes the exact dependency and static payload", async () => {
  const manifest = JSON.parse(
    await Deno.readTextFile(new URL("extensions/ext-css-tailwind/deno.json", root)),
  );
  const spec = createExtensionPackageSpec({
    manifestPath: "extensions/ext-css-tailwind/deno.json",
    manifest,
    rootConfig,
    rootDir: rootDirectory,
    version: "0.1.0",
    license: "Apache-2.0",
  });
  assertEquals(spec.manifestDependencies["tw-animate-css"], "1.4.0");
  const inventory = await vendorComponentsByWorkspaceManifest(
    ["extensions/ext-css-tailwind"],
    rootDirectory,
  );
  assertEquals(
    inventory["extensions/ext-css-tailwind/deno.json"].some((component) =>
      component.name === "tw-animate-css"
    ),
    true,
  );
  const entry = await Deno.readTextFile(new URL("extensions/ext-css-tailwind/src/index.ts", root));
  assertStringIncludes(entry, 'from "../vendor/tw-animate-css.js"');
  const payload = await Deno.readTextFile(
    new URL("extensions/ext-css-tailwind/vendor/tw-animate-css.js", root),
  );
  assertStringIncludes(payload, "export const TW_ANIMATE_CSS");
  assertStringIncludes(payload, "@keyframes enter");
});
