import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  patchDntArgvPolyfill,
  patchDntCryptoShim,
  patchDntDenoShim,
} from "./dnt-polyfill.ts";

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
): Promise<{ Deno: typeof Deno; crypto: typeof crypto }> {
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

  it("never makes Deno resolve the Node/Bun fallback", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.shims.js`;

    try {
      await Deno.writeTextFile(path, GENERATED_SHIMS);
      await patchDntDenoShim(path, { required: true });
      const patchedSource = await Deno.readTextFile(path);

      // A static import makes every runtime resolve `@deno/shim-deno`, including
      // Deno, which discards the value. The esm transform rewrites that bare
      // specifier to an absolute file:// bundle, and Deno refuses to prepare
      // that graph node when node_modules is unmanaged — `deno install -g`
      // writes `nodeModulesDir: "manual"` — so a globally installed CLI failed
      // every request with "Loading unprepared module" while the bundle it
      // named was present on disk.
      assertEquals(
        /(^|\n)\s*import\s[^\n]*from\s*"@deno\/shim-deno"/.test(patchedSource),
        false,
        "the Node/Bun fallback must not be imported statically",
      );
      assertEquals(
        patchedSource.includes('await import("@deno/shim-deno")'),
        true,
        "the fallback must load lazily, only on runtimes that use it",
      );
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

  it("leaves the crypto shim to patchDntCryptoShim", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.shims.js`;

    try {
      await Deno.writeTextFile(path, GENERATED_SHIMS);
      await patchDntDenoShim(path, { required: true });
      const patchedSource = await Deno.readTextFile(path);

      assertEquals(
        patchedSource.includes('from "@deno/shim-crypto"'),
        true,
        "the Deno patcher must not silently take over the crypto shim",
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

describe("patchDntCryptoShim", () => {
  it("never makes a runtime with native crypto resolve the fallback", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.shims.js`;

    try {
      await Deno.writeTextFile(path, GENERATED_SHIMS);
      assertEquals(await patchDntCryptoShim(path, { required: true }), true);
      const patchedSource = await Deno.readTextFile(path);

      // The esm transform rewrites this bare specifier to an absolute file://
      // bundle exactly as it does for the Deno shim, and a static import of it
      // is unpreparable when node_modules is unmanaged. Web Crypto is a global
      // on Deno, Node 19+ and Bun, so the fallback is dead weight everywhere
      // the framework runs.
      assertEquals(
        /(^|\n)\s*import\s[^\n]*from\s*"@deno\/shim-crypto"/.test(
          patchedSource,
        ),
        false,
        "the crypto fallback must not be imported statically",
      );
      assertEquals(
        patchedSource.includes('await import("@deno/shim-crypto")'),
        true,
        "the crypto fallback must load lazily",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("prefers the runtime's own crypto global", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.shims.js`;

    try {
      await Deno.writeTextFile(path, GENERATED_SHIMS);
      await patchDntCryptoShim(path, { required: true });
      const patched = await importPatchedShims(
        directory,
        await Deno.readTextFile(path),
      );
      assertEquals(patched.crypto, globalThis.crypto);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("keeps the fallback for runtimes without a crypto global", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.shims.js`;

    try {
      await Deno.writeTextFile(path, GENERATED_SHIMS);
      await patchDntCryptoShim(path, { required: true });
      const nodeShaped = (await Deno.readTextFile(path)).replace(
        "globalThis.crypto",
        "/* no crypto */ undefined",
      );
      const patched = await importPatchedShims(directory, nodeShaped);
      assertEquals(patched.crypto, { __stub: "crypto" });
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("is idempotent", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.shims.js`;

    try {
      await Deno.writeTextFile(path, GENERATED_SHIMS);
      assertEquals(await patchDntCryptoShim(path, { required: true }), true);
      const once = await Deno.readTextFile(path);
      assertEquals(await patchDntCryptoShim(path, { required: true }), false);
      assertEquals(await Deno.readTextFile(path), once);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("fails closed when required DNT crypto output changes", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.shims.js`;

    try {
      await Deno.writeTextFile(
        path,
        'export { crypto } from "@deno/shim-crypto-next";\n',
      );
      await assertRejects(
        () => patchDntCryptoShim(path, { required: true }),
        Error,
        "does not contain the expected @deno/shim-crypto re-export",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("fails closed on unrecognized crypto output without being asked to", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.shims.js`;

    try {
      // build-npm-extension-packages.ts calls this without `required`, so the
      // default path is the one that guards the extension packages.
      await Deno.writeTextFile(
        path,
        'export { crypto } from "@deno/shim-crypto-next";\n',
      );
      await assertRejects(
        () => patchDntCryptoShim(path),
        Error,
        "does not contain the expected @deno/shim-crypto re-export",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("skips packages without the DNT crypto shim", async () => {
    const directory = await Deno.makeTempDir();
    const path = `${directory}/_dnt.shims.js`;

    try {
      await Deno.writeTextFile(path, "export {};\n");
      assertEquals(await patchDntCryptoShim(path), false);
      assertEquals(await Deno.readTextFile(path), "export {};\n");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
});
