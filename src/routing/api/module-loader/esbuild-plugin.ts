import { serverLogger as logger } from "@veryfront/utils";
import type { Message, Plugin } from "esbuild";
import { getDenoStdNodeBase } from "@veryfront/utils";
import { HTTP_MODULE_FETCH_TIMEOUT_MS, HTTP_NETWORK_CONNECT_TIMEOUT } from "@veryfront/utils";

export function createHTTPPlugin(allowedHosts: string[]): Plugin {
  return {
    name: "vf-api-http-fetch",
    setup(build: Parameters<Plugin["setup"]>[0]) {
      const stdNodeBase = getDenoStdNodeBase();
      const resolvedUrls: string[] = [];
      const nodeMapped: Array<{ from: string; to: string }> = [];

      const mapNodeCore = (spec: string): string | null => {
        if (spec.startsWith("node:")) {
          const sub = spec.slice(5);
          return `${stdNodeBase}/${sub}.ts`;
        }
        if (spec === "buffer") return `${stdNodeBase}/buffer.ts`;
        if (spec === "path") return `${stdNodeBase}/path.ts`;
        if (spec === "fs") return `${stdNodeBase}/fs.ts`;
        return null;
      };

      build.onResolve({ filter: /^(http|https):\/\
        path: args.path,
        namespace: "http-url",
      }));

      build.onResolve({ filter: /^react\/(jsx-runtime|jsx-dev-runtime)$/ }, (args) => {
        const reactUrl = `https://esm.sh/react@18/${args.path.split("/")[1]}`;
        logger.debug(`[API][http] map '${args.path}' -> '${reactUrl}'`);
        return { path: reactUrl, namespace: "http-url" };
      });

      build.onResolve({ filter: /^(node:|buffer$|path$|fs$)/ }, (args) => {
        const mapped = mapNodeCore(args.path);
        if (mapped) {
          nodeMapped.push({ from: args.path, to: mapped });
          logger.debug(`[API][http] map '${args.path}' -> '${mapped}'`);
          return { path: mapped, namespace: "http-url" };
        }
        return undefined;
      });

      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.namespace === "http-url") {
          try {
            const resolved = new URL(args.path, args.importer).toString();
            resolvedUrls.push(resolved);
            return { path: resolved, namespace: "http-url" };
          } catch {
            return undefined;
          }
        }
        return undefined;
      });

      build.onLoad({ filter: /.*/, namespace: "http-url" }, async (args) => {
        let requestUrl = args.path;
        try {
          const u = new URL(args.path);
          if (allowedHosts && allowedHosts.length > 0) {
            const hostUrl = `${u.protocol}//${u.host}`;
            const isAllowed = allowedHosts.some((h) => hostUrl.startsWith(h));
            if (!isAllowed) {
              const remediation =
                `Add "${hostUrl}" to security.remoteHosts in veryfront.config.(ts|js) or replace with an approved CDN (e.g., https://esm.sh).`;
              return {
                errors: [
                  {
                    text: `Remote import blocked by allow-list: ${hostUrl}. ${remediation}`,
                  } as Message,
                ],
              };
            }
          }
          if (u.hostname === "esm.sh") {
            if (u.pathname.includes("/denonext/")) {
              u.pathname = u.pathname.replace("/denonext/", "/");
            }
            u.searchParams.set("target", "es2020");
            u.searchParams.set("bundle", "true");
            logger.debug(`[API][http] esm.sh rewrite: ${args.path} -> ${u.toString()}`);
            requestUrl = u.toString();
          }
        } catch (e) {
          logger.warn("API URL parse failed", e);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), HTTP_MODULE_FETCH_TIMEOUT_MS);
        const res = await fetch(requestUrl, {
          headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
          signal: controller.signal,
        })
          .catch((e) => {
            return new Response(String(e?.message || e), { status: HTTP_NETWORK_CONNECT_TIMEOUT });
          })
          .finally(() => clearTimeout(timeout));

        if (!res.ok) {
          logger.error(`[API][http] fetch failed ${requestUrl} ${res.status}`);
          return {
            errors: [
              {
                text: `Failed to fetch ${args.path}: ${res.status}`,
              } as Message,
            ],
          };
        }

        const text = await res.text();
        return { contents: text, loader: "js" } as const;
      });

      logger.debug(
        `[API][http] resolvedUrls: ${resolvedUrls.length}, nodeMapped: ${nodeMapped.length}`,
      );
    },
  };
}
