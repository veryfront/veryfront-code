/**
 * JSX/TypeScript Transform Utility
 *
 * Uses esbuild for development (native binaries available).
 * Falls back to sucrase when esbuild fails (deno compile - no native binaries in VFS).
 */

import * as esbuild from "esbuild";
import { transform as sucraseTransform } from "npm:sucrase@3.35.0";

let useEsbuild = true;
let esbuildInitialized = false;

export interface TransformResult {
  code: string;
}

export interface TransformOptions {
  loader?: "tsx" | "jsx" | "ts" | "js";
}

/**
 * Transform JSX/TSX source to JavaScript.
 * Tries native esbuild first, falls back to sucrase if unavailable.
 */
export async function transformJsx(
  source: string,
  options: TransformOptions = {},
): Promise<TransformResult> {
  const loader = options.loader ?? "tsx";

  // Try esbuild first (faster, full feature support)
  if (useEsbuild) {
    try {
      if (!esbuildInitialized) {
        await esbuild.initialize({ worker: false });
        esbuildInitialized = true;
      }

      const result = await esbuild.transform(source, {
        loader,
        jsx: "automatic",
        jsxImportSource: "react",
        format: "esm",
        target: "es2020",
      });

      return { code: result.code };
    } catch (err) {
      // Check if it's the ENOENT error from deno compile
      if (err instanceof Error && err.message.includes("ENOENT")) {
        useEsbuild = false;
        // Fall through to sucrase
      } else {
        throw err;
      }
    }
  }

  // Fallback to sucrase (pure JS, works in deno compile)
  const transforms: Array<"typescript" | "jsx"> = [];
  if (loader === "tsx" || loader === "ts") {
    transforms.push("typescript");
  }
  if (loader === "tsx" || loader === "jsx") {
    transforms.push("jsx");
  }

  const result = sucraseTransform(source, {
    transforms,
    jsxRuntime: "automatic",
    jsxImportSource: "react",
    production: true,
  });

  return { code: result.code };
}

/**
 * Initialize the transform system.
 * Call at server startup to warm up esbuild or detect fallback early.
 */
export async function initializeTransform(): Promise<void> {
  try {
    if (!esbuildInitialized) {
      await esbuild.initialize({ worker: false });
      esbuildInitialized = true;
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("ENOENT")) {
      useEsbuild = false;
    } else {
      throw err;
    }
  }
}

/**
 * Check if we're using esbuild (native) or sucrase (fallback)
 */
export function isUsingEsbuild(): boolean {
  return useEsbuild;
}
