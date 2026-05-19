import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { createPublicImportValidator } from "./guide-validation.ts";

describe("guide validation helpers", () => {
  it("validates multi-segment public package imports", () => {
    const isKnownPublicImport = createPublicImportValidator({
      ".": "./src/index.ts",
      "./extensions": "./src/extensions/index.ts",
      "./extensions/auth": "./src/extensions/auth/index.ts",
      "./testing/assert": "./src/testing/assert.ts",
    });

    assertEquals(isKnownPublicImport("veryfront"), true);
    assertEquals(isKnownPublicImport("veryfront/extensions"), true);
    assertEquals(isKnownPublicImport("veryfront/extensions/auth"), true);
    assertEquals(isKnownPublicImport("veryfront/testing/assert"), true);
    assertEquals(isKnownPublicImport("veryfront/extensions/missing"), false);
  });
});
