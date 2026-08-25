import {
  computeHash,
  computeIntegrity,
  createLockfileManager,
  getLockfileEntryForBuild,
  HTTP_MODULE_FETCH_TIMEOUT_MS,
  HTTP_NETWORK_CONNECT_TIMEOUT,
  type LockfileManager,
  serverLogger,
  setLockfileEntryForBuild,
  sleep,
} from "#veryfront/utils";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import type { Message, Plugin } from "veryfront/extensions/bundler";
import { isAllowedRemoteHost, validateHTTPImports } from "./http-validator.ts";
import {
  guardedOutboundFetch,
  OutboundRequestBlockedError,
} from "#veryfront/security/http/outbound-fetch.ts";
import {
  HttpModuleBodyError,
  readHttpModuleText,
} from "../../../transforms/shared/http-module-response.ts";
import { MAX_BUNDLE_CHUNK_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";

const logger = serverLogger.component("api");
const HTTP_MODULE_CACHE_DIR = ".veryfront/cache/api-http-imports";
const HTTP_MODULE_FETCH_MAX_ATTEMPTS = 3;
const HTTP_MODULE_FETCH_RETRY_DELAY_MS = 100;

interface HTTPPluginOptions {
  allowedHosts: string[];
  /** One end-to-end deadline for response headers and the bounded source body. */
  fetchTimeoutMs?: number;
  lockfile?: LockfileManager;
  projectDir?: string;
  strict?: boolean;
}

interface CachedHTTPModuleMetadata {
  url: string;
  resolvedUrl: string;
  integrity: string;
  fetchedAt: string;
}

interface HTTPModuleCache {
  read(url: string, expectedIntegrity?: string): Promise<string | null>;
  write(
    url: string,
    contents: string,
    resolvedUrl: string,
    integrity: string,
  ): Promise<void>;
}

type RemoteModuleFetchResult =
  | {
    ok: true;
    status: number;
    text: string;
    url: string;
  }
  | {
    ok: false;
    status: number;
    url: string;
  };

function createHTTPModuleCache(projectDir: string | undefined): HTTPModuleCache | null {
  if (!projectDir) return null;

  const fs = createFileSystem();
  const cacheDir = pathHelper.join(projectDir, HTTP_MODULE_CACHE_DIR);

  async function cachePaths(
    url: string,
    integrity: string,
  ): Promise<{ sourcePath: string; metadataPath: string }> {
    const key = await computeHash(`${url}\n${integrity}`);
    return {
      sourcePath: pathHelper.join(cacheDir, `${key}.mjs`),
      metadataPath: pathHelper.join(cacheDir, `${key}.json`),
    };
  }

  async function readMetadata(
    metadataPath: string,
    fs: FileSystem,
  ): Promise<CachedHTTPModuleMetadata | null> {
    if (!await fs.exists(metadataPath)) return null;

    try {
      return JSON.parse(await fs.readTextFile(metadataPath)) as CachedHTTPModuleMetadata;
    } catch (error) {
      logger.debug(`[http] ignoring unreadable module cache metadata: ${error}`);
      return null;
    }
  }

  return {
    async read(url: string, expectedIntegrity?: string): Promise<string | null> {
      if (!expectedIntegrity) return null;

      try {
        const { sourcePath, metadataPath } = await cachePaths(url, expectedIntegrity);
        if (!await fs.exists(sourcePath)) return null;

        const contents = await fs.readTextFile(sourcePath);
        const integrity = await computeIntegrity(contents);
        if (integrity !== expectedIntegrity) {
          logger.warn(`[http] cached module integrity mismatch: ${url}`);
          return null;
        }

        const metadata = await readMetadata(metadataPath, fs);
        if (metadata?.integrity && metadata.integrity !== integrity) {
          logger.warn(`[http] cached module metadata integrity mismatch: ${url}`);
          return null;
        }

        return contents;
      } catch (error) {
        logger.debug(`[http] module cache read miss for ${url}: ${error}`);
        return null;
      }
    },

    async write(
      url: string,
      contents: string,
      resolvedUrl: string,
      integrity: string,
    ): Promise<void> {
      try {
        await fs.mkdir(cacheDir, { recursive: true });
        const { sourcePath, metadataPath } = await cachePaths(url, integrity);
        await fs.writeTextFile(sourcePath, contents);
        await fs.writeTextFile(
          metadataPath,
          `${
            JSON.stringify(
              {
                url,
                resolvedUrl,
                integrity,
                fetchedAt: new Date().toISOString(),
              } satisfies CachedHTTPModuleMetadata,
              null,
              2,
            )
          }\n`,
        );
      } catch (error) {
        logger.debug(`[http] could not update module cache for ${url}: ${error}`);
      }
    },
  };
}

export function createHTTPPlugin(options: HTTPPluginOptions | string[]): Plugin {
  const opts: HTTPPluginOptions = Array.isArray(options) ? { allowedHosts: options } : options;
  const { allowedHosts, strict = false } = opts;
  const fetchTimeoutMs = opts.fetchTimeoutMs ?? HTTP_MODULE_FETCH_TIMEOUT_MS;
  if (!Number.isSafeInteger(fetchTimeoutMs) || fetchTimeoutMs <= 0) {
    throw new TypeError("HTTP module fetch timeout must be a positive safe integer");
  }
  const lockfile = opts.lockfile ??
    (opts.projectDir ? createLockfileManager(opts.projectDir) : null);
  const moduleCache = createHTTPModuleCache(opts.projectDir);
  let lockfileFlushDisabled = false;

  return {
    name: "vf-api-http-fetch",
    setup(build): void {
      const resolvedUrls: string[] = [];
      const nodeMapped: Array<{ from: string; to: string }> = [];

      function authorizeRemoteUrl(url: URL): void {
        if (isAllowedRemoteHost(url, allowedHosts)) return;
        throw new OutboundRequestBlockedError(
          `Remote import blocked by allow-list: ${url.origin}`,
        );
      }

      async function validateRemoteModuleSource(contents: string): Promise<{
        readonly contents: string;
        readonly loader: "js";
      }> {
        await validateHTTPImports(contents, allowedHosts);
        return { contents, loader: "js" };
      }

      async function fetchRemoteModuleAttempt(url: string): Promise<RemoteModuleFetchResult> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
        let response: Response | undefined;

        try {
          response = await guardedOutboundFetch(url, {
            headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
            signal: controller.signal,
            redirect: "follow",
          }, {
            authorizeUrl: authorizeRemoteUrl,
          });

          if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            return {
              ok: false,
              status: response.status,
              url: response.url || url,
            };
          }

          return {
            ok: true,
            status: response.status,
            text: await readHttpModuleText(
              response,
              MAX_BUNDLE_CHUNK_SIZE_BYTES,
              controller.signal,
            ),
            url: response.url || url,
          };
        } catch (error) {
          if (response) await response.body?.cancel().catch(() => undefined);
          if (
            error instanceof OutboundRequestBlockedError ||
            error instanceof HttpModuleBodyError
          ) {
            throw error;
          }
          return {
            ok: false,
            status: HTTP_NETWORK_CONNECT_TIMEOUT,
            url,
          };
        } finally {
          clearTimeout(timeout);
        }
      }

      function shouldRetryFetch(status: number): boolean {
        return status === 429 || status >= 500 || status === HTTP_NETWORK_CONNECT_TIMEOUT;
      }

      function describePersistenceError(error: unknown): string {
        if (!(error instanceof Error)) return typeof error;

        const code = (error as { code?: unknown }).code;
        const name = error.name || "Error";
        return typeof code === "string" && code ? `${name}(${code})` : name;
      }

      function isReadOnlyFileSystemError(error: unknown): boolean {
        if (error == null) return false;

        const message = error instanceof Error ? error.message : String(error);
        if (/read-only file ?system|os error 30|erofs/i.test(message)) return true;

        return error instanceof Error && isReadOnlyFileSystemError(error.cause);
      }

      async function persistLockfileEntry(
        url: string,
        entry: {
          resolved: string;
          integrity: string;
          fetchedAt: string;
        },
      ): Promise<void> {
        if (!lockfile) return;

        // An unreadable lockfile skips persistence instead of failing the
        // refetched load; the file stays intact for `veryfront lock --clear`.
        const staged = await setLockfileEntryForBuild(lockfile, url, entry);
        if (!staged) return;

        if (lockfileFlushDisabled) return;

        try {
          await lockfile.flush();
          logger.debug(`[http] lockfile updated: ${url} -> ${entry.resolved}`);
        } catch (error) {
          if (!isReadOnlyFileSystemError(error)) throw error;
          lockfileFlushDisabled = true;
          logger.debug(
            `[http] lockfile flush disabled on read-only filesystem for ${url}: ${
              describePersistenceError(error)
            }`,
          );
        }
      }

      async function fetchRemoteModule(url: string): Promise<RemoteModuleFetchResult> {
        for (let attempt = 1; attempt <= HTTP_MODULE_FETCH_MAX_ATTEMPTS; attempt += 1) {
          const response = await fetchRemoteModuleAttempt(url);
          if (!shouldRetryFetch(response.status) || attempt === HTTP_MODULE_FETCH_MAX_ATTEMPTS) {
            return response;
          }

          logger.warn(
            `[http] fetch attempt ${attempt} failed ${url} ${response.status}; retrying`,
          );
          await sleep(HTTP_MODULE_FETCH_RETRY_DELAY_MS * attempt);
        }

        return { ok: false, status: HTTP_NETWORK_CONNECT_TIMEOUT, url };
      }

      build.onResolve({ filter: /^https?:\/\//i }, (args) => ({
        path: args.path,
        namespace: "http-url",
      }));

      build.onResolve({ filter: /^react\/(jsx-runtime|jsx-dev-runtime)$/ }, (args) => {
        const runtime = args.path.split("/")[1];
        const reactUrl = `https://esm.sh/react@18/${runtime}`;
        logger.debug(`[http] map '${args.path}' -> '${reactUrl}'`);
        return { path: reactUrl, namespace: "http-url" };
      });

      // Node.js built-in modules — mark as external so they resolve at runtime
      // via Deno's node: compat layer or Node.js itself. Post-processing in
      // rewriteExternalImports converts bare names to node: prefix for Deno.
      const nodeBuiltinPattern =
        /^(node:|assert$|buffer$|child_process$|cluster$|crypto$|dgram$|dns$|events$|fs$|http$|http2$|https$|net$|os$|path$|perf_hooks$|querystring$|readline$|stream$|string_decoder$|tls$|tty$|url$|util$|v8$|vm$|worker_threads$|zlib$)/;

      build.onResolve({ filter: nodeBuiltinPattern }, (args) => {
        nodeMapped.push({
          from: args.path,
          to: args.path.startsWith("node:") ? args.path : `node:${args.path}`,
        });
        return { path: args.path, external: true };
      });

      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.namespace !== "http-url") return undefined;

        try {
          const resolved = new URL(args.path, args.importer).toString();
          resolvedUrls.push(resolved);
          return { path: resolved, namespace: "http-url" };
        } catch (_) {
          /* expected: relative URL resolution may fail */
          return undefined;
        }
      });

      build.onLoad({ filter: /.*/, namespace: "http-url" }, async (args) => {
        let requestUrl = args.path;

        try {
          const u = new URL(args.path);

          if (!isAllowedRemoteHost(u, allowedHosts)) {
            const remediation =
              `Add "${u.origin}" to security.remoteHosts in veryfront.config.(ts|js) or replace with an approved CDN (e.g., https://esm.sh).`;
            return {
              errors: [
                {
                  text: `Remote import blocked by allow-list: ${u.origin}. ${remediation}`,
                } as Message,
              ],
            };
          }

          if (u.hostname === "esm.sh") {
            if (u.pathname.includes("/denonext/")) {
              u.pathname = u.pathname.replace("/denonext/", "/");
            }
            u.searchParams.set("target", "es2020");
            u.searchParams.set("bundle", "true");
            logger.debug(`[http] esm.sh rewrite: ${args.path} -> ${u.toString()}`);
            requestUrl = u.toString();
          }
        } catch (e) {
          logger.warn("API URL parse failed", e);
        }

        const readCachedModule = async (
          url: string | undefined,
          expectedIntegrity?: string,
        ): Promise<string | null> => {
          if (!url || !moduleCache) return null;
          return await moduleCache.read(url, expectedIntegrity);
        };

        // A newer-format lockfile keeps failing the load loudly; an unreadable
        // or malformed lockfile degrades to a cache miss with a logged remedy.
        const lockfileEntry = lockfile ? await getLockfileEntryForBuild(lockfile, args.path) : null;

        if (lockfileEntry) {
          let canUseLockfileCacheFallback = true;
          logger.debug(`[http] lockfile hit: ${args.path}`);
          try {
            const res = await fetchRemoteModule(lockfileEntry.resolved);
            if (res.ok) {
              const text = res.text;
              const integrity = await computeIntegrity(text);

              if (integrity === lockfileEntry.integrity) {
                const loaded = await validateRemoteModuleSource(text);
                await moduleCache?.write(args.path, text, lockfileEntry.resolved, integrity);
                await moduleCache?.write(
                  lockfileEntry.resolved,
                  text,
                  lockfileEntry.resolved,
                  integrity,
                );
                return loaded;
              }

              if (strict) {
                return {
                  errors: [
                    {
                      text:
                        `Integrity mismatch for ${args.path}: expected ${lockfileEntry.integrity}, got ${integrity}`,
                    } as Message,
                  ],
                };
              }

              canUseLockfileCacheFallback = false;
              logger.warn(`[http] integrity mismatch, refetching: ${args.path}`);
            } else {
              logger.warn(
                `[http] cached URL returned ${res.status}, trying module cache: ${args.path}`,
              );
            }
          } catch (error) {
            if (error instanceof OutboundRequestBlockedError) throw error;
            logger.warn(`[http] cached URL failed, trying module cache: ${args.path}`);
          }

          if (canUseLockfileCacheFallback) {
            const cachedText =
              await readCachedModule(lockfileEntry.resolved, lockfileEntry.integrity) ??
                await readCachedModule(args.path, lockfileEntry.integrity);
            if (cachedText) {
              logger.warn(`[http] serving cached remote import for ${args.path}`);
              return await validateRemoteModuleSource(cachedText);
            }
          }
        }

        let res: RemoteModuleFetchResult;
        try {
          res = await fetchRemoteModule(requestUrl);
        } catch (error) {
          if (error instanceof OutboundRequestBlockedError) {
            return { errors: [{ text: error.message } as Message] };
          }
          throw error;
        }

        if (!res.ok) {
          const cachedText =
            await readCachedModule(lockfileEntry?.resolved, lockfileEntry?.integrity) ??
              await readCachedModule(requestUrl, lockfileEntry?.integrity) ??
              await readCachedModule(args.path, lockfileEntry?.integrity);
          if (cachedText) {
            logger.warn(`[http] serving cached remote import for ${args.path}`);
            return await validateRemoteModuleSource(cachedText);
          }

          logger.error(`[http] fetch failed ${requestUrl} ${res.status}`);
          return {
            errors: [
              {
                text: `Failed to fetch ${args.path}: ${res.status}`,
              } as Message,
            ],
          };
        }

        const text = res.text;
        const resolvedUrl = res.url;
        const integrity = await computeIntegrity(text);
        const loaded = await validateRemoteModuleSource(text);

        await persistLockfileEntry(args.path, {
          resolved: resolvedUrl,
          integrity,
          fetchedAt: new Date().toISOString(),
        });
        await moduleCache?.write(args.path, text, resolvedUrl, integrity);
        await moduleCache?.write(requestUrl, text, resolvedUrl, integrity);
        await moduleCache?.write(resolvedUrl, text, resolvedUrl, integrity);

        return loaded;
      });

      logger.debug(
        `[API][http] resolvedUrls: ${resolvedUrls.length}, nodeMapped: ${nodeMapped.length}`,
      );
    },
  };
}
