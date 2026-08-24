import { assertEquals } from "#veryfront/testing/assert.ts";
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
  assertEquals(pkg.peerDependencies, {});
  assertEquals(pkg.peerDependenciesMeta, {});
  assertEquals(pkg.overrides, {
    protobufjs: "8.6.5",
  });
});
