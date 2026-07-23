/**
 * JSX/TypeScript transform using native esbuild.
 * @see ./esbuild.ts for deno compile VFS extraction
 */

import { getEsbuild, initializeEsbuild } from "./esbuild.ts";

export interface TransformResult {
  code: string;
}

export interface TransformOptions {
  loader?: "tsx" | "jsx" | "ts" | "js";
}

export async function transformJsx(
  source: string,
  options: TransformOptions = {},
): Promise<TransformResult> {
  const esbuild = await getEsbuild();
  const result = await esbuild.transform(source, {
    loader: options.loader ?? "tsx",
    jsx: "automatic",
    jsxImportSource: "react",
    format: "esm",
    target: "es2020",
  });

  return { code: result.code };
}

/** Call at server startup to ensure esbuild binary is available. */
export async function initializeTransform(): Promise<void> {
  // The bundler registry owns initialization and idempotency. Keeping a second
  // boolean here allowed concurrent callers to observe an unrelated local
  // state and could become stale when the registered bundler changed.
  await initializeEsbuild();
}

export function isUsingEsbuild(): boolean {
  return true;
}
