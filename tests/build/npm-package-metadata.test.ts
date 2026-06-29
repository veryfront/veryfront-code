import { assertEquals } from "#veryfront/testing/assert.ts";
import { normalizeNpmPackageMetadata } from "../../scripts/build/npm-package-metadata.ts";

Deno.test("keeps native sqlite support optional for npm consumers", () => {
  const pkg = normalizeNpmPackageMetadata({
    dependencies: {
      "better-sqlite3": "9.6.0",
      "@kreuzberg/node": "^4.4.2",
    },
    peerDependencies: {},
    peerDependenciesMeta: {},
  });

  assertEquals(pkg.dependencies, undefined);
  assertEquals(pkg.peerDependencies, {
    "@kreuzberg/node": "^4.4.2",
    "better-sqlite3": ">=9.0.0",
  });
  assertEquals(pkg.peerDependenciesMeta, {
    "@kreuzberg/node": { optional: true },
    "better-sqlite3": { optional: true },
  });
  assertEquals(pkg.overrides, {
    protobufjs: "8.6.5",
  });
});
