import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import {
  normalizeNpmPackageMetadata,
  NpmPackageOwnershipError,
} from "../../scripts/build/npm-package-metadata.ts";

Deno.test("fails closed when generated root metadata contains extension dependencies", () => {
  const error = assertThrows(
    () =>
      normalizeNpmPackageMetadata({
        dependencies: {
          "better-sqlite3": "9.6.0",
          "@kreuzberg/node": "^4.4.2",
        },
      }),
    NpmPackageOwnershipError,
  );

  assertEquals(error.code, "root-extension-dependency-collision");
});
