import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isServerOnlyPackage } from "./server-only-packages.ts";

describe("isServerOnlyPackage", () => {
  it("recognizes known server-only drivers", () => {
    for (const pkg of ["redis", "ioredis", "pg", "mysql2", "better-sqlite3", "mongodb"]) {
      assertEquals(isServerOnlyPackage(pkg), true, `${pkg} should be server-only`);
    }
  });

  it("strips an npm: prefix before matching", () => {
    assertEquals(isServerOnlyPackage("npm:redis"), true);
  });

  it("recognizes configured package names", () => {
    const configured = ["knex", "@prisma/client"];

    assertEquals(isServerOnlyPackage("knex", configured), true);
    assertEquals(isServerOnlyPackage("npm:knex", configured), true);
    assertEquals(isServerOnlyPackage("@prisma/client", configured), true);
  });

  it("leaves browser-safe packages alone", () => {
    for (const pkg of ["react", "react-dom", "zod", "lodash", "@tanstack/react-query"]) {
      assertEquals(isServerOnlyPackage(pkg), false, `${pkg} should not be server-only`);
    }
  });
});
