import {
  computeHash,
  computeIntegrity,
  createLockfileManager,
  HTTP_MODULE_FETCH_TIMEOUT_MS,
  HTTP_NETWORK_CONNECT_TIMEOUT,
  type LockfileManager,
  serverLogger,
  sleep,
} from "#veryfront/utils";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import type { Message, Plugin } from "veryfront/extensions/bundler";
import { isAllowedRemoteHost } from "./http-validator.ts";
import { MAX_BUNDLE_CHUNK_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { normalizeTimerDurationMs } from "#veryfront/utils/timer.ts";
import {
  isNativeErrorWithoutHooks,
  snapshotThrowableDiagnostic,
} from "#veryfront/errors/safe-diagnostics.ts";

const logger = serverLogger.component("api");
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const HTTP_MODULE_CACHE_DIR = ".veryfront/cache/api-http-imports";
const HTTP_MODULE_FETCH_MAX_ATTEMPTS = 3;
const HTTP_MODULE_FETCH_RETRY_DELAY_MS = 100;
const HTTP_MODULE_MAX_REDIRECTS = 10;
const MAX_CONFIGURED_HTTP_MODULE_SIZE_BYTES = 64 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface HTTPPluginOptions {
  allowedHosts: string[];
  lockfile?: LockfileManager;
  projectDir?: string;
  strict?: boolean;
  maxResponseBytes?: number;
  timeoutMs?: number;
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

class RemoteImportBlockedError extends Error {
  override readonly name = "RemoteImportBlockedError";
}

class RemoteModuleFetchError extends Error {
  override readonly name = "RemoteModuleFetchError";
}

function cancelResponseBody(response: Response): void {
  try {
    const cancellation = response.body?.cancel();
    if (cancellation) void cancellation.catch(() => undefined);
  } catch {
    /* cancellation is best-effort cleanup */
  }
}

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
      logger.debug(
        `[http] ignoring unreadable module cache metadata: ${snapshotThrowableDiagnostic(error)}`,
      );
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
        if (expectedIntegrity && integrity !== expectedIntegrity) {
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
        logger.debug(
          `[http] module cache read miss for ${url}: ${snapshotThrowableDiagnostic(error)}`,
        );
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
        logger.debug(
          `[http] could not update module cache for ${url}: ${snapshotThrowableDiagnostic(error)}`,
        );
      }
    },
  };
}

