import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildImportWarningKey,
  MAX_IMPORT_WARNING_ENTRIES,
  rememberImportWarning,
} from "./import-warning-dedup.ts";

describe("transforms/shared/import-warning-dedup", () => {
  it("bounds identities derived from oversized tenant and specifier values", () => {
    const first = buildImportWarningKey("a".repeat(100_000), "p".repeat(100_000));
    const second = buildImportWarningKey("b".repeat(100_000), "p".repeat(100_000));

    assert(first.length < 1_000);
    assert(second.length < 1_000);
    assertNotEquals(first, second);
  });

  it("deduplicates warnings while bounding process-lifetime entries", () => {
    const warned = new Set<string>();
    assertEquals(rememberImportWarning(warned, "same"), true);
    assertEquals(rememberImportWarning(warned, "same"), false);

    warned.clear();
    for (let index = 0; index < MAX_IMPORT_WARNING_ENTRIES; index++) {
      assertEquals(rememberImportWarning(warned, `key-${index}`), true);
    }
    assertEquals(warned.size, MAX_IMPORT_WARNING_ENTRIES);

    assertEquals(rememberImportWarning(warned, "after-capacity"), true);
    assertEquals(warned.size, 1);
  });
});
