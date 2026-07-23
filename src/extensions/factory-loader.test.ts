import "#veryfront/schemas/_test-setup.ts";
/**
 * Factory loader tests: dynamic import, default export handling, error paths.
 *
 * @module extensions/factory-loader.test
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "@std/path";
import { loadExtensionFactory } from "./factory-loader.ts";

describe("loadExtensionFactory()", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await Deno.makeTempDir({ prefix: "vf-factory-loader-" });
  });

  afterEach(async () => {
    await Deno.remove(tmp, { recursive: true });
  });

  it("loads an extension from a factory with a default export", async () => {
    const path = join(tmp, "ok.extension.ts");
    await Deno.writeTextFile(
      path,
      `export default () => ({
        name: "ok-ext",
        version: "1.2.3",
        capabilities: [{ type: "bundler" }],
      });`,
    );

    const resolved = await loadExtensionFactory(path, "local-file");
    assertEquals(resolved.extension.name, "ok-ext");
    assertEquals(resolved.extension.version, "1.2.3");
    assertEquals(resolved.source, "local-file");
    assertEquals(resolved.origin, path);
    assertEquals(resolved.extension.capabilities[0]?.type, "bundler");
  });

  it("forwards config to the factory", async () => {
    const path = join(tmp, "config.extension.ts");
    await Deno.writeTextFile(
      path,
      `export default (config) => ({
        name: "cfg-ext",
        version: "1.0.0",
        capabilities: [],
        provides: { CfgEcho: config },
      });`,
    );

    const resolved = await loadExtensionFactory(path, "config", {
      hello: "world",
    });
    assertEquals(
      (resolved.extension.provides as { CfgEcho: unknown }).CfgEcho,
      { hello: "world" },
    );
  });

  it("throws EXTENSION_VALIDATION_ERROR when default export is missing", async () => {
    const path = join(tmp, "no-default.extension.ts");
    await Deno.writeTextFile(
      path,
      `export const named = () => ({ name: "x", version: "1.0.0", capabilities: [] });`,
    );

    const error = await assertRejects(
      () => loadExtensionFactory(path, "local-file"),
      Error,
      "no default export",
    );
    assertEquals(String(error).includes(tmp), false);
  });

  it("throws EXTENSION_VALIDATION_ERROR when default export is not a function", async () => {
    const path = join(tmp, "not-fn.extension.ts");
    await Deno.writeTextFile(
      path,
      `export default { name: "not-fn", version: "1.0.0", capabilities: [] };`,
    );

    const error = await assertRejects(
      () => loadExtensionFactory(path, "local-file"),
      Error,
      "default export is not a function",
    );
    assertEquals(String(error).includes(tmp), false);
  });

  it("throws EXTENSION_VALIDATION_ERROR when factory throws", async () => {
    const path = join(tmp, "throws.extension.ts");
    const canary = "private-factory-canary";
    await Deno.writeTextFile(
      path,
      `export default () => { throw new Error("${canary}"); };`,
    );

    const error = await assertRejects(
      () => loadExtensionFactory(path, "local-file"),
      Error,
      "factory failed during initialization",
    );
    assertEquals(String(error).includes(canary), false);
    assertEquals(String(error).includes(tmp), false);
    assertEquals((error as { cause?: unknown }).cause, undefined);
  });

  it("throws EXTENSION_VALIDATION_ERROR when import fails (missing file)", async () => {
    const path = join(tmp, "does-not-exist.extension.ts");

    const error = await assertRejects(
      () => loadExtensionFactory(path, "local-file"),
      Error,
      "Failed to import extension",
    );
    assertEquals(String(error).includes(tmp), false);
    assertEquals((error as { cause?: unknown }).cause, undefined);
  });

  it("rejects an invalid factory result before returning it", async () => {
    const path = join(tmp, "invalid-result.extension.ts");
    await Deno.writeTextFile(path, `export default () => ({ name: "invalid" });`);

    const error = await assertRejects(
      () => loadExtensionFactory(path, "local-file"),
      Error,
      "factory returned an invalid extension",
    );
    assertEquals(String(error).includes(tmp), false);
  });

  it("preserves the discovered source on the returned ResolvedExtension", async () => {
    const path = join(tmp, "pkg.extension.ts");
    await Deno.writeTextFile(
      path,
      `export default () => ({ name: "pkg-ext", version: "1.0.0", capabilities: [] });`,
    );

    const resolved = await loadExtensionFactory(path, "project");
    assertEquals(resolved.source, "project");
  });

  it("rejects remote package URLs and relative filesystem paths", async () => {
    await assertRejects(
      () => loadExtensionFactory("https://example.invalid/extension.ts", "package"),
      Error,
      "specifier is invalid",
    );
    await assertRejects(
      () => loadExtensionFactory("./relative.extension.ts", "local-file"),
      Error,
      "specifier is invalid",
    );
  });

  it("rejects specifiers that do not match their discovery source", async () => {
    const path = join(tmp, "mismatched.extension.ts");
    await Deno.writeTextFile(
      path,
      `export default () => ({ name: "mismatch", version: "1.0.0", capabilities: [] });`,
    );

    await assertRejects(
      () => loadExtensionFactory(path, "package"),
      Error,
      "specifier is invalid for its source",
    );
    await assertRejects(
      () => loadExtensionFactory("some-package", "project"),
      Error,
      "specifier is invalid for its source",
    );
  });
});
