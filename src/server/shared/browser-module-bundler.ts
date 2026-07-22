import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { basename, relative } from "#veryfront/compat/path/index.ts";
import type { OnLoadArgs, OnResolveArgs, Plugin, PluginBuild } from "veryfront/extensions/bundler";
import { buildImportMapJson } from "#veryfront/html";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getDirectory, getEsbuildLoader, isWithinDirectory } from "#veryfront/utils/path-utils.ts";
import {
  createBareExternalPlugin,
  createHttpExternalPlugin,
  createRelativeFsPlugin,
  inspectBrowserModulePath,
} from "#veryfront/server/handlers/dev/files/esbuild-plugins.ts";
import {
  describeBrowserModuleBoundaryViolation,
  inspectBrowserModuleBoundary,
} from "./browser-module-boundary.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

function createIgnoreCSSImportsPlugin(): Plugin {
  return {
    name: "veryfront-ignore-css-imports",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /\.css(?:\?.*)?$/ }, (args: OnResolveArgs) => ({
        path: args.path,
        namespace: "veryfront-empty-css",
      }));
      build.onLoad({ filter: /.*/, namespace: "veryfront-empty-css" }, (_args: OnLoadArgs) => ({
        contents: "",
        loader: "js",
      }));
    },
  };
}

export interface BrowserModuleBundlerOptions {
  adapter: RuntimeAdapter;
  projectDir: string;
  config?: VeryfrontConfig;
  projectSlug?: string;
  importMapJson?: string;
}

export function getSafeBrowserModuleIdentity(absPath: string, projectDir: string): string {
  if (!isWithinDirectory(projectDir, absPath)) return `/${basename(absPath)}`;

  const projectRelativePath = relative(projectDir, absPath).replaceAll("\\", "/");
  return projectRelativePath === "." ? `/${basename(absPath)}` : `/${projectRelativePath}`;
}

type ResolutionProbeState = "file" | "directory" | "other" | "missing";

export interface BrowserModuleBundle {
  source: string;
  contentHash: string;
  importMapHash: string;
  dependencies: ReadonlyArray<{ path: string; contentHash: string }>;
  resolutionProbes: ReadonlyArray<{ path: string; state: ResolutionProbeState }>;
}

interface TrackingAdapterResult {
  adapter: RuntimeAdapter;
  contents: Map<string, string>;
  probes: Map<string, ResolutionProbeState>;
}

function createTrackingAdapter(adapter: RuntimeAdapter): TrackingAdapterResult {
  const contents = new Map<string, string>();
  const probes = new Map<string, ResolutionProbeState>();
  const trackedFs = new Proxy(adapter.fs, {
    get(target, property, receiver) {
      if (property === "readFile") {
        return async (path: string) => {
          const content = await target.readFile(path);
          contents.set(path, content);
          return content;
        };
      }
      if (property === "stat") {
        return async (path: string) => {
          try {
            const info = await target.stat(path);
            probes.set(
              path,
              info.isFile ? "file" : info.isDirectory ? "directory" : "other",
            );
            return info;
          } catch (error) {
            probes.set(path, "missing");
            throw error;
          }
        };
      }

      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const trackedAdapter = new Proxy(adapter, {
    get(target, property, receiver) {
      if (property === "fs") return trackedFs;
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { adapter: trackedAdapter, contents, probes };
}

export function bundleBrowserModule(
  absPath: string,
  options: BrowserModuleBundlerOptions,
): Promise<string> {
  return bundleBrowserModuleWithMetadata(absPath, options).then((bundle) => bundle.source);
}

export function bundleBrowserModuleWithMetadata(
  absPath: string,
  options: BrowserModuleBundlerOptions,
): Promise<BrowserModuleBundle> {
  return withSpan(
    "server.browser-module.bundle",
    async () => {
      const tracked = createTrackingAdapter(options.adapter);
      const entryPathStatus = await inspectBrowserModulePath(
        options.projectDir,
        absPath,
        tracked.adapter,
      );
      if (entryPathStatus !== "trusted") {
        throw new Error("Browser module entry path is not trusted");
      }

      const { build } = await import("veryfront/extensions/bundler");
      const src = await tracked.adapter.fs.readFile(absPath);
      const boundaryViolation = await inspectBrowserModuleBoundary(src, absPath);
      if (boundaryViolation) {
        throw new Error(describeBrowserModuleBoundaryViolation(boundaryViolation));
      }
      const importMapJson = options.importMapJson ?? await buildImportMapJson({
        projectDir: options.projectDir,
        config: options.config,
      });
      const importMap = JSON.parse(importMapJson) as { imports?: Record<string, string> };

      const { outputFiles } = await build({
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        target: "es2022",
        jsx: "automatic",
        jsxImportSource: "react",
        external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
        stdin: {
          contents: src,
          loader: getEsbuildLoader(absPath),
          resolveDir: getDirectory(absPath),
          sourcefile: getSafeBrowserModuleIdentity(absPath, options.projectDir),
        },
        plugins: [
          createIgnoreCSSImportsPlugin(),
          createRelativeFsPlugin(options.projectDir, tracked.adapter, {
            enforceBrowserBoundaries: true,
          }),
          createBareExternalPlugin({
            importMapImports: importMap.imports,
          }),
          createHttpExternalPlugin(),
        ],
      });

      const output = outputFiles?.[0];
      if (!output) {
        throw new Error("Browser module bundler produced no output");
      }
      const source = output.text;
      const dependencies = await Promise.all(
        [...tracked.contents.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(async ([path, content]) => ({
            path,
            contentHash: await computeHash(content),
          })),
      );
      const resolutionProbes = [...tracked.probes.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, state]) => ({ path, state }));

      return {
        source,
        contentHash: await computeHash(source),
        importMapHash: await computeHash(importMapJson),
        dependencies,
        resolutionProbes,
      };
    },
    {
      "bundle.filePath": getSafeBrowserModuleIdentity(absPath, options.projectDir),
      "bundle.projectSlug": options.projectSlug ?? "unknown",
    },
  );
}

export async function validateBrowserModuleBundle(
  bundle: BrowserModuleBundle,
  options: Pick<BrowserModuleBundlerOptions, "adapter" | "projectDir">,
): Promise<boolean> {
  for (const dependency of bundle.dependencies) {
    if (!isWithinDirectory(options.projectDir, dependency.path)) return false;
    if (
      await inspectBrowserModulePath(options.projectDir, dependency.path, options.adapter) !==
        "trusted"
    ) return false;

    try {
      if (
        await computeHash(await options.adapter.fs.readFile(dependency.path)) !==
          dependency.contentHash
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }

  for (const probe of bundle.resolutionProbes) {
    if (!isWithinDirectory(options.projectDir, probe.path)) return false;
    let currentState: ResolutionProbeState;
    try {
      const info = await options.adapter.fs.stat(probe.path);
      currentState = info.isFile ? "file" : info.isDirectory ? "directory" : "other";
    } catch {
      currentState = "missing";
    }
    if (currentState !== probe.state) return false;
  }

  return true;
}
