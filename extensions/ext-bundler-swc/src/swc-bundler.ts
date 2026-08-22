import { type Options as SwcOptions, transform as transformWithSwc } from "@swc/wasm";
import { EsbuildBundler } from "@veryfront/ext-bundler-esbuild";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
import type {
  BuildContext,
  BundleOptions,
  Bundler,
  BundleResult,
  BundlerPlugin,
  BundlerPluginBuild,
  Loader,
  OnLoadResult,
  TransformOptions,
  TransformResult,
  TypeScriptDecoratorOptions,
} from "veryfront/extensions/bundler";
import { readTypeScriptDecoratorOptions } from "veryfront/extensions/bundler";

const REFLECT_METADATA_SPECIFIER = "veryfront:swc-reflect-metadata";
const textDecoder = new TextDecoder();
const require = createRequire(import.meta.url);
let reflectMetadataSourcePromise: Promise<string> | undefined;

type TsconfigRaw = {
  readonly compilerOptions?: {
    readonly experimentalDecorators?: unknown;
    readonly emitDecoratorMetadata?: unknown;
  };
};

export interface SwcBundlerOptions {
  /** @internal Test seam for the graph-bundling delegate. */
  readonly delegate?: Bundler;
}

function rawDecoratorOptions(value: unknown): TypeScriptDecoratorOptions | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const compilerOptionsDescriptor = Reflect.getOwnPropertyDescriptor(value, "compilerOptions");
  const compilerOptions = compilerOptionsDescriptor?.value;
  if (compilerOptions === null || typeof compilerOptions !== "object") return undefined;
  const experimentalDecorators = Reflect.getOwnPropertyDescriptor(
    compilerOptions,
    "experimentalDecorators",
  )?.value;
  const emitDecoratorMetadata = Reflect.getOwnPropertyDescriptor(
    compilerOptions,
    "emitDecoratorMetadata",
  )?.value;
  return {
    experimentalDecorators: experimentalDecorators === true,
    emitDecoratorMetadata: emitDecoratorMetadata === true,
  };
}

function workingDirectory(options: BundleOptions | TransformOptions): string {
  const explicit = options.absWorkingDir;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  if ("stdin" in options) {
    const resolveDir = (options as BundleOptions).stdin?.resolveDir;
    if (typeof resolveDir === "string" && resolveDir.length > 0) return resolveDir;
  }
  return process.cwd();
}

async function decoratorOptions(
  options: BundleOptions | TransformOptions,
): Promise<TypeScriptDecoratorOptions> {
  if ("typescriptDecoratorOptions" in options) {
    const resolved = rawDecoratorOptions({
      compilerOptions: options.typescriptDecoratorOptions,
    });
    if (resolved) return resolved;
  }
  const raw = rawDecoratorOptions(options.tsconfigRaw as TsconfigRaw | undefined);
  if (raw) return raw;

  const configPath = typeof options.tsconfig === "string"
    ? options.tsconfig
    : join(workingDirectory(options), "tsconfig.json");
  return await readTypeScriptDecoratorOptions({ configPath });
}

function isTypeScriptLoader(loader: unknown): loader is "ts" | "tsx" {
  return loader === "ts" || loader === "tsx";
}

function loaderForPath(path: string): "ts" | "tsx" | undefined {
  const extension = extname(path).toLowerCase();
  if (extension === ".ts" || extension === ".mts" || extension === ".cts") return "ts";
  if (extension === ".tsx") return "tsx";
  return undefined;
}

function sourceText(contents: string | Uint8Array): string {
  return typeof contents === "string" ? contents : textDecoder.decode(contents);
}

type SupportedSwcTarget =
  | "es3"
  | "es5"
  | "es2015"
  | "es2016"
  | "es2017"
  | "es2018"
  | "es2019"
  | "es2020"
  | "es2021"
  | "es2022";

