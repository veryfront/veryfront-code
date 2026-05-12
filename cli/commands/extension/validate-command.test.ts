import "#veryfront/schemas/_test-setup.ts";
/**
 * Extension validate command tests.
 *
 * @module cli/commands/extension/validate-command.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "@std/path";
import { validateExtensionAtPath } from "./validate-command.ts";

async function writeExt(dir: string, content: string): Promise<void> {
  await Deno.mkdir(join(dir, "src"), { recursive: true });
  await Deno.writeTextFile(join(dir, "src", "index.ts"), content);
}

describe("extension validate command", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "vf-validate-" });
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("should return issues for a non-existent path", async () => {
    const result = await validateExtensionAtPath("/tmp/nonexistent-ext-path-12345");
    assertEquals(result.valid, false);
    assertEquals(result.issues.length > 0, true);
  });

  it("should report missing entry point when neither src/index.ts nor index.ts exists", async () => {
    const result = await validateExtensionAtPath(tmp);
    assertEquals(result.valid, false);
    assertEquals(
      result.issues.some((i) => i.includes("No entry point")),
      true,
    );
  });

  it("should accept a valid extension module", async () => {
    await writeExt(
      tmp,
      `export default () => ({
        name: "valid-ext",
        version: "0.1.0",
        capabilities: [],
      });\n`,
    );
    const result = await validateExtensionAtPath(tmp);
    assertEquals(result.valid, true);
    assertEquals(result.issues.length, 0);
  });

  it("should reject when default export is not a function", async () => {
    await writeExt(tmp, `export default { name: "not-a-factory" };\n`);
    const result = await validateExtensionAtPath(tmp);
    assertEquals(result.valid, false);
    assertEquals(
      result.issues.some((i) => i.includes("ExtensionFactory")),
      true,
    );
  });

  it("should surface shape validation issues from the factory output", async () => {
    await writeExt(
      tmp,
      `export default () => ({
        name: "",
        version: "0.1.0",
        capabilities: [],
      });\n`,
    );
    const result = await validateExtensionAtPath(tmp);
    assertEquals(result.valid, false);
    assertEquals(
      result.issues.some((i) => i.toLowerCase().includes("name")),
      true,
    );
  });

  it("should fall back to index.ts when src/index.ts is absent", async () => {
    await Deno.writeTextFile(
      join(tmp, "index.ts"),
      `export default () => ({
        name: "flat-ext",
        version: "0.1.0",
        capabilities: [],
      });\n`,
    );
    const result = await validateExtensionAtPath(tmp);
    assertEquals(result.valid, true);
  });
});
