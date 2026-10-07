/**
 * The app shell reads and mutates process environment state while exercising the
 * guarded outbound transport. Keep this regression at the semantic integration
 * boundary rather than in the colocated CLI unit suite.
 */
import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import {
  __resetOperatorVeryfrontApiOriginsForTests,
  __runWithOutboundFetchTransportForTests,
} from "#cli/outbound-fetch";
import { createApp } from "../../../../../cli/app/shell.ts";

const ENV_KEYS = ["VERYFRONT_API_URL", "VERYFRONT_API_TOKEN"] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, Deno.env.get(key)]));

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) deleteEnv(key);
    else setEnv(key, value);
  }
  _resetEnvironmentConfig();
  __resetOperatorVeryfrontApiOriginsForTests();
}

describe("app/shell", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("seals the operator-selected private API before loading remote projects", async () => {
    const apiUrl = "https://api.staging.example/api";
    setEnv("VERYFRONT_API_URL", apiUrl);
    setEnv("VERYFRONT_API_TOKEN", "explicit-user-token");
    _resetEnvironmentConfig();
    __resetOperatorVeryfrontApiOriginsForTests();

    const paths: string[] = [];
    const fetchStub: typeof fetch = (input, _init) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      return Promise.resolve(Response.json(
        path === "/api/me"
          ? { id: "user-123", email: "test@example.com" }
          : { data: [{ id: "project-123", slug: "remote-project", name: "Remote Project" }] },
      ));
    };
    const transport = {
      fetch: fetchStub,
      pinnedFetch: (url: URL, _addresses: readonly string[], init: RequestInit) =>
        fetchStub(url, init),
      resolveHost: () => Promise.resolve(["10.255.128.3"]),
    };

    await __runWithOutboundFetchTransportForTests(transport, async () => {
      const app = createApp({ port: 3000, projects: new Map(), headless: true });
      await waitFor(() => app.getState().remoteProjects.items.length === 1, {
        interval: 10,
        message: "Expected app shell to load remote projects from the sealed private API",
      });

      assertEquals(paths, ["/api/me", "/api/projects"]);
      assertEquals(app.getState().remoteProjects.items[0]?.label, "remote-project");
    });
  });
});
