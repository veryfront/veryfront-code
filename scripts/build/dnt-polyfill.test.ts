import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { patchDntArgvPolyfill, patchDntDenoShim } from "./dnt-polyfill.ts";

/** Verbatim shape of the `_dnt.shims.js` DNT emits for `shims: { deno: true, crypto: true }`. */
const GENERATED_SHIMS = `import { Deno } from "@deno/shim-deno";
export { Deno } from "@deno/shim-deno";
import { crypto } from "@deno/shim-crypto";
export { crypto } from "@deno/shim-crypto";
const dntGlobals = {
    Deno,
    crypto,
};
export const dntGlobalThis = globalThis;
`;

describe("patchDntArgvPolyfill", () => {
  it("guards missing process argv entries", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.polyfills.js`;

    try {
      await Deno.writeTextFile(
        path,
        'const mainUrl = "file:///" + process.argv[1].replace(/\\\\/g, "/");\n',
      );

      assertEquals(await patchDntArgvPolyfill(path, { required: true }), true);
      assertEquals(
        await Deno.readTextFile(path),
        'const mainUrl = "file:///" + (process.argv[1] ?? "").replace(/\\\\/g, "/");\n',
      );
      assertEquals(await patchDntArgvPolyfill(path, { required: true }), false);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("skips packages without the DNT import-meta shim", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.polyfills.js`;

    try {
      await Deno.writeTextFile(path, "export {};\n");
      assertEquals(await patchDntArgvPolyfill(path), false);
      assertEquals(await Deno.readTextFile(path), "export {};\n");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("fails closed when required DNT output changes", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.polyfills.js`;

    try {
      await Deno.writeTextFile(path, "export {};\n");
      await assertRejects(
        () => patchDntArgvPolyfill(path, { required: true }),
        Error,
        "does not contain the expected process.argv[1] expression",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
});

/**
 * Load the patched `_dnt.shims.js` the way the published package loads it, with
 * `@deno/shim-deno` swapped for a local stub so the test can tell which `Deno`
 * the module actually hands back.
 */
async function importPatchedShims(
  directory: string,
  source: string,
): Promise<{ Deno: typeof Deno }> {
  await Deno.writeTextFile(
    `${directory}/stub-shim-deno.js`,
    'export const Deno = { __stub: "deno" };\n',
  );
  await Deno.writeTextFile(
    `${directory}/stub-shim-crypto.js`,
    'export const crypto = { __stub: "crypto" };\n',
  );
  const path = `${directory}/_dnt.shims.js`;
  await Deno.writeTextFile(
    path,
    source
      .replaceAll('"@deno/shim-deno"', '"./stub-shim-deno.js"')
      .replaceAll('"@deno/shim-crypto"', '"./stub-shim-crypto.js"'),
  );
  return await import(
    `${import.meta.resolve(`file://${path}`)}?t=${Date.now()}`
  );
}

describe("patchDntDenoShim", () => {
  it("pins the bug being fixed: unpatched DNT shims shadow the real Deno global", async () => {
    const directory = await Deno.makeTempDir();

    try {
      // DNT re-exports `@deno/shim-deno` unconditionally, so the published
      // package used the Node reimplementation even when running under Deno.
      const unpatched = await importPatchedShims(directory, GENERATED_SHIMS);
      assertEquals(unpatched.Deno, { __stub: "deno" });
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("makes the published shims prefer the real Deno global", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.shims.js`;

    try {
      await Deno.writeTextFile(path, GENERATED_SHIMS);
      assertEquals(await patchDntDenoShim(path, { required: true }), true);

      // Running under Deno, the module must resolve to the runtime's own Deno.
      // The `@deno/shim-deno` fallback reimplements Deno.listen on top of
      // node:net and reads `server._handle.fd`, which is null under Deno's node
      // compatibility layer — every `veryfront dev` under Deno died there.
      const patched = await importPatchedShims(
        directory,
        await Deno.readTextFile(path),
      );
      assertEquals(patched.Deno, globalThis.Deno);
      assertEquals(typeof patched.Deno.listen, "function");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("keeps the shim fallback for runtimes without Deno", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.shims.js`;

    try {
      await Deno.writeTextFile(path, GENERATED_SHIMS);
      await patchDntDenoShim(path, { required: true });
      const patchedSource = await Deno.readTextFile(path);

      // Simulate Node/Bun, where `globalThis.Deno` is absent, by pinning the
      // native lookup to undefined before re-evaluating the module.
      const nodeShaped = patchedSource.replace(
        "globalThis.Deno",
        "/* node */ undefined",
      );
      const patched = await importPatchedShims(directory, nodeShaped);
      assertEquals(patched.Deno, { __stub: "deno" });
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("is idempotent", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.shims.js`;

    try {
      await Deno.writeTextFile(path, GENERATED_SHIMS);
      assertEquals(await patchDntDenoShim(path, { required: true }), true);
      const once = await Deno.readTextFile(path);
      assertEquals(await patchDntDenoShim(path, { required: true }), false);
      assertEquals(await Deno.readTextFile(path), once);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("fails closed when required DNT shim output changes", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.shims.js`;

    try {
      await Deno.writeTextFile(
        path,
        'export { Deno } from "@deno/shim-deno-next";\n',
      );
      await assertRejects(
        () => patchDntDenoShim(path, { required: true }),
        Error,
        "does not contain the expected @deno/shim-deno re-export",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("skips packages without the DNT Deno shim", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.shims.js`;

    try {
      await Deno.writeTextFile(path, "export {};\n");
      assertEquals(await patchDntDenoShim(path), false);
      assertEquals(await Deno.readTextFile(path), "export {};\n");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
});
