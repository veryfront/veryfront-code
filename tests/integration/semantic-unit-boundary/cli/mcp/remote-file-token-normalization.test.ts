/**
 * Remote-file MCP token normalization under a poisoned `String.prototype`.
 *
 * The assertion needs a process-global prototype replacement, which the unit
 * boundary for `cli/mcp/remote-file-tools.test.ts` does not admit, so it lives
 * here instead of growing that file's semantic disposition.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  _resetEnvironmentConfig,
  _setEnvironmentConfigForTesting,
} from "#veryfront/config/environment-config.ts";
import { deleteHostSecret, setHostSecret } from "#veryfront/platform/compat/process/env.ts";

import { vfRemoteGetFile } from "../../../../../cli/mcp/remote-file-tools.ts";

describe("remote-file MCP token normalization", () => {
  it("never hands the stored login token to a replaced String.prototype.trim", async () => {
    // The environment snapshot carries no token: the stored `veryfront login`
    // credential is registered host-privately, and `getApiToken()` normalizes
    // it before use. Project code served by `veryfront dev` runs in this realm
    // and can replace `String.prototype.trim`, so that normalization must not
    // pass the credential to the replacement as its method receiver.
    _setEnvironmentConfigForTesting({
      apiBaseUrl: "https://api.remote-vf.test",
      apiToken: undefined,
      nodeEnv: "test",
      veryfrontEnv: "test",
      veryfrontMode: "test",
      debug: false,
      ci: false,
      denoTesting: false,
      perfEnabled: false,
      publicApiBaseUrl: "https://api.remote-vf.test",
      apiUrl: "https://api.remote-vf.test/graphql",
      projectSlug: "project",
    });
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

    const originalTrim = Object.getOwnPropertyDescriptor(String.prototype, "trim")!;
    let observedCredential = 0;
    Object.defineProperty(String.prototype, "trim", {
      configurable: true,
      writable: true,
      value: function (this: unknown): string {
        if (this === "stored-login-token") observedCredential += 1;
        return Reflect.apply(originalTrim.value, this, []);
      },
    });

    let requestAuth = "";
    try {
      await withMockFetch(async (input, init) => {
        requestAuth = new Request(input, init).headers.get("Authorization") ?? "";
        return new Response(
          JSON.stringify({
            id: "1",
            path: "pages/index.tsx",
            content: "export default function Page() {}",
            size: 42,
            type: "file",
            updated_at: "2024-01-01T00:00:00.000Z",
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }, async () => {
        return await vfRemoteGetFile.execute({
          project: "my-project",
          path: "pages/index.tsx",
        });
      });
    } finally {
      Object.defineProperty(String.prototype, "trim", originalTrim);
      deleteHostSecret("VERYFRONT_API_TOKEN");
      _resetEnvironmentConfig();
    }

    // The credential still authenticates the call, and the poisoned hook never
    // received it as a receiver.
    assertEquals(requestAuth, "Bearer stored-login-token");
    assertEquals(observedCredential, 0);
  });

  it("routes the credential through the host transport, not globalThis.fetch", async () => {
    // Project code served by `veryfront dev` can also replace
    // `globalThis.fetch`. The remote-file API request must not hand its
    // replacement the `Authorization` header carrying the stored login token.
    _setEnvironmentConfigForTesting({
      apiBaseUrl: "https://api.remote-vf.test",
      apiToken: undefined,
      nodeEnv: "test",
      veryfrontEnv: "test",
      veryfrontMode: "test",
      debug: false,
      ci: false,
      denoTesting: false,
      perfEnabled: false,
      publicApiBaseUrl: "https://api.remote-vf.test",
      apiUrl: "https://api.remote-vf.test/graphql",
      projectSlug: "project",
    });
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

    let requestAuth = "";
    let hostileFetchCalls = 0;
    try {
      await withMockFetch(async (input, init) => {
        requestAuth = new Request(input, init).headers.get("Authorization") ?? "";
        return new Response(
          JSON.stringify({
            id: "1",
            path: "pages/index.tsx",
            content: "export default function Page() {}",
            size: 42,
            type: "file",
            updated_at: "2024-01-01T00:00:00.000Z",
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }, async () => {
        // Deliberate hostile replacement, not a test stub: the mock transport
        // installed by `withMockFetch` must still carry the request while this
        // project-style hook observes nothing.
        const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch")!;
        Object.defineProperty(globalThis, "fetch", {
          configurable: true,
          writable: true,
          value: (): Promise<Response> => {
            hostileFetchCalls += 1;
            return Promise.resolve(new Response("{}", { status: 200 }));
          },
        });
        try {
          return await vfRemoteGetFile.execute({
            project: "my-project",
            path: "pages/index.tsx",
          });
        } finally {
          Object.defineProperty(globalThis, "fetch", originalFetch);
        }
      });
    } finally {
      deleteHostSecret("VERYFRONT_API_TOKEN");
      _resetEnvironmentConfig();
    }

    // The request still authenticated through the host transport, and the
    // replaced global never ran.
    assertEquals(requestAuth, "Bearer stored-login-token");
    assertEquals(hostileFetchCalls, 0);
  });
});