export function createHTTPPlugin(options: HTTPPluginOptions | string[]): Plugin {
  const opts: HTTPPluginOptions = Array.isArray(options) ? { allowedHosts: options } : options;
  const { allowedHosts, strict = false } = opts;
  const timeoutMs = normalizeTimerDurationMs(
    opts.timeoutMs ?? HTTP_MODULE_FETCH_TIMEOUT_MS,
    "HTTP module timeout",
  );
  if (timeoutMs === 0) {
    throw new RangeError("HTTP module timeout must be greater than zero");
  }
  const maxResponseBytes = opts.maxResponseBytes ?? MAX_BUNDLE_CHUNK_SIZE_BYTES;
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes <= 0 ||
    maxResponseBytes > MAX_CONFIGURED_HTTP_MODULE_SIZE_BYTES
  ) {
    throw new RangeError(
      `maxResponseBytes must be a positive safe integer no greater than ${MAX_CONFIGURED_HTTP_MODULE_SIZE_BYTES}`,
    );
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

      function blockedRemoteImport(url: URL): RemoteImportBlockedError {
        const remediation =
          `Add "${url.origin}" to security.remoteHosts in veryfront.config.(ts|js) or replace with an approved CDN (e.g., https://esm.sh).`;
        return new RemoteImportBlockedError(
          `Remote import blocked by allow-list: ${url.origin}. ${remediation}`,
        );
      }

      function requireAllowedRemoteUrl(candidate: string): URL {
        let url: URL;
        try {
          url = new URL(candidate);
        } catch (_) {
          throw new RemoteImportBlockedError(
            "Remote import blocked: expected an absolute HTTP(S) URL.",
          );
        }

        if (
          (url.protocol !== "http:" && url.protocol !== "https:") ||
          url.username.length > 0 ||
          url.password.length > 0
        ) {
          throw new RemoteImportBlockedError(
            "Remote import blocked: URLs must use HTTP(S) without embedded credentials.",
          );
        }
        if (!isAllowedRemoteHost(url, allowedHosts)) throw blockedRemoteImport(url);
        return url;
      }

      function pluginError(error: RemoteImportBlockedError | RemoteModuleFetchError): {
        errors: Message[];
      } {
        return { errors: [{ text: error.message } as Message] };
      }

      async function fetchWithTimeout(url: string): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          return await fetch(url, {
            headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
            signal: controller.signal,
            redirect: "manual",
          });
        } finally {
          clearTimeout(timeout);
        }
      }

      async function fetchAllowedRedirectChain(url: string): Promise<{
        response: Response;
        resolvedUrl: string;
      }> {
        let currentUrl = requireAllowedRemoteUrl(url);

        for (let redirectCount = 0;; redirectCount++) {
          const response = await fetchWithTimeout(currentUrl.toString());
          if (REDIRECT_STATUSES.has(response.status)) {
            const location = response.headers.get("location");
            if (!location) {
              cancelResponseBody(response);
              return { response, resolvedUrl: currentUrl.toString() };
            }
            if (redirectCount >= HTTP_MODULE_MAX_REDIRECTS) {
              cancelResponseBody(response);
              throw new RemoteModuleFetchError(
                `Remote module exceeded ${HTTP_MODULE_MAX_REDIRECTS} redirects`,
              );
            }

            cancelResponseBody(response);
            currentUrl = requireAllowedRemoteUrl(new URL(location, currentUrl).toString());
            continue;
          }

          let resolvedUrl: string;
          try {
            resolvedUrl = requireAllowedRemoteUrl(
              response.url || currentUrl.toString(),
            ).toString();
          } catch (error) {
            cancelResponseBody(response);
            throw error;
          }
          return { response, resolvedUrl };
        }
      }

      function shouldRetryFetch(status: number): boolean {
        return status === 429 || status >= 500 || status === HTTP_NETWORK_CONNECT_TIMEOUT;
      }

      function describePersistenceError(error: unknown): string {
        if (!isNativeErrorWithoutHooks(error)) return typeof error;

        const codeDescriptor = getOwnPropertyDescriptor(error, "code");
        const code = codeDescriptor && "value" in codeDescriptor ? codeDescriptor.value : undefined;
        const nameDescriptor = getOwnPropertyDescriptor(error, "name");
        const ownName = nameDescriptor && "value" in nameDescriptor
          ? nameDescriptor.value
          : undefined;
        const name = typeof ownName === "string" && ownName ? ownName : "Error";
        return typeof code === "string" && code ? `${name}(${code})` : name;
      }

      function isReadOnlyFileSystemError(
        error: unknown,
        seen: Set<unknown> = new Set(),
      ): boolean {
        if (!isNativeErrorWithoutHooks(error) || seen.has(error)) return false;
        seen.add(error);

        if (
          /read-only file ?system|os error 30|erofs/i.test(
            snapshotThrowableDiagnostic(error),
          )
        ) {
          return true;
        }

        const causeDescriptor = getOwnPropertyDescriptor(error, "cause");
        const cause = causeDescriptor && "value" in causeDescriptor
          ? causeDescriptor.value
          : undefined;
        return cause !== undefined && isReadOnlyFileSystemError(cause, seen);
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

        await lockfile.set(url, entry);

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

      async function fetchRemoteModule(url: string): Promise<{
        response: Response;
        resolvedUrl: string;
      }> {
        for (let attempt = 1; attempt <= HTTP_MODULE_FETCH_MAX_ATTEMPTS; attempt += 1) {
          let result: { response: Response; resolvedUrl: string };
          try {
            result = await fetchAllowedRedirectChain(url);
          } catch (error) {
            if (
              error instanceof RemoteImportBlockedError ||
              error instanceof RemoteModuleFetchError
            ) {
              throw error;
            }
            result = {
              response: new Response(snapshotThrowableDiagnostic(error), {
                status: HTTP_NETWORK_CONNECT_TIMEOUT,
              }),
              resolvedUrl: url,
            };
          }
          const { response } = result;
          if (!shouldRetryFetch(response.status) || attempt === HTTP_MODULE_FETCH_MAX_ATTEMPTS) {
            if (!response.ok) cancelResponseBody(response);
            return result;
          }

          logger.warn(
            `[http] fetch attempt ${attempt} failed ${url} ${response.status}; retrying`,
          );
          cancelResponseBody(response);
          await sleep(HTTP_MODULE_FETCH_RETRY_DELAY_MS * attempt);
        }

        return {
          response: new Response("Remote module fetch failed", {
            status: HTTP_NETWORK_CONNECT_TIMEOUT,
          }),
          resolvedUrl: url,
        };
      }

      async function readRemoteModuleText(response: Response): Promise<string> {
        const rawContentLength = response.headers.get("content-length");
        if (rawContentLength && /^\d+$/.test(rawContentLength)) {
          const contentLength = Number(rawContentLength);
          if (Number.isSafeInteger(contentLength) && contentLength > maxResponseBytes) {
            cancelResponseBody(response);
            throw new RemoteModuleFetchError(
              `Remote module exceeded ${maxResponseBytes} bytes`,
            );
          }
        }

        const controller = new AbortController();
        const timeoutError = new RemoteModuleFetchError(
          `Remote module body timed out after ${timeoutMs}ms`,
        );
        const timeout = setTimeout(() => controller.abort(timeoutError), timeoutMs);

        try {
          const result = await readResponseTextPrefix(
            response,
            maxResponseBytes + 1,
            controller.signal,
          );
          if (
            result.truncated ||
            new TextEncoder().encode(result.text).byteLength > maxResponseBytes
          ) {
            throw new RemoteModuleFetchError(
              `Remote module exceeded ${maxResponseBytes} bytes`,
            );
          }
          return result.text;
        } catch (error) {
          if (controller.signal.aborted) throw timeoutError;
          throw error;
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
          const u = requireAllowedRemoteUrl(args.path);

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
          if (e instanceof RemoteImportBlockedError) return pluginError(e);
          logger.warn("API URL parse failed", e);
          return pluginError(
            new RemoteImportBlockedError(
              "Remote import blocked: expected an absolute HTTP(S) URL.",
            ),
          );
        }

        const readCachedModule = async (
          url: string | undefined,
          expectedIntegrity?: string,
        ): Promise<string | null> => {
          if (!url || !moduleCache) return null;
          return await moduleCache.read(url, expectedIntegrity);
        };

        const lockfileEntry = lockfile ? await lockfile.get(args.path) : null;

        if (lockfileEntry) {
          let canUseLockfileCacheFallback = true;
          logger.debug(`[http] lockfile hit: ${args.path}`);
          try {
            const fetched = await fetchRemoteModule(lockfileEntry.resolved);
            const res = fetched.response;
            if (res.ok) {
              const text = await readRemoteModuleText(res);
              const integrity = await computeIntegrity(text);

              if (integrity === lockfileEntry.integrity) {
                await moduleCache?.write(args.path, text, fetched.resolvedUrl, integrity);
                await moduleCache?.write(
                  lockfileEntry.resolved,
                  text,
                  fetched.resolvedUrl,
                  integrity,
                );
                return { contents: text, loader: "js" } as const;
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
            if (
              error instanceof RemoteImportBlockedError ||
              error instanceof RemoteModuleFetchError
            ) {
              return pluginError(error);
            }
            logger.warn(`[http] cached URL failed, trying module cache: ${args.path}`);
          }

          if (canUseLockfileCacheFallback) {
            const cachedText =
              await readCachedModule(lockfileEntry.resolved, lockfileEntry.integrity) ??
                await readCachedModule(args.path, lockfileEntry.integrity);
            if (cachedText) {
              logger.warn(`[http] serving cached remote import for ${args.path}`);
              return { contents: cachedText, loader: "js" } as const;
            }
          }
        }

        let fetched: { response: Response; resolvedUrl: string };
        try {
          fetched = await fetchRemoteModule(requestUrl);
        } catch (error) {
          if (
            error instanceof RemoteImportBlockedError ||
            error instanceof RemoteModuleFetchError
          ) {
            return pluginError(error);
          }
          throw error;
        }
        const res = fetched.response;

        if (!res.ok) {
          const cachedText =
            await readCachedModule(lockfileEntry?.resolved, lockfileEntry?.integrity) ??
              await readCachedModule(requestUrl, lockfileEntry?.integrity) ??
              await readCachedModule(args.path, lockfileEntry?.integrity);
          if (cachedText) {
            logger.warn(`[http] serving cached remote import for ${args.path}`);
            return { contents: cachedText, loader: "js" } as const;
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

        let text: string;
        try {
          text = await readRemoteModuleText(res);
        } catch (error) {
          if (error instanceof RemoteModuleFetchError) return pluginError(error);
          throw error;
        }
        const resolvedUrl = fetched.resolvedUrl;
        const integrity = await computeIntegrity(text);

        await persistLockfileEntry(args.path, {
          resolved: resolvedUrl,
          integrity,
          fetchedAt: new Date().toISOString(),
        });
        await moduleCache?.write(args.path, text, resolvedUrl, integrity);
        await moduleCache?.write(requestUrl, text, resolvedUrl, integrity);
        await moduleCache?.write(resolvedUrl, text, resolvedUrl, integrity);

        return { contents: text, loader: "js" } as const;
      });

      logger.debug(
        `[API][http] resolvedUrls: ${resolvedUrls.length}, nodeMapped: ${nodeMapped.length}`,
      );
    },
  };
}
