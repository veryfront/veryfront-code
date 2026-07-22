import { assertEquals } from "#veryfront/testing/assert.ts";
import { isServerOnlyPackage } from "./server-only-packages.ts";

Deno.test("isServerOnlyPackage: recognizes known server-only drivers", () => {
  for (const pkg of ["redis", "ioredis", "pg", "mysql2", "better-sqlite3", "mongodb"]) {
    assertEquals(isServerOnlyPackage(pkg), true, `${pkg} should be server-only`);
  }
});

Deno.test("isServerOnlyPackage: strips an npm: prefix before matching", () => {
  assertEquals(isServerOnlyPackage("npm:redis"), true);
});

Deno.test("isServerOnlyPackage: leaves browser-safe packages alone", () => {
  for (const pkg of ["react", "react-dom", "zod", "lodash", "@tanstack/react-query"]) {
    assertEquals(isServerOnlyPackage(pkg), false, `${pkg} should not be server-only`);
  }
});
