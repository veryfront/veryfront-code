/**
 * Opaque dynamic import helper.
 *
 * Compiles the hidden `import()` expression on first use so importing this
 * module remains safe in runtimes that prohibit dynamic code generation.
 * Bundlers and `deno compile` cannot statically trace the runtime specifier.
 *
 * @module platform/compat
 */

type CompiledDynamicImport = (specifier: string) => Promise<unknown>;
export type DynamicImport = <T = unknown>(specifier: string) => Promise<T>;

function compileOpaqueImporter(): CompiledDynamicImport {
  return new Function("specifier", "return import(specifier)") as CompiledDynamicImport;
}

/** Create a lazily compiled importer. The factory argument supports restricted-runtime testing. */
export function createDynamicImport(
  compile: () => CompiledDynamicImport = compileOpaqueImporter,
): DynamicImport {
  let importer: CompiledDynamicImport | undefined;

  return async <T = unknown>(specifier: string): Promise<T> => {
    if (typeof specifier !== "string" || specifier.length === 0) {
      throw new TypeError("Dynamic import specifier must be a non-empty string");
    }

    if (!importer) {
      const compiled = compile();
      if (typeof compiled !== "function") {
        throw new TypeError("Dynamic import compiler returned an invalid importer");
      }
      importer = compiled;
    }

    return await importer(specifier) as T;
  };
}

export const dynamicImport: DynamicImport = createDynamicImport();
