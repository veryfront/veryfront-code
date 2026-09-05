/**
 * Token storage adapter credential and destination handling.
 *
 * The adapter selects `veryfront-api` storage from a host-private stored login
 * token, so the request must go to the host-owned API origin over the host
 * transport even when a project `.env` names its own `VERYFRONT_API_URL`.
 * Proving that needs a real `.env` on disk plus a global env-loader reset and
 * a replaced ambient `fetch`, all process-global effects, so it lives in the
 * semantic integration suite rather than beside the adapter unit tests.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteHostSecret, setHostSecret } from "#veryfront/platform/compat/process/env.ts";
import { deleteEnv, setEnv, withTempDir } from "#veryfront/testing/deno-compat.ts";
import { __resetEnvLoaderForTests, loadEnv } from "#veryfront/utils/env-loader.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  getTokenStorageAdapter,
  resetTokenStorageAdapter,
} from "../../../../../../../src/platform/adapters/token/integration.ts";

describe("platform/adapters/token/integration host credential boundary", () => {
  afterEach(() => {
    for (const key of ["VERYFRONT_API_TOKEN", "VERYFRONT_PROJECT_SLUG", "VERYFRONT_API_URL"]) {
      try {
        deleteEnv(key);
      } catch {
        // expected: env may already be unset
      }
    }
    resetTokenStorageAdapter();
    deleteHostSecret("VERYFRONT_API_TOKEN");
    __resetEnvLoaderForTests();
  });

  it("keeps a host-private token on its host-owned origin and transport", async () => {
    setEnv("VERYFRONT_PROJECT_SLUG", "test-project");
    setHostSecret("VERYFRONT_API_TOKEN", "host-private-token");
    const requests: Array<{ origin: string; authorization: string }> = [];
    let ambientFetchCalled = false;
    let privateTokenReachedMutableTrim = false;

    await withTempDir(async (dir) => {
      await Deno.writeTextFile(
        `${dir}/.env`,
        "VERYFRONT_API_URL=https://project-controlled.example\n",
      );
      await loadEnv({ cwd: dir, override: true });

      await withMockFetch(
        ((input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(String(input));
          requests.push({
            origin: url.origin,
            authorization: new Headers(init?.headers).get("authorization") ?? "",
          });
          return Promise.resolve(Response.json({ keys: [] }));
        }) as typeof fetch,
        async () => {
          // Deliberately the opposite of stubbing: the ambient global is set to
          // a value the host transport does not share, so a call that reached
          // for `globalThis.fetch` instead of the transport is visible.
          // `withMockFetch` owns the transport and restores this global.
          Object.defineProperty(globalThis, "fetch", {
            value: () => {
              ambientFetchCalled = true;
              return Promise.reject(
                new Error("project fetch must not receive token storage auth"),
              );
            },
            configurable: true,
            writable: true,
          });
          const originalTrim = String.prototype.trim;
          String.prototype.trim = function (): string {
            if (String(this) === "host-private-token") {
              privateTokenReachedMutableTrim = true;
            }
            return Reflect.apply(originalTrim, this, []);
          };
          try {
            await getTokenStorageAdapter();
          } finally {
            String.prototype.trim = originalTrim;
          }
        },
      );
    });

    assertEquals(ambientFetchCalled, false);
    assertEquals(privateTokenReachedMutableTrim, false);
    assertEquals(requests, [{
      origin: "https://api.veryfront.com",
      authorization: "Bearer host-private-token",
    }]);
  });
});
