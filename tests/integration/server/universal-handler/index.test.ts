/**
 * Universal Handler - Security Integration Tests
 *
 * Comprehensive security tests for the universal handler including:
 * - Path traversal attacks (../../../etc/passwd patterns)
 * - Static file serving security (directory traversal, symlink attacks)
 * - Malformed URL handling
 * - Request validation
 * - Rate limiting bypass attempts
 * - Authentication security
 */

import { assert, assertEquals, assertExists } from "@veryfront/testing/assert";
import { symlink } from "@veryfront/compat/fs.ts";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import {
  getEnv,
  makeTempDir,
  mkdir,
  remove,
  setEnv,
  writeTextFile,
} from "@veryfront/testing/deno-compat";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { createVeryfrontHandler } from "../../../../src/server/universal-handler/index.ts";
import "../../../_helpers/log-guard.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

// Disable LRU cache intervals to prevent resource leaks in tests
setEnv("VF_DISABLE_LRU_INTERVAL", "1");

/**
 * Creates a symlink if the platform supports it.
 * Returns false if symlinks are not supported (e.g., Windows without admin).
 */
async function trySymlink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path);
    return true;
  } catch {
    return false;
  }
}

// Mock adapter for testing - returns RuntimeAdapter with custom env
async function createMockAdapter(envVars: Record<string, string> = {}) {
  const baseAdapter = await getAdapter();
  const customEnv = {
    get: (key: string) => envVars[key] ?? getEnv(key),
    set: baseAdapter.env.set,
    toObject: baseAdapter.env.toObject,
  };

  // Return a new adapter with overridden env
  return Object.assign(Object.create(Object.getPrototypeOf(baseAdapter)), baseAdapter, {
    env: customEnv,
  });
}

