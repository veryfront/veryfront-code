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

  assertEquals(pkg.dependencies, {
    "@kreuzberg/node": "^4.4.2",
  });
  assertEquals(pkg.peerDependencies, {
    "better-sqlite3": ">=9.0.0",
  });
  assertEquals(pkg.peerDependenciesMeta, {
    "better-sqlite3": { optional: true },
  });
});
