import { dirname, extname, isAbsolute, resolve } from "node:path";
import { createRequire } from "node:module";
import { parseExtensionManifest } from "#veryfront/extensions/manifest-reader.ts";
import { defineError } from "#veryfront/errors/types.ts";
import type { TypeScriptDecoratorOptions } from "./bundler.ts";

const MAX_TSCONFIG_EXTENDS_DEPTH = 16;
const TSCONFIG_DIAGNOSTIC_PATH = "tsconfig.json";

const TSCONFIG_DEPTH_ERROR = defineError({
  slug: "tsconfig-inheritance-too-deep",
  category: "CONFIG",
  status: 422,
  title: "TypeScript configuration inheritance is too deep",
  suggestion:
    `Keep tsconfig.json "extends" chains at or below ${MAX_TSCONFIG_EXTENDS_DEPTH} levels`,
});

const TSCONFIG_CYCLE_ERROR = defineError({
  slug: "tsconfig-inheritance-cycle",
  category: "CONFIG",
  status: 422,
  title: "TypeScript configuration inheritance contains a cycle",
  suggestion: 'Remove the tsconfig.json "extends" entry that points back at an ancestor',
});

const TSCONFIG_READ_ERROR = defineError({
  slug: "tsconfig-read-failed",
  category: "CONFIG",
  status: 422,
  title: "TypeScript configuration could not be read",
  suggestion: 'Check the tsconfig.json "extends" entry and filesystem permissions',
});

/**
 * Input for {@link readTypeScriptDecoratorOptions}.
 *
 * `configPath` is the root `tsconfig.json` to read. The two optional hooks let
 * a caller supply its own I/O: `readTextFile` replaces the default
 * `node:fs/promises` read, so a sandboxed or snapshot-backed caller can stay
 * inside its own boundary, and `resolveExtends` replaces the default Node
 * resolution of an `extends` specifier.
 */
export interface ReadTypeScriptDecoratorOptionsInput {
  /** Root TypeScript configuration to read. A missing file resolves to both flags off. */
  readonly configPath: string;
  /** Read one configuration file. Defaults to `node:fs/promises`. */
  readonly readTextFile?: (path: string) => Promise<string>;
  /** Resolve one `extends` specifier to a path. Defaults to Node resolution. */
  readonly resolveExtends?: (specifier: string, fromPath: string) => Promise<string>;
}

interface ParsedTypeScriptConfig {
  readonly extends?: unknown;
  readonly compilerOptions?: unknown;
}

type PartialDecoratorOptions = {
  experimentalDecorators?: boolean;
  emitDecoratorMetadata?: boolean;
};

function isMissingFileError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const descriptor = Reflect.getOwnPropertyDescriptor(error, "code");
  return descriptor?.value === "ENOENT" || descriptor?.value === "NotFound";
}

async function defaultReadTextFile(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return await readFile(path, "utf8");
}

function withJsonExtension(path: string): string {
  const extension = extname(path).toLowerCase();
  return extension === ".json" || extension === ".jsonc" ? path : `${path}.json`;
}

function defaultResolveExtends(
  specifier: string,
  fromPath: string,
): Promise<string> {
  if (isAbsolute(specifier) || specifier.startsWith(".")) {
    return Promise.resolve(withJsonExtension(resolve(dirname(fromPath), specifier)));
  }

  const require = createRequire(resolve(dirname(fromPath), "package.json"));
  try {
    return Promise.resolve(require.resolve(specifier));
  } catch (firstError) {
    try {
      return Promise.resolve(require.resolve(`${specifier}/tsconfig.json`));
    } catch {
      return Promise.reject(firstError);
    }
  }
}

function inheritedSpecifiers(value: unknown): string[] {
  if (typeof value === "string" && value.length > 0) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function ownBoolean(value: unknown, key: keyof TypeScriptDecoratorOptions): boolean | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  return typeof descriptor?.value === "boolean" ? descriptor.value : undefined;
}

function localDecoratorOptions(config: ParsedTypeScriptConfig): PartialDecoratorOptions {
  const compilerOptions = config.compilerOptions;
  const options: PartialDecoratorOptions = {};
  const experimentalDecorators = ownBoolean(compilerOptions, "experimentalDecorators");
  const emitDecoratorMetadata = ownBoolean(compilerOptions, "emitDecoratorMetadata");
  if (experimentalDecorators !== undefined) {
    options.experimentalDecorators = experimentalDecorators;
  }
  if (emitDecoratorMetadata !== undefined) {
    options.emitDecoratorMetadata = emitDecoratorMetadata;
  }
  return options;
}

/**
 * Resolve the two legacy-decorator flags from a TypeScript configuration.
 *
 * JSONC parsing reuses the framework manifest parser. Inheritance is bounded,
 * cycle checked, and merged in TypeScript precedence order: later parents win,
 * then the child config overrides them.
 */
export async function readTypeScriptDecoratorOptions(
  input: ReadTypeScriptDecoratorOptionsInput,
): Promise<TypeScriptDecoratorOptions> {
  const readTextFile = input.readTextFile ?? defaultReadTextFile;
  const resolveExtends = input.resolveExtends ?? defaultResolveExtends;
  const cache = new Map<string, PartialDecoratorOptions>();
  const active = new Set<string>();

  const read = async (
    path: string,
    depth: number,
    root: boolean,
  ): Promise<PartialDecoratorOptions> => {
    const cached = cache.get(path);
    if (cached) return cached;
    if (depth > MAX_TSCONFIG_EXTENDS_DEPTH) {
      throw TSCONFIG_DEPTH_ERROR.create({
        detail: `TypeScript configuration inheritance exceeds ${MAX_TSCONFIG_EXTENDS_DEPTH} levels`,
      });
    }
    if (active.has(path)) {
      throw TSCONFIG_CYCLE_ERROR.create({
        detail: "TypeScript configuration inheritance contains a cycle",
      });
    }

    let source: string;
    try {
      source = await readTextFile(path);
    } catch (error) {
      if (root && isMissingFileError(error)) return {};
      throw TSCONFIG_READ_ERROR.create({
        detail: root
          ? "TypeScript configuration could not be read"
          : "Inherited TypeScript configuration could not be read",
        cause: new Error("TypeScript configuration read failed"),
      });
    }

    active.add(path);
    try {
      const config = parseExtensionManifest<ParsedTypeScriptConfig>(
        source,
        "jsonc",
        TSCONFIG_DIAGNOSTIC_PATH,
      );
      let merged: PartialDecoratorOptions = {};
      for (const specifier of inheritedSpecifiers(config.extends)) {
        const parentPath = await resolveExtends(specifier, path);
        merged = { ...merged, ...await read(parentPath, depth + 1, false) };
      }
      merged = { ...merged, ...localDecoratorOptions(config) };
      cache.set(path, merged);
      return merged;
    } finally {
      active.delete(path);
    }
  };

  const options = await read(input.configPath, 0, true);
  return Object.freeze({
    experimentalDecorators: options.experimentalDecorators === true,
    emitDecoratorMetadata: options.emitDecoratorMetadata === true,
  });
}