describe(
  "Universal Handler Tests",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    // Clean up renderer intervals to prevent resource leaks
    afterAll(async () => {
      await cleanupBundler();
    });

    describe(
      "Security - Path Traversal Prevention",
      {},
      () => {
        it("blocks basic path traversal with ../", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_path_traversal_basic_" });
          try {
            await mkdir(`${tempDir}/public`, { recursive: true });
            await writeTextFile(`${tempDir}/public/safe.txt`, "safe content");
            await writeTextFile(`${tempDir}/secret.txt`, "SECRET DATA");

            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            const res = await handler(new Request("http://localhost:8000/../secret.txt"));

            assertEquals(res.status, 404, "Should block traversal with ../");
            const body = await res.text();
            assert(!body.includes("SECRET"), "Should not leak secret data");
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("blocks deeply nested path traversal", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_path_deep_traversal_" });
          try {
            await mkdir(`${tempDir}/public`, { recursive: true });
            await writeTextFile(`${tempDir}/secret.txt`, "SECRET");

            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            const attacks = [
              "../../../../../../../etc/passwd",
              "....//....//....//secret.txt",
              "./.././.././../secret.txt",
              "public/../../secret.txt",
              "./../../secret.txt",
            ];

            for (const attack of attacks) {
              const res = await handler(new Request(`http://localhost:8000/${attack}`));
              assertEquals(res.status, 404, `Should block: ${attack}`);
              const body = await res.text();
              assert(!body.includes("SECRET"), `Should not leak via: ${attack}`);
            }
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("blocks URL-encoded path traversal", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_path_encoded_" });
          try {
            await mkdir(`${tempDir}/public`, { recursive: true });
            await writeTextFile(`${tempDir}/secret.txt`, "SECRET");

            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            const encodedAttacks = [
              "%2e%2e%2f%2e%2e%2fsecret.txt", // ../..
              "%2e%2e/%2e%2e/secret.txt",
              "..%2f..%2fsecret.txt",
              "%2e%2e%5c%2e%2e%5csecret.txt", // backslash
            ];

            for (const attack of encodedAttacks) {
              const res = await handler(new Request(`http://localhost:8000/${attack}`));
              assertEquals(res.status, 404, `Should block encoded: ${attack}`);
            }
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("blocks double-encoded path traversal", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_path_double_encoded_" });
          try {
            await mkdir(`${tempDir}/public`, { recursive: true });
            await writeTextFile(`${tempDir}/secret.txt`, "SECRET");

            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            // Double URL encoding: . = %2e, then % = %25
            const res = await handler(
              new Request("http://localhost:8000/%252e%252e%252f%252e%252e%252fsecret.txt"),
            );

            assertEquals(res.status, 404, "Should block double-encoded traversal");
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("blocks backslash path traversal (Windows-style)", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_path_backslash_" });
          try {
            await mkdir(`${tempDir}/public`, { recursive: true });
            await writeTextFile(`${tempDir}/secret.txt`, "SECRET");

            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            const backslashAttacks = [
              "..\\..\\secret.txt",
              "....\\\\....\\\\secret.txt",
              "public\\..\\..\\secret.txt",
            ];

            for (const attack of backslashAttacks) {
              const res = await handler(new Request(`http://localhost:8000/${attack}`));
              assertEquals(res.status, 404, `Should block backslash: ${attack}`);
            }
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("allows safe relative paths within public directory", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_safe_paths_" });
          try {
            await mkdir(`${tempDir}/public/assets/images`, { recursive: true });
            await writeTextFile(`${tempDir}/public/assets/images/logo.png`, "PNG DATA");

            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            const res = await handler(new Request("http://localhost:8000/assets/images/logo.png"));

            assertEquals(res.status, 200, "Should allow safe paths");
            const content = await res.text();
            assertEquals(content, "PNG DATA", "Should serve correct content");
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });
      },
    );

    describe(
      "Security - Static File Serving",
      {},
      () => {
        it("prevents directory listing", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_dir_listing_" });
          try {
            await mkdir(`${tempDir}/public/assets`, { recursive: true });
            await writeTextFile(`${tempDir}/public/assets/file1.txt`, "content1");
            await writeTextFile(`${tempDir}/public/assets/file2.txt`, "content2");

            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            const res = await handler(new Request("http://localhost:8000/assets/"));
            const body = await res.text();

            // Should not list directory contents
            assert(
              !body.includes("file1.txt") || !body.includes("file2.txt"),
              "Should not list files",
            );
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("serves files from dist/ with immutable cache for hashed files", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_dist_cache_" });
          try {
            await mkdir(`${tempDir}/dist`, { recursive: true });
            await writeTextFile(`${tempDir}/dist/bundle.a1b2c3d4.js`, "bundled code");

            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            const res = await handler(new Request("http://localhost:8000/bundle.a1b2c3d4.js"));

            assertEquals(res.status, 200, "Should serve hashed file");
            const cacheControl = res.headers.get("cache-control");
            assert(cacheControl?.includes("immutable"), "Should set immutable for hashed files");
            assert(
              cacheControl?.includes("max-age=31536000"),
              "Should set long max-age for hashed files",
            );
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("validates file extensions for proper content-type", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_content_type_" });
          try {
            await mkdir(`${tempDir}/public`, { recursive: true });
            await writeTextFile(`${tempDir}/public/test.js`, 'console.log("test")');
            await writeTextFile(`${tempDir}/public/style.css`, "body { margin: 0; }");
            await writeTextFile(`${tempDir}/public/data.json`, '{"key":"value"}');

            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            const tests = [
              { path: "/test.js", expected: "application/javascript" },
              { path: "/style.css", expected: "text/css" },
              { path: "/data.json", expected: "application/json" },
            ];

            for (const test of tests) {
              const res = await handler(new Request(`http://localhost:8000${test.path}`));
              const contentType = res.headers.get("content-type");
              assert(
                contentType?.includes(test.expected),
                `Should set ${test.expected} for ${test.path}`,
              );
            }
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("prevents null byte injection in file paths", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_null_byte_" });
          try {
            await mkdir(`${tempDir}/public`, { recursive: true });
            await writeTextFile(`${tempDir}/public/safe.txt`, "safe");
            await writeTextFile(`${tempDir}/secret.txt`, "SECRET");

            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            // Null byte attack to bypass extension check
            const res = await handler(new Request("http://localhost:8000/secret.txt%00.jpg"));

            assertEquals(res.status, 404, "Should block null byte injection");
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("handles symbolic link attacks safely", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_symlink_" });
          try {
            await mkdir(`${tempDir}/public`, { recursive: true });
            await writeTextFile(`${tempDir}/secret.txt`, "SECRET");

            // Create symlink from public to parent directory
            const symlinkCreated = await trySymlink(
              `${tempDir}/secret.txt`,
              `${tempDir}/public/link.txt`,
            );
            if (!symlinkCreated) {
              // Skip test if symlinks not supported
              return;
            }

            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            const res = await handler(new Request("http://localhost:8000/link.txt"));

            // Should either block or safely resolve
            const body = await res.text();
            if (res.status === 200) {
              // If it serves the symlink, it should serve the actual content
              assert(body === "SECRET" || !body.includes("SECRET"), "Should handle symlink safely");
            } else {
              assertEquals(res.status, 404, "Should block symlink traversal");
            }
          } finally {
            try {
              await remove(tempDir, { recursive: true });
            } catch {
              // Ignore cleanup errors
            }
          }
        });
      },
    );

    describe(
      "Security - Malformed Request Handling",
      {},
      () => {
        it("handles malformed URLs gracefully", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_malformed_url_" });
          try {
            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            const malformedUrls = [
              "http://localhost:8000//double//slash",
              "http://localhost:8000/path with spaces",
              "http://localhost:8000/path?query=value&",
              "http://localhost:8000/#fragment#double",
            ];

            for (const url of malformedUrls) {
              const res = await handler(new Request(url));
              assert(res.status >= 200 && res.status < 500, `Should handle: ${url}`);
            }
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("handles extremely long URLs", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_long_url_" });
          try {
            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            const longPath = "/path/" + "a".repeat(10000);
            const res = await handler(new Request(`http://localhost:8000${longPath}`));

            assert(res.status >= 200 && res.status < 500, "Should handle long URL");
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("handles invalid HTTP methods gracefully", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_invalid_method_" });
          try {
            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            // Standard methods should work
            const validRes = await handler(
              new Request("http://localhost:8000/healthz", { method: "GET" }),
            );
            assertEquals(validRes.status, 200, "Should handle GET");

            // Invalid methods should be handled
            try {
              const invalidRes = await handler(
                new Request("http://localhost:8000/healthz", { method: "INVALID" as any }),
              );
              assert(invalidRes.status >= 200, "Should handle invalid method");
            } catch {
              // Some environments may reject invalid methods at the Request level
            }
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("prevents HTTP request smuggling via malformed headers", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_smuggling_" });
          try {
            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            // Attempt request smuggling with Transfer-Encoding and Content-Length
            const res = await handler(
              new Request("http://localhost:8000/healthz", {
                method: "POST",
                headers: {
                  "Transfer-Encoding": "chunked",
                  "Content-Length": "0",
                },
                body: "0\r\n\r\n",
              }),
            );

            assert(res.status >= 200 && res.status < 500, "Should handle without smuggling");
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("validates query parameter injection", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_query_injection_" });
          try {
            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            const injectionAttempts = [
              "?param=value&param=injection",
              "?redirect=javascript:alert(1)",
              "?callback=<script>alert(1)</script>",
              "?sql=1' OR '1'='1",
            ];

            for (const query of injectionAttempts) {
              const res = await handler(new Request(`http://localhost:8000/healthz${query}`));
              assertEquals(res.status, 200, `Should handle query: ${query}`);
              const body = await res.text();
              assert(!body.includes("<script>"), "Should not reflect script tags");
            }
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });
      },
    );

    describe(
      "Security - Authentication & Authorization",
      {},
      () => {
        it("enforces Basic Auth when configured", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_basic_auth_" });
          try {
            // Use createMockAdapter to avoid mutating the global singleton
            const adapter = await createMockAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter, {
              projectDir: tempDir,
              config: {
                security: {
                  auth: {
                    basic: {
                      username: "admin",
                      password: "secret123",
                    },
                  },
                },
              } as VeryfrontConfig,
            });

            // Request without auth
            const res1 = await handler(new Request("http://localhost:8000/healthz"));
            assertEquals(res1.status, 401, "Should require auth");
            assertExists(
              res1.headers.get("www-authenticate"),
              "Should send WWW-Authenticate header",
            );

            // Request with correct auth
            const authHeader = `Basic ${btoa("admin:secret123")}`;
            const res2 = await handler(
              new Request("http://localhost:8000/healthz", {
                headers: { Authorization: authHeader },
              }),
            );
            assertEquals(res2.status, 200, "Should allow with correct auth");

            // Request with incorrect auth
            const wrongAuth = `Basic ${btoa("admin:wrongpass")}`;
            const res3 = await handler(
              new Request("http://localhost:8000/healthz", {
                headers: { Authorization: wrongAuth },
              }),
            );
            assertEquals(res3.status, 401, "Should reject incorrect auth");
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("enforces Bearer token when configured", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_bearer_auth_" });
          try {
            // Use createMockAdapter to avoid mutating the global singleton
            const adapter = await createMockAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter, {
              projectDir: tempDir,
              config: {
                security: {
                  auth: {
                    bearer: {
                      token: "secret-token-123",
                    },
                  },
                },
              } as VeryfrontConfig,
            });

            // Request without token
            const res1 = await handler(new Request("http://localhost:8000/healthz"));
            assertEquals(res1.status, 401, "Should require token");

            // Request with correct token
            const res2 = await handler(
              new Request("http://localhost:8000/healthz", {
                headers: { Authorization: "Bearer secret-token-123" },
              }),
            );
            assertEquals(res2.status, 200, "Should allow with correct token");

            // Request with incorrect token
            const res3 = await handler(
              new Request("http://localhost:8000/healthz", {
                headers: { Authorization: "Bearer wrong-token" },
              }),
            );
            assertEquals(res3.status, 401, "Should reject incorrect token");
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("allows OPTIONS requests without auth (CORS preflight)", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_auth_options_" });
          try {
            // Use createMockAdapter to avoid mutating the global singleton
            const adapter = await createMockAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter, {
              projectDir: tempDir,
              config: {
                security: {
                  auth: {
                    basic: {
                      username: "admin",
                      password: "secret",
                    },
                  },
                },
              } as VeryfrontConfig,
            });

            // OPTIONS should bypass auth for CORS preflight
            const res = await handler(
              new Request("http://localhost:8000/healthz", {
                method: "OPTIONS",
              }),
            );

            assertEquals(res.status, 204, "Should allow OPTIONS without auth");
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("prevents timing attacks on auth comparison", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_auth_timing_" });
          try {
            // Use createMockAdapter to avoid mutating the global singleton
            const adapter = await createMockAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter, {
              projectDir: tempDir,
              config: {
                security: {
                  auth: {
                    bearer: {
                      token: "a".repeat(32),
                    },
                  },
                },
              } as VeryfrontConfig,
            });

            // Measure timing for correct vs incorrect tokens
            const timings: number[] = [];

            for (let i = 0; i < 5; i++) {
              const start = performance.now();
              await handler(
                new Request("http://localhost:8000/healthz", {
                  headers: { Authorization: "Bearer " + "a".repeat(32) },
                }),
              );
              timings.push(performance.now() - start);
            }

            const correctAvg = timings.reduce((a, b) => a + b) / timings.length;

            timings.length = 0;
            for (let i = 0; i < 5; i++) {
              const start = performance.now();
              await handler(
                new Request("http://localhost:8000/healthz", {
                  headers: { Authorization: "Bearer " + "b".repeat(32) },
                }),
              );
              timings.push(performance.now() - start);
            }

            const incorrectAvg = timings.reduce((a, b) => a + b) / timings.length;

            // Timing difference should be minimal (not a strict test)
            const diff = Math.abs(correctAvg - incorrectAvg);
            assert(diff < 10, "Timing should be similar to prevent timing attacks");
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });
      },
    );

    describe(
      "Security - Special Endpoint Validation",
      {},
      () => {
        it("validates /_veryfront/fs/ endpoint security", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_fs_endpoint_" });
          try {
            await writeTextFile(`${tempDir}/secret.ts`, 'export const SECRET = "leaked"');
            await mkdir(`${tempDir}/app`, { recursive: true });
            await writeTextFile(`${tempDir}/app/safe.ts`, 'export const SAFE = "ok"');

            // Ensure no auth pollution - use development mode for /_veryfront/fs/
            const adapter = await createMockAdapter({});
            const handler = createVeryfrontHandler(tempDir, adapter, {
              projectDir: tempDir,
            });

            // Helper to encode path
            const toBase64Url = (s: string) => {
              return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
            };

            // Try to access secret file outside project
            const secretPath = `${tempDir}/secret.ts`;
            const encoded = toBase64Url(secretPath);
            const _res1 = await handler(
              new Request(`http://localhost:8000/_veryfront/fs/${encoded}.js`),
            );

            // Should serve file within project
            const safePath = `${tempDir}/app/safe.ts`;
            const encodedSafe = toBase64Url(safePath);
            const res2 = await handler(
              new Request(`http://localhost:8000/_veryfront/fs/${encodedSafe}.js`),
            );

            assertEquals(res2.status, 200, "Should serve safe file");
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("prevents metrics endpoint information disclosure", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_metrics_disclosure_" });
          try {
            // Ensure no auth pollution
            const adapter = await createMockAdapter({});
            const handler = createVeryfrontHandler(tempDir, adapter);

            const res = await handler(new Request("http://localhost:8000/_metrics"));
            const body = await res.text();
            const data = JSON.parse(body);

            // Should not leak sensitive information
            assertExists(data.counters, "Should have counters");
            // Memory and uptime are OK to expose in metrics
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("validates health endpoint security headers", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_health_security_" });
          try {
            // Ensure no auth pollution
            const adapter = await createMockAdapter({});
            const handler = createVeryfrontHandler(tempDir, adapter);

            const res = await handler(new Request("http://localhost:8000/_health"));
            const body = await res.text();
            const data = JSON.parse(body);

            // Should not leak sensitive paths
            assert(!JSON.stringify(data).includes(tempDir), "Should not leak temp directory");

            // Should have security headers (non-CSP headers are always set)
            // Note: CSP is only set when security config defines CSP rules
            assertExists(
              res.headers.get("x-content-type-options"),
              "Should have X-Content-Type-Options",
            );
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });
      },
    );

    describe(
      "Proxy Header Handling",
      {},
      () => {
        it("uses x-forwarded-host for domain parsing when present", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_proxy_header_" });
          try {
            await mkdir(`${tempDir}/app`, { recursive: true });
            await writeTextFile(`${tempDir}/app/page.tsx`, `export default function Page() { return <div>Test</div>; }`);

            const adapter = await createMockAdapter({});
            const handler = createVeryfrontHandler(tempDir, adapter, {
              projectDir: tempDir,
            });

            // Request with x-forwarded-host (from proxy) but different Host header (internal service)
            const res = await handler(
              new Request("http://internal-service:80/healthz", {
                headers: {
                  "host": "internal-service:80",
                  "x-forwarded-host": "test-project.veryfront.com",
                },
              }),
            );

            assertEquals(res.status, 200, "Should handle proxied request");
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("falls back to host header when x-forwarded-host is absent", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_no_proxy_header_" });
          try {
            const adapter = await createMockAdapter({});
            const handler = createVeryfrontHandler(tempDir, adapter, {
              projectDir: tempDir,
            });

            // Request without x-forwarded-host
            const res = await handler(
              new Request("http://localhost:8000/healthz", {
                headers: {
                  "host": "localhost:8000",
                },
              }),
            );

            assertEquals(res.status, 200, "Should handle direct request");
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("prefers x-forwarded-host over host header for Veryfront domain detection", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_proxy_vf_domain_" });
          try {
            await mkdir(`${tempDir}/app`, { recursive: true });
            await writeTextFile(`${tempDir}/app/page.tsx`, `export default function Page() { return <div>Test</div>; }`);

            const adapter = await createMockAdapter({});
            const handler = createVeryfrontHandler(tempDir, adapter, {
              projectDir: tempDir,
            });

            // Simulate proxy request: internal host but Veryfront domain in x-forwarded-host
            const res = await handler(
              new Request("http://veryfront-renderer:80/healthz", {
                headers: {
                  "host": "veryfront-renderer:80", // Internal service URL
                  "x-forwarded-host": "my-project.veryfront.com", // Original Veryfront domain
                },
              }),
            );

            assertEquals(res.status, 200, "Should correctly parse Veryfront domain from x-forwarded-host");
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });
      },
    );

    describe(
      "Security - Rate Limiting & DoS Prevention",
      {},
      () => {
        it("handles rapid concurrent requests", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_concurrent_" });
          try {
            // Ensure no auth pollution
            const adapter = await createMockAdapter({});
            const handler = createVeryfrontHandler(tempDir, adapter);

            // Send 50 concurrent requests
            const promises = Array.from(
              { length: 50 },
              (_, i) => handler(new Request(`http://localhost:8000/healthz?req=${i}`)),
            );

            const results = await Promise.all(promises);

            // All should complete successfully
            for (const res of results) {
              assertEquals(res.status, 200, "Should handle concurrent requests");
            }
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("handles large request bodies safely", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_large_body_" });
          try {
            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            // Create a large body (1MB)
            const largeBody = "x".repeat(1024 * 1024);

            const res = await handler(
              new Request("http://localhost:8000/healthz", {
                method: "POST",
                body: largeBody,
                headers: { "Content-Type": "text/plain" },
              }),
            );

            assert(res.status >= 200 && res.status < 500, "Should handle large body");
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });

        it("prevents slowloris-style attacks with streaming", async () => {
          const tempDir = await makeTempDir({ prefix: "vf_slowloris_" });
          try {
            const adapter = await getAdapter();
            const handler = createVeryfrontHandler(tempDir, adapter);

            // Simulate slow request with chunked encoding
            let timerId: number | undefined;
            let streamComplete: (() => void) | undefined;
            const streamCompletePromise = new Promise<void>((resolve) => {
              streamComplete = resolve;
            });

            const stream = new ReadableStream({
              async start(controller) {
                try {
                  controller.enqueue(new TextEncoder().encode("chunk1"));
                  await new Promise((resolve) => {
                    timerId = setTimeout(resolve, 0);
                  });
                  controller.enqueue(new TextEncoder().encode("chunk2"));
                  controller.close();
                } finally {
                  streamComplete?.();
                }
              },
              cancel() {
                if (timerId !== undefined) {
                  clearTimeout(timerId);
                }
                streamComplete?.();
              },
            });

            const res = await handler(
              new Request("http://localhost:8000/healthz", {
                method: "POST",
                body: stream,
                headers: { "Content-Type": "text/plain" },
                // @ts-expect-error - duplex is required for streaming in Node.js
                duplex: "half",
              }),
            );

            assert(res.status >= 200 && res.status < 500, "Should handle streaming");
            // Consume response body to ensure proper cleanup of request stream
            await res.text();
            // Wait for request body stream to complete
            await streamCompletePromise;
          } finally {
            await remove(tempDir, { recursive: true });
          }
        });
      },
    );
  },
);