function swcTarget(
  target: TransformOptions["target"] | BundleOptions["target"],
): SupportedSwcTarget {
  const value = Array.isArray(target) ? target[0] : target;
  if (
    value === "es3" || value === "es5" || value === "es2015" ||
    value === "es2016" || value === "es2017" || value === "es2018" ||
    value === "es2019" || value === "es2020" || value === "es2021" ||
    value === "es2022"
  ) return value;
  return "es2022";
}

type SwcTransformConfig = NonNullable<NonNullable<SwcOptions["jsc"]>["transform"]>;

function reactTransform(options: BundleOptions | TransformOptions): SwcTransformConfig {
  const runtime = options.jsx === "preserve"
    ? "preserve"
    : options.jsx === "automatic"
    ? "automatic"
    : "classic";
  return {
    legacyDecorator: true,
    decoratorMetadata: true,
    react: {
      runtime,
      importSource: options.jsxImportSource,
    },
  };
}

async function transformTypeScript(
  code: string,
  loader: "ts" | "tsx",
  filename: string,
  flags: TypeScriptDecoratorOptions,
  options: BundleOptions | TransformOptions,
): Promise<string> {
  const transform = reactTransform(options);
  transform.decoratorMetadata = flags.emitDecoratorMetadata;
  const result = await transformWithSwc(code, {
    filename,
    swcrc: false,
    configFile: false,
    sourceMaps: false,
    module: { type: "es6" },
    jsc: {
      parser: {
        syntax: "typescript",
        tsx: loader === "tsx",
        decorators: true,
        dynamicImport: true,
      },
      target: swcTarget(options.target),
      keepClassNames: options.keepNames === true,
      transform,
    },
  });
  return result.code;
}

async function reflectMetadataSource(): Promise<string> {
  reflectMetadataSourcePromise ??= readFile(
    require.resolve("reflect-metadata/lite"),
    "utf8",
  );
  return await reflectMetadataSourcePromise;
}

function wrapPlugin(
  plugin: BundlerPlugin,
  flags: TypeScriptDecoratorOptions,
  options: BundleOptions,
): BundlerPlugin {
  return {
    name: plugin.name,
    setup(build) {
      const wrappedBuild: BundlerPluginBuild = {
        onResolve: build.onResolve.bind(build),
        onDispose: build.onDispose.bind(build),
        onLoad(loadOptions, callback) {
          build.onLoad(loadOptions, async (args) => {
            const result = await callback(args);
            if (!result?.contents) return result;
            const loader = isTypeScriptLoader(result.loader)
              ? result.loader
              : loaderForPath(args.path);
            if (!loader) return result;
            return {
              ...result,
              contents: await transformTypeScript(
                sourceText(result.contents),
                loader,
                args.path,
                flags,
                options,
              ),
              loader: "js",
            } satisfies OnLoadResult;
          });
        },
      };
      return plugin.setup(wrappedBuild);
    },
  };
}

function createReflectMetadataPlugin(): BundlerPlugin {
  return {
    name: "veryfront-swc-reflect-metadata",
    setup(build) {
      build.onResolve({ filter: /^veryfront:swc-reflect-metadata$/ }, () => ({
        path: REFLECT_METADATA_SPECIFIER,
        namespace: "veryfront-swc-reflect-metadata",
      }));
      build.onLoad(
        { filter: /.*/, namespace: "veryfront-swc-reflect-metadata" },
        async () => ({ contents: await reflectMetadataSource(), loader: "js" }),
      );
    },
  };
}

function createSwcFallbackPlugin(
  flags: TypeScriptDecoratorOptions,
  options: BundleOptions,
): BundlerPlugin {
  return {
    name: "veryfront-swc-typescript",
    setup(build) {
      build.onLoad({ filter: /\.(?:[cm]?ts|tsx)$/ }, async (args) => {
        const loader = loaderForPath(args.path);
        if (!loader) return undefined;
        options.signal?.throwIfAborted();
        const code = await readFile(args.path, "utf8");
        const contents = await transformTypeScript(code, loader, args.path, flags, options);
        options.signal?.throwIfAborted();
        return { contents, loader: "js" };
      });
    },
  };
}

