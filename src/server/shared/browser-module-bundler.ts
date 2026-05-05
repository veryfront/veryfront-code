import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { buildImportMapJson } from "#veryfront/html";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getDirectory, getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import {
  createBareExternalPlugin,
  createHttpExternalPlugin,
  createRelativeFsPlugin,
} from "#veryfront/server/handlers/dev/files/esbuild-plugins.ts";

export interface BrowserModuleBundlerOptions {
  adapter: RuntimeAdapter;
  projectDir: string;
  config?: VeryfrontConfig;
  projectSlug?: string;
}

export function bundleBrowserModule(
  absPath: string,
  options: BrowserModuleBundlerOptions,
): Promise<string> {
  return withSpan(
    "server.browser-module.bundle",
    async () => {
      const { build } = await import("veryfront/extensions/bundler");
      const src = await options.adapter.fs.readFile(absPath);
      const importMapJson = await buildImportMapJson({
        projectDir: options.projectDir,
        config: options.config,
      });
      const importMap = JSON.parse(importMapJson) as { imports?: Record<string, string> };

      const { outputFiles } = await build({
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        target: "es2020",
        jsx: "automatic",
        jsxImportSource: "react",
        external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
        stdin: {
          contents: src,
          loader: getEsbuildLoader(absPath),
          resolveDir: getDirectory(absPath),
          sourcefile: absPath,
        },
        plugins: [
          createRelativeFsPlugin(options.projectDir, options.adapter),
          createBareExternalPlugin({
            importMapImports: importMap.imports,
          }),
          createHttpExternalPlugin(),
        ],
      });

      return outputFiles?.[0]?.text ?? "export default null";
    },
    {
      "bundle.filePath": absPath,
      "bundle.projectSlug": options.projectSlug ?? "unknown",
    },
  );
}
