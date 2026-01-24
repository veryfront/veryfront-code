import type { HandlerContext } from "../../types.ts";
import { getDirectory, getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import { createBareExternalPlugin, createRelativeFsPlugin } from "./esbuild-plugins.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export function bundleDevFile(absPath: string, ctx: HandlerContext): Promise<string> {
  return withSpan(
    "server.dev.esbuild.bundleFile",
    async () => {
      const { build } = await import("esbuild");
      const src = await ctx.adapter.fs.readFile(absPath);

      const result = await build({
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
          createRelativeFsPlugin(ctx.projectDir, ctx.adapter),
          createBareExternalPlugin(),
        ],
      });

      return result.outputFiles?.[0]?.text ?? "export default null";
    },
    { "bundle.filePath": absPath, "bundle.projectSlug": ctx.projectSlug ?? "unknown" },
  );
}
