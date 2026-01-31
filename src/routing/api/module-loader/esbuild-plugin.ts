import {
  computeIntegrity,
  createLockfileManager,
  getDenoStdNodeBase,
  HTTP_MODULE_FETCH_TIMEOUT_MS,
  HTTP_NETWORK_CONNECT_TIMEOUT,
  type LockfileManager,
  serverLogger as logger,
} from "#veryfront/utils";
import type { Message, Plugin } from "esbuild";

export interface HTTPPluginOptions {
  allowedHosts: string[];
  lockfile?: LockfileManager;
  projectDir?: string;
  strict?: boolean;
}

export function createHTTPPlugin(options: HTTPPluginOptions | string[]): Plugin {
  const opts: HTTPPluginOptions = Array.isArray(options) ? { allowedHosts: options } : options;
  const { allowedHosts, strict = false } = opts;
  const lockfile = opts.lockfile ??
    (opts.projectDir ? createLockfileManager(opts.projectDir) : null);

  return {
    name: "vf-api-http-fetch",
    setup(build): void {
      const stdNodeBase = getDenoStdNodeBase();
      const resolvedUrls: string[] = [];
      const nodeMapped: Array<{ from: string; to: string }> = [];

      function mapNodeCore(spec: string): string | null {
        if (spec.startsWith("node:")) {
          return `${stdNodeBase}/${spec.slice(5)}.ts`;
        }

        switch (spec) {
          case "buffer":
            return `${stdNodeBase}/buffer.ts`;
          case "path":
            return `${stdNodeBase}/path.ts`;
          case "fs":
            return `${stdNodeBase}/fs.ts`;
          default:
            return null;
        }
      }

      async function fetchWithTimeout(url: string): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), HTTP_MODULE_FETCH_TIMEOUT_MS);

        try {
          return await fetch(url, {
            headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
            signal: controller.signal,
            redirect: "follow",
          });
        } finally {
          clearTimeout(timeout);
        }
      }

      build.onResolve({ filter: /^(http|https):\/\// }, (args) => ({
        path: args.path,
        namespace: "http-url",
      }));

      build.onResolve({ filter: /^react\/(jsx-runtime|jsx-dev-runtime)$/ }, (args) => {
        const runtime = args.path.split("/")[1];
        const reactUrl = `https://esm.sh/react@18/${runtime}`;
        logger.debug(`[API][http] map '${args.path}' -> '${reactUrl}'`);
        return { path: reactUrl, namespace: "http-url" };
      });

      build.onResolve({ filter: /^(node:|buffer$|path$|fs$)/ }, (args) => {
        const mapped = mapNodeCore(args.path);
        if (!mapped) return undefined;

        nodeMapped.push({ from: args.path, to: mapped });
        logger.debug(`[API][http] map '${args.path}' -> '${mapped}'`);
        return { path: mapped, namespace: "http-url" };
      });

      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.namespace !== "http-url") return undefined;

        try {
          const resolved = new URL(args.path, args.importer).toString();
          resolvedUrls.push(resolved);
          return { path: resolved, namespace: "http-url" };
        } catch {
          return undefined;
        }
      });

      build.onLoad({ filter: /.*/, namespace: "http-url" }, async (args) => {
        let requestUrl = args.path;

        try {
          const u = new URL(args.path);

          if (allowedHosts?.length) {
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

        if (lockfile) {
          const cached = await lockfile.get(args.path);
          if (cached) {
            logger.debug(`[API][http] lockfile hit: ${args.path}`);
            try {
              const res = await fetchWithTimeout(cached.resolved);
              if (res.ok) {
                const text = await res.text();
                const integrity = await computeIntegrity(text);

                if (integrity === cached.integrity) {
                  return { contents: text, loader: "js" } as const;
                }

                if (strict) {
                  return {
                    errors: [
                      {
                        text:
                          `Integrity mismatch for ${args.path}: expected ${cached.integrity}, got ${integrity}`,
                      } as Message,
                    ],
                  };
                }

                logger.warn(`[API][http] integrity mismatch, refetching: ${args.path}`);
              }
            } catch {
              logger.warn(`[API][http] cached URL failed, refetching: ${args.path}`);
            }
          }
        }

        const res = await fetchWithTimeout(requestUrl).catch((e) => {
          return new Response(String(e?.message ?? e), { status: HTTP_NETWORK_CONNECT_TIMEOUT });
        });

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
        const resolvedUrl = res.url || requestUrl;

        if (lockfile) {
          const integrity = await computeIntegrity(text);
          await lockfile.set(args.path, {
            resolved: resolvedUrl,
            integrity,
            fetchedAt: new Date().toISOString(),
          });
          await lockfile.flush();
          logger.debug(`[API][http] lockfile updated: ${args.path} -> ${resolvedUrl}`);
        }

        return { contents: text, loader: "js" } as const;
      });

      logger.debug(
        `[API][http] resolvedUrls: ${resolvedUrls.length}, nodeMapped: ${nodeMapped.length}`,
      );
    },
  };
}
