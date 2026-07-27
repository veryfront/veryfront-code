import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { normalizeNpmPackageMetadata } from "../../scripts/build/npm-package-metadata.ts";

Deno.test("removes native sqlite support from root npm metadata", () => {
  const pkg = normalizeNpmPackageMetadata({
    dependencies: {
      "better-sqlite3": "9.6.0",
      "@kreuzberg/node": "^4.4.2",
    },
    peerDependencies: {},
    peerDependenciesMeta: {},
  });

  assertEquals(pkg.dependencies, undefined);
  // @huggingface/transformers is always declared as an optional peer: its
  // opaque import is invisible to dnt, so the fallback range supplies it.
  assertEquals(pkg.peerDependencies, {
    "@huggingface/transformers": "^4.2.0",
  });
  assertEquals(pkg.peerDependenciesMeta, {
    "@huggingface/transformers": { optional: true },
  });
  assertEquals(pkg.overrides, {
    protobufjs: "8.6.5",
  });
});

Deno.test("build and publish wiring includes create-veryfront", async () => {
  const [buildScript, publishScript, smokeScript] = await Promise.all([
    Deno.readTextFile("scripts/build/build-npm-dnt.ts"),
    Deno.readTextFile("scripts/ci/publish-npm-packages.sh"),
    Deno.readTextFile("scripts/test/npm-install-smoke.sh"),
  ]);

  assertStringIncludes(buildScript, "createCreateVeryfrontPackage");
  assertStringIncludes(buildScript, "create-veryfront");
  assertStringIncludes(publishScript, "npm/create");
  assertStringIncludes(publishScript, "create-veryfront");
  assertStringIncludes(smokeScript, "node_modules/create-veryfront/bin/create-veryfront.js");
});
