const UNSAFE_ARGV_EXPRESSION = "process.argv[1].replace";
const SAFE_ARGV_EXPRESSION = '(process.argv[1] ?? "").replace';

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
