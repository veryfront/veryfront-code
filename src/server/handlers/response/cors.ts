
import { BaseHandler } from "./base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
  RouteHandlerModule,
} from "../types.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";
import { joinPath } from "@veryfront/utils/path-utils.ts";
import { getConfig } from "@veryfront/config";
import { PRIORITY_VERY_HIGH } from "@veryfront/core/constants/index.ts";

export class CorsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "CorsHandler",
    priority: PRIORITY_VERY_HIGH as HandlerPriority,
    patterns: [
      { pattern: /.*/, method: "OPTIONS" },
    ],
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (req.method.toUpperCase() !== "OPTIONS") {
      return this.continue();
    }

    const url = new URL(req.url);
    const pathname = url.pathname;

    let allowMethods = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
    try {
      const match = await this.resolveAppRouteFile(pathname, ctx);
      if (match) {
        const mod = await import(`file://${match.file}`) as RouteHandlerModule;
        const has = (name: string) => typeof mod[name] === "function";
        const base: string[] = [];
        for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
          if (has(m)) base.push(m);
        }
        if (base.includes("GET") && !base.includes("HEAD")) {
          base.unshift("HEAD");
        }
        base.push("OPTIONS");
        if (base.length > 0) {
          allowMethods = Array.from(new Set(base)).join(", ");
        }
      }
    } catch (err) {
      this.logDebug("Failed to resolve route for CORS", { error: err, pathname }, ctx);
    }

    let corsConfig = ctx.securityConfig?.cors;
    try {
      const cfg = await getConfig(ctx.projectDir, ctx.adapter);
      corsConfig = cfg?.security?.cors || corsConfig;
    } catch (err) {
      this.logDebug("Failed to load CORS config", { error: err }, ctx);
    }

    const response = ResponseBuilder.preflight(req, {
      allowMethods,
      allowHeaders: req.headers.get("access-control-request-headers") ||
        "Content-Type,Authorization",
      securityConfig: ctx.securityConfig ?? undefined,
      corsConfig,
    });

    return this.respond(response);
  }

  private async resolveAppRouteFile(
    path: string,
    ctx: HandlerContext,
  ): Promise<{ file: string; params: Record<string, string | string[]> } | null> {
    const appRoot = joinPath(ctx.projectDir, "app");

    try {
      const st = await ctx.adapter.fs.stat(appRoot);
      if (!st.isDirectory) return null;
    } catch (err) {
      this.logDebug("App directory not found", { appRoot, error: err }, ctx);
      return null;
    }

    const normalized = path === "/" ? "/" : path.replace(/\/$/, "");
    const segments = normalized.split("/").filter(Boolean);
    let current = appRoot;
    const params: Record<string, string | string[]> = {};

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;

      const names: string[] = [];
      try {
        for await (const e of ctx.adapter.fs.readDir(current)) {
          if (e.isDirectory) names.push(e.name);
        }
      } catch (err) {
        this.logDebug("Failed to read directory", { current, error: err }, ctx);
        return null;
      }

      if (names.includes(seg)) {
        current = joinPath(current, seg);
        continue;
      }

      const dyn = names.find((n) => /^\[[^\]]+\]$/.test(n));
      if (dyn) {
        params[dyn.slice(1, -1)] = seg;
        current = joinPath(current, dyn);
        continue;
      }

      const ca = names.find((n) => /^\[\.\.\.[^\]]+\]$/.test(n));
      if (ca) {
        params[ca.slice(4, -1)] = segments.slice(i).join("/");
        current = joinPath(current, ca);
        break;
      }

      const opt = names.find((n) => /^\[\[\.\.\.[^\]]+\]\]$/.test(n));
      if (opt) {
        params[opt.slice(5, -2)] = segments.slice(i).join("/");
        current = joinPath(current, opt);
        break;
      }

      return null;
    }

    const candidates = ["route.tsx", "route.ts", "route.jsx", "route.js"].map((n) =>
      joinPath(current, n)
    );

    for (const f of candidates) {
      try {
        const st = await ctx.adapter.fs.stat(f);
        if (st.isFile) return { file: f, params };
      } catch (err) {
        this.logDebug("Route file not found", { file: f, error: err }, ctx);
      }
    }

    return null;
  }
}
