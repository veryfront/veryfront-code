/**
 * Extension validate command tests.
 *
 * @module cli/commands/extension/validate-command.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateExtensionAtPath } from "./validate-command.ts";

describe("extension validate command", () => {
  it("should return issues for a non-existent path", async () => {
    const result = await validateExtensionAtPath("/tmp/nonexistent-ext-path-12345");
    assertEquals(result.valid, false);
    assertEquals(result.issues.length > 0, true);
  });
});
