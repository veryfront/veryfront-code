const UNSAFE_ARGV_EXPRESSION = "process.argv[1].replace";
const SAFE_ARGV_EXPRESSION = '(process.argv[1] ?? "").replace';

const SHIM_DENO_REEXPORT = 'import { Deno } from "@deno/shim-deno";\n' +
  'export { Deno } from "@deno/shim-deno";\n';

const SHIM_CRYPTO_REEXPORT = 'import { crypto } from "@deno/shim-crypto";\n' +
  'export { crypto } from "@deno/shim-crypto";\n';

/** Marker proving the Deno-global preference is already in place. */
const NATIVE_DENO_MARKER = "dntNativeDeno";

/** Marker proving the crypto-global preference is already in place. */
const NATIVE_CRYPTO_MARKER = "dntNativeCrypto";

const NATIVE_CRYPTO_PREFERENCE =
  "const dntNativeCrypto = globalThis.crypto;\n" +
  "// Web Crypto is a global on every runtime the framework supports (Deno,\n" +
  "// Node 19+, Bun), so `@deno/shim-crypto` is a fallback for runtimes that no\n" +
  "// longer exist in practice. It loads lazily for the same reason the Deno\n" +
  "// shim does: the esm transform rewrites the bare specifier to an absolute\n" +
  "// file:// bundle, and Deno cannot prepare that graph node when node_modules\n" +
  "// is unmanaged.\n" +
  "export const crypto = dntNativeCrypto !== undefined\n" +
  "    ? dntNativeCrypto\n" +
  '    : (await import("@deno/shim-crypto")).crypto;\n';

const NATIVE_DENO_PREFERENCE = "const dntNativeDeno = globalThis.Deno;\n" +
  "// Prefer the host runtime's own Deno. The `@deno/shim-deno` fallback exists\n" +
  "// for Node and Bun; under Deno it shadows working native APIs with node:net\n" +
  "// reimplementations that throw (e.g. Deno.listen reads `server._handle.fd`,\n" +
  "// which is null on Deno's node compatibility layer).\n" +
  "//\n" +
  "// It loads lazily so Deno never resolves it at all. The esm transform\n" +
  "// rewrites the bare specifier to an absolute file:// bundle, and Deno\n" +
  "// refuses to prepare that graph node when node_modules is unmanaged, which\n" +
  '// is what `deno install -g` produces (`nodeModulesDir: "manual"`). A static\n' +
  '// import therefore failed every request with "Loading unprepared module"\n' +
  "// naming a bundle that was present on disk, on the one runtime that never\n" +
  "// reads the value.\n" +
  'export const Deno = typeof dntNativeDeno?.version?.deno === "string"\n' +
  "    ? dntNativeDeno\n" +
  '    : (await import("@deno/shim-deno")).Deno;\n';

export type PatchDntArgvPolyfillOptions = {
  required?: boolean;
};

/**
 * Guard DNT's import-meta shim against runtimes that omit argv[1], including
 * Node and Bun eval mode.
 */
export async function patchDntArgvPolyfill(
  path: string,
  options: PatchDntArgvPolyfillOptions = {},
): Promise<boolean> {
  let source: string;
  try {
    source = await Deno.readTextFile(path);
  } catch (error) {
    if (!options.required && error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }

  const patched = source.replaceAll(
    UNSAFE_ARGV_EXPRESSION,
    SAFE_ARGV_EXPRESSION,
  );
  if (patched !== source) {
    await Deno.writeTextFile(path, patched);
    console.log("Patched DNT process.argv[1] handling");
    return true;
  }

  if (
    options.required &&
    !source.includes(SAFE_ARGV_EXPRESSION)
  ) {
    throw new Error(
      `${path} does not contain the expected process.argv[1] expression. ` +
        "DNT output may have changed.",
    );
  }

  if (
    source.includes("process.argv[1]") &&
    !source.includes(SAFE_ARGV_EXPRESSION)
  ) {
    throw new Error(
      `${path} contains an unrecognized process.argv[1] expression. ` +
        "Update the generated polyfill normalizer before publishing.",
    );
  }

  return false;
}

export type PatchDntDenoShimOptions = {
  required?: boolean;
};

/**
 * Make DNT's generated `_dnt.shims.js` defer to the host runtime's own `Deno`.
 *
 * DNT re-exports `@deno/shim-deno` unconditionally, so every framework module
 * that touches `Deno.*` got the Node reimplementation even when the published
 * package was executed by Deno itself (`deno run -A npm:veryfront dev`). Those
 * reimplementations are not runnable on Deno: `Deno.listen` builds a node:net
 * server and immediately reads `server._handle.fd`, which is null on Deno's
 * node compatibility layer, so the CLI aborted with
 * "Cannot read properties of null (reading 'fd')" before the dev server bound.
 *
 * The shim stays in place for Node and Bun, which have no `Deno` global.
 */
export async function patchDntDenoShim(
  path: string,
  options: PatchDntDenoShimOptions = {},
): Promise<boolean> {
  let source: string;
  try {
    source = await Deno.readTextFile(path);
  } catch (error) {
    if (!options.required && error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }

  if (source.includes(NATIVE_DENO_MARKER)) {
    return false;
  }

  if (source.includes(SHIM_DENO_REEXPORT)) {
    await Deno.writeTextFile(
      path,
      source.replace(SHIM_DENO_REEXPORT, NATIVE_DENO_PREFERENCE),
    );
    console.log("Patched DNT Deno shim to prefer the native Deno global");
    return true;
  }

  if (options.required || source.includes("@deno/shim-deno")) {
    throw new Error(
      `${path} does not contain the expected @deno/shim-deno re-export. ` +
        "DNT output may have changed; update the generated shim normalizer " +
        "before publishing.",
    );
  }

  return false;
}

export type PatchDntCryptoShimOptions = {
  required?: boolean;
};

/**
 * Make DNT's generated `_dnt.shims.js` defer to the host runtime's own
 * `crypto`, and load `@deno/shim-crypto` only where that global is absent.
 *
 * This is the crypto half of the same defect {@link patchDntDenoShim} fixes.
 * DNT imports both shims statically, so every runtime resolves them. The esm
 * transform rewrites those bare specifiers into absolute `file://` bundles,
 * and Deno refuses to prepare such a graph node when `node_modules` is
 * unmanaged — which is exactly what `deno install -g` produces, since it
 * writes `nodeModulesDir: "manual"`. A globally installed CLI therefore failed
 * every request with "Loading unprepared module", naming a bundle that was
 * present on disk.
 *
 * Fixing only the Deno shim is not enough: the crypto import alone keeps the
 * graph unpreparable.
 */
export async function patchDntCryptoShim(
  path: string,
  options: PatchDntCryptoShimOptions = {},
): Promise<boolean> {
  let source: string;
  try {
    source = await Deno.readTextFile(path);
  } catch (error) {
    if (!options.required && error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }

  if (source.includes(NATIVE_CRYPTO_MARKER)) {
    return false;
  }

  if (source.includes(SHIM_CRYPTO_REEXPORT)) {
    await Deno.writeTextFile(
      path,
      source.replace(SHIM_CRYPTO_REEXPORT, NATIVE_CRYPTO_PREFERENCE),
    );
    console.log("Patched DNT crypto shim to prefer the native crypto global");
    return true;
  }

  if (options.required || source.includes("@deno/shim-crypto")) {
    throw new Error(
      `${path} does not contain the expected @deno/shim-crypto re-export. ` +
        "DNT output may have changed; update the generated shim normalizer " +
        "before publishing.",
    );
  }

  return false;
}