function withReflectionImport(source: string, flags: TypeScriptDecoratorOptions): string {
  return flags.emitDecoratorMetadata
    ? `import "${REFLECT_METADATA_SPECIFIER}";\n${source}`
    : source;
}

function delegateBundleOptions(options: BundleOptions): BundleOptions {
  if (!("typescriptDecoratorOptions" in options)) return options;
  const {
    typescriptDecoratorOptions: _typescriptDecoratorOptions,
    ...delegateOptions
  } = options;
  return delegateOptions;
}

function delegateTransformOptions(options: TransformOptions): TransformOptions {
  if (
    !("absWorkingDir" in options) &&
    !("tsconfig" in options) &&
    !("typescriptDecoratorOptions" in options)
  ) return options;
  const {
    absWorkingDir: _absWorkingDir,
    tsconfig: _tsconfig,
    typescriptDecoratorOptions: _typescriptDecoratorOptions,
    ...delegateOptions
  } = options;
  return delegateOptions;
}

async function prepareLegacyDecoratorBundle(
  options: BundleOptions,
  flags: TypeScriptDecoratorOptions,
): Promise<BundleOptions> {
  const stdin = options.stdin;
  const transformedStdin = stdin && isTypeScriptLoader(stdin.loader)
    ? {
      ...stdin,
      contents: withReflectionImport(
        await transformTypeScript(
          stdin.contents,
          stdin.loader,
          stdin.sourcefile ?? "stdin.ts",
          flags,
          options,
        ),
        flags,
      ),
      loader: "js" as Loader,
    }
    : stdin;
  const plugins = [
    createReflectMetadataPlugin(),
    ...(options.plugins ?? []).map((plugin) => wrapPlugin(plugin, flags, options)),
    createSwcFallbackPlugin(flags, options),
  ];

  return {
    ...delegateBundleOptions(options),
    stdin: transformedStdin,
    plugins,
  };
}

/**
 * SWC-backed legacy TypeScript transform with esbuild graph bundling.
 *
 * SWC runs only when `experimentalDecorators` is enabled. All other source is
 * delegated unchanged, which keeps standard decorators on the default esbuild
 * behavior even when a project has selected this extension.
 */
export class SwcBundler implements Bundler {
  readonly forceBundleTypeScript = true;
  readonly #delegate: Bundler;

  constructor(options: SwcBundlerOptions = {}) {
    this.#delegate = options.delegate ?? new EsbuildBundler();
  }

  async bundle(options: BundleOptions): Promise<BundleResult> {
    const flags = await decoratorOptions(options);
    if (!flags.experimentalDecorators) {
      return await this.#delegate.bundle(delegateBundleOptions(options));
    }

    return await this.#delegate.bundle(
      await prepareLegacyDecoratorBundle(options, flags),
    );
  }

  async transform(options: TransformOptions): Promise<TransformResult> {
    const flags = await decoratorOptions(options);
    if (!flags.experimentalDecorators || !isTypeScriptLoader(options.loader)) {
      return await this.#delegate.transform(delegateTransformOptions(options));
    }

    let code = await transformTypeScript(
      options.code,
      options.loader,
      typeof options.sourcefile === "string" ? options.sourcefile : "stdin.ts",
      flags,
      options,
    );
    if (flags.emitDecoratorMetadata) {
      code = `${await reflectMetadataSource()}\n${code}`;
    }
    const delegateOptions = delegateTransformOptions(options);
    return await this.#delegate.transform({
      ...delegateOptions,
      code,
      loader: "js",
    });
  }

  async context(options: BundleOptions): Promise<BuildContext> {
    if (!this.#delegate.context) {
      throw new Error("The SWC bundler delegate does not support incremental builds");
    }
    const flags = await decoratorOptions(options);
    if (!flags.experimentalDecorators) {
      return await this.#delegate.context(delegateBundleOptions(options));
    }
    return await this.#delegate.context(
      await prepareLegacyDecoratorBundle(options, flags),
    );
  }

  async stop(): Promise<void> {
    await this.#delegate.stop?.();
  }
}
