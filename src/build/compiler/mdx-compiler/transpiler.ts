import * as esbuild from "esbuild/mod.js"; // Native esbuild
import type { CompileOptions } from "./types.ts";

export async function transpileCode(code: string, options: CompileOptions): Promise<string> {
  const result = await esbuild.transform(code, {
    loader: "jsx",
    jsx: "automatic",
    jsxImportSource: "react",
    format: "esm",
    target: options.mode === "development" ? "es2020" : "es2018",
    minify: options.mode === "production",
  });

  return result.code;
}
