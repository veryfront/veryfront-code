/**
 * Module Server
 *
 * Serves transformed ESM modules at /_vf_modules/* URLs.
 * Used by client-side for granular module loading and HMR.
 *
 * Security: Uses secure filesystem wrapper to prevent path traversal attacks
 */

import { join } from "std/path/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { type TransformOptions, transformToESM } from "@veryfront/transforms/esm-transform.ts";
import { serverLogger, serverLogger as logger } from "@veryfront/utils";
import { HTTP_NOT_FOUND, HTTP_OK, HTTP_SERVER_ERROR } from "@veryfront/utils";
import { getContentTypeForPath } from "../../server/handlers/utils/content-types.ts";
import { createSecureFs } from "@veryfront/security";

const DEV_MODULE_PREFIX = /^\/(?:_vf_modules|_veryfront\/modules)\//;

export interface ModuleServerOptions {
  /** Project identifier */
  projectId: string;
  /** Project root directory */
  projectDir: string;
  /** Runtime adapter */
  adapter: RuntimeAdapter;
  /** Development mode */
  dev?: boolean;
}

/**
 * Serve module at /_vf_modules/* path
 *
 * Routes:
 * - /_vf_modules/components/app.js → components/app.tsx
 * - /_vf_modules/pages/index.js → pages/index.tsx
 * - /_vf_modules/lib/utils.js → lib/utils.ts
 *
 * Process:
 * 1. Map URL to file path
 * 2. Read source file
 * 3. Transform TS/JSX to ESM (cached)
 * 4. Return with application/javascript content type
 *
 * @param req - HTTP request
 * @param options - Module server options
 * @returns HTTP response with transformed module
 */
export async function serveModule(
  req: Request,
  options: ModuleServerOptions,
): Promise<Response> {
  const { projectId, projectDir, adapter, dev = true } = options;
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const isHeadRequest = method === "HEAD";

  // Create secure filesystem wrapper for module loading
  const secureFs = createSecureFs({
    baseDir: projectDir,
    adapter,
    context: "module-loading",
    throwOnError: false, // Don't throw, return appropriate HTTP error
    onSecurityEvent: (event) => {
      if (event.type === "validation-failed") {
        logger.warn("[ModuleServer] Security validation failed", {
          operation: event.operation,
          path: event.path,
          error: event.error,
        });
      }
    },
  });

  if (!DEV_MODULE_PREFIX.test(url.pathname)) {
    return createModuleResponse(method, "Module not found", HTTP_NOT_FOUND, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    });
  }

  // Extract file path from URL
  // /_vf_modules/components/app.js → components/app
  const modulePath = url.pathname.replace(DEV_MODULE_PREFIX, "");
  const filePathWithoutExt = modulePath.replace(/\.(?:mjs|js)$/i, "");

  try {
    // Find source file (try .tsx, .ts, .jsx, .js, .mdx)
    const sourceFile = await findSourceFile(secureFs, projectDir, filePathWithoutExt);

    if (!sourceFile) {
      logger.warn("Module not found", { modulePath, filePathWithoutExt });
      return new Response("Module not found", {
        status: HTTP_NOT_FOUND,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Read source content
    let code: string | undefined;

    if (!isHeadRequest) {
      const source = await secureFs.readFile(sourceFile);

      // Transform to ESM
      const transformOpts: TransformOptions = { projectId, dev };
      code = await transformToESM(
        source,
        sourceFile, // Pass actual source file path (with .mdx extension)
        projectDir,
        adapter,
        transformOpts,
      );
    }

    const headers = getDevModuleHeaders(modulePath);
    return createModuleResponse(method, code ?? "", HTTP_OK, headers);
  } catch (error) {
    logger.error("Module transform error", {
      modulePath,
      error: error instanceof Error ? error.message : String(error),
    });

    const headers = getDevModuleHeaders(modulePath);
    const errorBody = createDevModuleErrorBody(
      modulePath,
      error instanceof Error ? error.message : String(error),
    );

    return createModuleResponse(method, errorBody, HTTP_SERVER_ERROR, headers);
  }
}

/**
 * Find source file by trying different extensions
 *
 * Tries in order: .tsx, .ts, .jsx, .js, .mdx
 *
 * @param secureFs - Secure filesystem wrapper
 * @param projectDir - Project root directory
 * @param basePath - Base path without extension
 * @returns Full path to source file or null if not found
 */
async function findSourceFile(
  secureFs: ReturnType<typeof createSecureFs>,
  projectDir: string,
  basePath: string,
): Promise<string | null> {
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];

  for (const ext of extensions) {
    const fullPath = join(projectDir, basePath + ext);

    try {
      // Use secure filesystem wrapper (automatic path validation)
      const stat = await secureFs.stat(fullPath);
      if (stat.isFile) {
        return fullPath;
      }
    } catch (error) {
      serverLogger.debug("[ModuleServer] File not found, trying next extension", {
        fullPath,
        error,
      });
    }
  }

  return null;
}

/**
 * Check if request is for a module
 *
 * @param req - HTTP request
 * @returns true if request path starts with /_vf_modules/
 */
export function isModuleRequest(req: Request): boolean {
  const url = new URL(req.url);
  return DEV_MODULE_PREFIX.test(url.pathname);
}

function getDevModuleHeaders(modulePath: string): Record<string, string> {
  const contentType = getDevModuleContentType(modulePath);
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
  };
}

function getDevModuleContentType(modulePath: string): string {
  const normalizedPath = modulePath.toLowerCase();

  if (normalizedPath.endsWith(".map") || normalizedPath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  if (normalizedPath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  const detected = getContentTypeForPath(normalizedPath);
  return detected ?? "application/javascript; charset=utf-8";
}

function createDevModuleErrorBody(modulePath: string, errorMessage: string): string {
  const normalizedPath = modulePath.toLowerCase();

  if (normalizedPath.endsWith(".css")) {
    const sanitized = errorMessage.replace(/\*\//g, "*\\/");
    return `/* Transform Error: ${sanitized} */`;
  }

  if (normalizedPath.endsWith(".json") || normalizedPath.endsWith(".map")) {
    return JSON.stringify({ error: errorMessage });
  }

  return `// Transform Error\nthrow new Error(${JSON.stringify(errorMessage)});`;
}

function createModuleResponse(
  method: string,
  body: string,
  status: number,
  headers: Record<string, string>,
): Response {
  if (method === "HEAD") {
    return new Response(null, { status, headers });
  }

  return new Response(body, { status, headers });
}
