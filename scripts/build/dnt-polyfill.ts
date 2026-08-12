const UNSAFE_ARGV_EXPRESSION = "process.argv[1].replace";
const SAFE_ARGV_EXPRESSION = '(process.argv[1] ?? "").replace';

const SHIM_DENO_REEXPORT = 'import { Deno } from "@deno/shim-deno";\n' +
  'export { Deno } from "@deno/shim-deno";\n';

/** Marker proving the Deno-global preference is already in place. */
const NATIVE_DENO_MARKER = "dntNativeDeno";

const NATIVE_DENO_PREFERENCE =
  'import { Deno as dntShimDeno } from "@deno/shim-deno";\n' +
  "const dntNativeDeno = globalThis.Deno;\n" +
  "// Prefer the host runtime's own Deno. The `@deno/shim-deno` fallback exists\n" +
  "// for Node and Bun; under Deno it shadows working native APIs with node:net\n" +
  "// reimplementations that throw (e.g. Deno.listen reads `server._handle.fd`,\n" +
  "// which is null on Deno's node compatibility layer).\n" +
  'export const Deno = typeof dntNativeDeno?.version?.deno === "string"\n' +
  "    ? dntNativeDeno\n" +
  "    : dntShimDeno;\n";

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
