import { Buffer } from "node:buffer";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import process from "node:process";
import { isNodeRuntime } from "#veryfront/platform/compat/runtime.ts";
import type { HostedExecutorAllocatorClient } from "#veryfront/agent/hosted/executor-session.ts";
import {
  getHostedExecutorAllocationRequestSchema,
  getHostedExecutorBindingSchema,
  parseHostedExecutorData,
} from "#veryfront/agent/hosted/executor-session-schema.ts";

const MAX_BYTES = 32 * 1024;
const failure = () => new Error("Executor allocator request failed");

function origin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Executor allocator requires HTTPS");
  }
  if (
    url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
    url.search || url.hash
  ) {
    throw new TypeError("Executor allocator requires a fixed HTTPS origin");
  }
  return url;
}

function payload(value: unknown): Buffer {
  const encoded = Buffer.from(JSON.stringify(value));
  if (encoded.byteLength > MAX_BYTES) {
    encoded.fill(0);
    throw new TypeError("Executor allocator request is too large");
  }
  return encoded;
}

/**
 * Trusted broker client for the operator's dedicated TLS endpoint. Each call
 * reads the rotated Pod-bound token. No redirects, automatic POST retries,
 * arbitrary headers, application credentials, or ambient gateway fallback.
 * The returned promise retains raw token-read and socket ownership; the
 * session supplies prompt cancellation notification separately.
 */
export function createHostedExecutorAllocatorClient(options: {
  baseUrl: string;
  /** Deployment-owned trust root; omit to use the system roots. Verification is always enabled. */
  ca?: string;
  readBrokerToken(signal: AbortSignal): Promise<string>;
  timeoutMs?: number;
}): HostedExecutorAllocatorClient {
  if (
    !isNodeRuntime() || process.release.name !== "node" ||
    Number(process.versions.node.split(".")[0]) < 22
  ) {
    throw new Error("Executor allocator client requires Node.js 22 or newer");
  }
  const base = origin(options.baseUrl);
  const ca = options.ca;
  if (ca !== undefined && (typeof ca !== "string" || !ca || ca.length > 256 * 1024)) {
    throw new TypeError("Invalid executor allocator trust root");
  }
  const readToken = options.readBrokerToken;
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (
    typeof readToken !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
    timeoutMs > 30_000
  ) {
    throw new TypeError("Invalid executor allocator client limits");
  }

  const call = async (
    operation: string,
    bytes: Buffer,
    parentSignal: AbortSignal,
  ): Promise<unknown> => {
    const deadline = new AbortController();
    const signal = AbortSignal.any([parentSignal, deadline.signal]);
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    let token = "";
    try {
      signal.throwIfAborted();
      token = await readToken(signal);
      signal.throwIfAborted();
      if (typeof token !== "string" || !/^[^\s,]{1,8192}$/.test(token)) throw failure();
      // Node socket destruction does not cancel getaddrinfo. Own its promise
      // before opening the socket, so session settlement includes queued DNS.
      const hostname = base.hostname.startsWith("[") ? base.hostname.slice(1, -1) : base.hostname;
      const address = await lookup(hostname);
      signal.throwIfAborted();
      return await new Promise<unknown>((resolve, reject) => {
        let responseValue: unknown;
        let complete = false;
        let failed = false;
        const chunks: Buffer[] = [];
        let size = 0;
        const request = httpsRequest(new URL(`/agent-executors/${operation}`, base), {
          method: "POST",
          agent: false,
          family: address.family,
          lookup: (_hostname, _options, callback) =>
            callback(null, address.address, address.family),
          rejectUnauthorized: true,
          ...(ca === undefined ? {} : { ca }),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "content-length": bytes.byteLength,
            accept: "application/json",
            connection: "close",
          },
        }, (response) => {
          const contentType = response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
          const encoding = response.headers["content-encoding"];
          const length = response.headers["content-length"];
          if (
            response.statusCode !== 200 || contentType !== "application/json" ||
            (encoding !== undefined && encoding !== "identity") ||
            (length !== undefined && (!/^[0-9]+$/.test(length) || Number(length) > MAX_BYTES))
          ) {
            fail();
            return;
          }
          response.on("data", (chunk: unknown) => {
            if (failed) return;
            if (!Buffer.isBuffer(chunk) || size + chunk.byteLength > MAX_BYTES) {
              fail();
              return;
            }
            size += chunk.byteLength;
            chunks.push(chunk);
          });
          response.on("error", fail);
          response.on("aborted", fail);
          response.on("end", () => {
            if (failed) return;
            try {
              const body = Buffer.concat(chunks, size);
              try {
                responseValue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
              } finally {
                body.fill(0);
              }
              complete = true;
              request.destroy();
            } catch {
              fail();
            }
          });
        });
        function fail() {
          failed = true;
          request.destroy();
        }
        request.on("error", fail);
        request.once("close", () => {
          signal.removeEventListener("abort", fail);
          for (const chunk of chunks) chunk.fill(0);
          chunks.length = 0;
          if (!failed && complete && !signal.aborted) resolve(responseValue);
          else reject(failure());
        });
        signal.addEventListener("abort", fail, { once: true });
        if (signal.aborted) fail();
        else request.end(bytes);
      });
    } catch {
      throw failure();
    } finally {
      clearTimeout(timer);
      token = "";
      bytes.fill(0);
    }
  };

  return {
    allocate(request, bootstrap, signal) {
      if (!(bootstrap.channelKey instanceof Uint8Array) || bootstrap.channelKey.byteLength !== 32) {
        throw new TypeError("Executor allocation requires 32 key bytes");
      }
      const key = new Uint8Array(bootstrap.channelKey);
      try {
        const body = payload({
          request: parseHostedExecutorData(getHostedExecutorAllocationRequestSchema(), request),
          channelKey: Buffer.from(key.buffer, key.byteOffset, key.byteLength).toString("base64"),
        });
        return call("allocate", body, signal);
      } finally {
        key.fill(0);
      }
    },
    observe(binding, signal) {
      return call(
        "observe",
        payload({ binding: parseHostedExecutorData(getHostedExecutorBindingSchema(), binding) }),
        signal,
      );
    },
    renew(binding, signal) {
      return call(
        "renew",
        payload({ binding: parseHostedExecutorData(getHostedExecutorBindingSchema(), binding) }),
        signal,
      );
    },
    release(binding, reason, signal) {
      if (reason !== "completed" && reason !== "canceled") {
        throw new TypeError("Invalid executor release reason");
      }
      return call(
        "release",
        payload({
          binding: parseHostedExecutorData(getHostedExecutorBindingSchema(), binding),
          reason,
        }),
        signal,
      );
    },
  };
}
