import { dirname, extname, isAbsolute, resolve } from "node:path";
import { createRequire } from "node:module";
import { parseExtensionManifest } from "../manifest-reader.ts";
import type { TypeScriptDecoratorOptions } from "./bundler.ts";

const MAX_TSCONFIG_EXTENDS_DEPTH = 16;

export interface ReadTypeScriptDecoratorOptionsInput {
  readonly configPath: string;
  readonly readTextFile?: (path: string) => Promise<string>;
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
  return extname(path) === "" ? `${path}.json` : path;
}

async function defaultResolveExtends(
  specifier: string,
  fromPath: string,
): Promise<string> {
  if (isAbsolute(specifier) || specifier.startsWith(".")) {
    return withJsonExtension(resolve(dirname(fromPath), specifier));
  }

  const require = createRequire(resolve(dirname(fromPath), "package.json"));
  try {
    return require.resolve(specifier);
  } catch (firstError) {
    try {
      return require.resolve(`${specifier}/tsconfig.json`);
    } catch {
      throw firstError;
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
      throw new Error(
        `TypeScript configuration inheritance exceeds ${MAX_TSCONFIG_EXTENDS_DEPTH} levels`,
      );
    }
    if (active.has(path)) {
      throw new Error("TypeScript configuration inheritance contains a cycle");
    }

    let source: string;
    try {
      source = await readTextFile(path);
    } catch (error) {
      if (root && isMissingFileError(error)) return {};
      throw error;
    }

    active.add(path);
    try {
      const config = parseExtensionManifest<ParsedTypeScriptConfig>(source, "jsonc", path);
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
