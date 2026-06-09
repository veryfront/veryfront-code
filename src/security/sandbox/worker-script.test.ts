import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "node:path";
import {
  clearModuleCache,
  loadModule,
  makeProjectPathGuard,
  serializeError,
} from "./worker-script.ts";

describe("worker-script makeProjectPathGuard", () => {
  it("allows a real file inside the project", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      const filePath = join(projectDir, "data.json");
      await Deno.writeTextFile(filePath, "{}");
      const guard = makeProjectPathGuard(projectDir);
      const resolved = await guard("data.json");
      assertEquals(resolved, await Deno.realPath(filePath));
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects plain ../ traversal", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      const guard = makeProjectPathGuard(projectDir);
      await assertRejects(() => guard("../../etc/passwd"), Error, "escapes project directory");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects a symlink inside the project that points outside it", async () => {
    const projectDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    try {
      const secret = join(outsideDir, "secret.txt");
      await Deno.writeTextFile(secret, "leaked-by-symlink");
      // A symlink that lives inside the project but resolves outside it.
      await Deno.symlink(secret, join(projectDir, "link.txt"));

      const guard = makeProjectPathGuard(projectDir);
      await assertRejects(() => guard("link.txt"), Error, "escapes project directory");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  it("allows a not-yet-existing path that is lexically contained", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      const guard = makeProjectPathGuard(projectDir);
      const resolved = await guard("nested/new-file.txt");
      // The target doesn't exist so it can't be canonicalized; it is still
      // accepted (lexically contained) and points at the nested path.
      assert(resolved.endsWith(join("nested", "new-file.txt")));
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});

describe("worker-script serializeError", () => {
  it("serializes a standard Error preserving message, name, and stack", () => {
    const err = new Error("boom");
    const serialized = serializeError(err);

    assertEquals(serialized.message, "boom");
    assertEquals(serialized.name, "Error");
    assertExists(serialized.stack);
    // No RFC 9457 fields on a plain Error
    assertEquals(serialized.type, undefined);
    assertEquals(serialized.status, undefined);
    assertEquals(serialized.detail, undefined);
  });

  it("preserves the subclass name for custom Error types", () => {
    class TypeErrorish extends Error {
      override name = "TypeErrorish";
    }
    const serialized = serializeError(new TypeErrorish("bad type"));
    assertEquals(serialized.name, "TypeErrorish");
    assertEquals(serialized.message, "bad type");
  });

  it("preserves RFC 9457 fields from VFError-like errors", () => {
    const err = Object.assign(new Error("not found"), {
      type: "https://veryfront.dev/errors/not-found",
      status: 404,
      detail: "Resource was not located",
    });
    const serialized = serializeError(err);

    assertEquals(serialized.message, "not found");
    assertEquals(serialized.type, "https://veryfront.dev/errors/not-found");
    assertEquals(serialized.status, 404);
    assertEquals(serialized.detail, "Resource was not located");
  });

  it("ignores RFC 9457 fields of the wrong type", () => {
    const err = Object.assign(new Error("oops"), {
      type: 123, // not a string
      status: "500", // not a number
      detail: { nested: true }, // not a string
    });
    const serialized = serializeError(err);

    assertEquals(serialized.type, undefined);
    assertEquals(serialized.status, undefined);
    assertEquals(serialized.detail, undefined);
  });

  it("serializes a non-Error value via String() with name 'Error'", () => {
    const serialized = serializeError("just a string");
    assertEquals(serialized.message, "just a string");
    assertEquals(serialized.name, "Error");
    assertEquals(serialized.stack, undefined);

    const numSerialized = serializeError(42);
    assertEquals(numSerialized.message, "42");
    assertEquals(numSerialized.name, "Error");

    const nullSerialized = serializeError(null);
    assertEquals(nullSerialized.message, "null");
  });

  it("serializes the top-level Error even when it has a nested cause", () => {
    const root = new Error("root cause");
    const wrapper = new Error("wrapper failure", { cause: root });
    const serialized = serializeError(wrapper);

    // Only the top-level error is serialized into the transport shape.
    assertEquals(serialized.message, "wrapper failure");
    assertEquals(serialized.name, "Error");
    // The serialized shape does not carry a `cause` field.
    assertEquals((serialized as unknown as Record<string, unknown>).cause, undefined);
  });
});

describe("worker-script loadModule", () => {
  const tempFiles: string[] = [];

  afterEach(async () => {
    clearModuleCache();
    for (const f of tempFiles.splice(0)) {
      try {
        await Deno.remove(f);
      } catch {
        // ignore
      }
    }
  });

  it("imports a module from an absolute path and exposes its exports", async () => {
    const path = await Deno.makeTempFile({ suffix: ".mjs" });
    tempFiles.push(path);
    await Deno.writeTextFile(
      path,
      "export const value = 7;\nexport function GET() { return 'ok'; }\nexport default 'def';\n",
    );

    const mod = await loadModule(path);
    assertEquals(mod.value, 7);
    assertEquals(typeof mod.GET, "function");
    assertEquals((mod.GET as () => string)(), "ok");
    assertEquals(mod.default, "def");
  });

  it("caches the module so repeated loads return the same object", async () => {
    const path = await Deno.makeTempFile({ suffix: ".mjs" });
    tempFiles.push(path);
    await Deno.writeTextFile(path, "export const n = 1;\n");

    const first = await loadModule(path);
    const second = await loadModule(path);
    assert(first === second, "cached module should be referentially identical");
  });

  it("rejects when the module path does not exist", async () => {
    const missing = `${await Deno.makeTempDir()}/does-not-exist-${crypto.randomUUID()}.mjs`;
    await assertRejects(() => loadModule(missing));
  });

  it("rejects when the module has invalid syntax", async () => {
    const path = await Deno.makeTempFile({ suffix: ".mjs" });
    tempFiles.push(path);
    await Deno.writeTextFile(path, "export const = ;;; this is not valid js");

    await assertRejects(() => loadModule(path));
  });
});
