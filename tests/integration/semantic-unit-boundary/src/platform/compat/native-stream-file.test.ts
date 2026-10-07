import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, readFile, remove } from "#veryfront/testing/deno-compat.ts";
import {
  openNativeStreamFile,
  removeNativeStreamFile,
  renameNativeStreamFile,
} from "#veryfront/platform/compat/native-stream-file.ts";

describe("native stream file authority", () => {
  it("promotes private files without invoking replaced filesystem rename hooks", async () => {
    const directory = await makeTempDir();
    const source = `${directory}/private.bin`;
    const destination = `${directory}/promoted.bin`;
    const nodeFs = await import("node:fs");
    const nodePromises = await import("node:fs/promises");
    const originalNodeRename = nodeFs.default.rename;
    const originalPromiseRename = nodePromises.default.rename;
    const originalDenoRename = globalThis.Deno?.rename;
    let hookCalls = 0;
    try {
      const file = await openNativeStreamFile(source);
      await file.write(new Uint8Array([1, 2, 3]));
      await file.close();
      nodeFs.default.rename = () => {
        hookCalls++;
        throw new Error("untrusted rename");
      };
      nodePromises.default.rename = () => {
        hookCalls++;
        throw new Error("untrusted rename");
      };
      if (globalThis.Deno && originalDenoRename) {
        globalThis.Deno.rename = () => {
          hookCalls++;
          throw new Error("untrusted rename");
        };
      }
      await renameNativeStreamFile(source, destination);
      assertEquals(hookCalls, 0);
      assertEquals([...await readFile(destination)], [1, 2, 3]);
      await assertRejects(() => renameNativeStreamFile(source, destination), Error);
      assertEquals(hookCalls, 0);
    } finally {
      nodeFs.default.rename = originalNodeRename;
      nodePromises.default.rename = originalPromiseRename;
      if (globalThis.Deno && originalDenoRename) globalThis.Deno.rename = originalDenoRename;
      await remove(directory, { recursive: true });
    }
  });
  it("writes exclusive private files and closes them idempotently", async () => {
    const directory = await makeTempDir();
    const path = `${directory}/private.bin`;
    try {
      const file = await openNativeStreamFile(path);
      try {
        assertEquals(await file.write(new Uint8Array([1, 2, 3])), 3);
      } finally {
        await file.close();
        await file.close();
      }
      await assertRejects(async () => await file.write(new Uint8Array([9])), Error);
      assertEquals([...await readFile(path)], [1, 2, 3]);
      await assertRejects(() => openNativeStreamFile(path), Error);
      assertEquals([...await readFile(path)], [1, 2, 3]);
      await removeNativeStreamFile(path);
      await assertRejects(() => removeNativeStreamFile(path), Error);
    } finally {
      await remove(directory, { recursive: true });
    }
  });

  it("rejects native open failures without creating a destination", async () => {
    const directory = await makeTempDir();
    try {
      await assertRejects(() => openNativeStreamFile(`${directory}/missing/private.bin`), Error);
    } finally {
      await remove(directory, { recursive: true });
    }
  });
});
