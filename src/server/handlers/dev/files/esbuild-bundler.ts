
import type { HandlerContext } from "../../types.ts";
import type { BuildResult } from "esbuild";
import { getDirectory } from "@veryfront/utils/path-utils.ts";
import { createBareExternalPlugin, createRelativeFsPlugin } from "./esbuild-plugins.ts";

export async function bundleDevFile(
  absPath: string,
  ctx: HandlerContext,
): Promise<string> {
  const { build } = await import("esbuild");
  const src = await ctx.adapter.fs.readFile(absPath);
  const isTs = /\.(tsx?|mts|cts)$/i.test(absPath);
  const isTsx = /\.tsx$/i.test(absPath);
  const isJsx = /\.jsx$/i.test(absPath);

  const result: BuildResult = await build({
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
      loader: isTs ? (isTsx ? "tsx" : "ts") : isJsx ? "jsx" : "js",
      resolveDir: getDirectory(absPath),
      sourcefile: absPath,
    },
    plugins: [
      createRelativeFsPlugin(ctx.projectDir, ctx.adapter),
      createBareExternalPlugin(),
    ],
  });

  const code = result.outputFiles?.[0]?.text ?? "export default null";
  return code;
}
