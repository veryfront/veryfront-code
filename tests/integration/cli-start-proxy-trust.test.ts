import "../_helpers/contract-init.ts";

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { startCliProxyModeServer } from "../../cli/shared/server-startup.ts";
import { createProxyHandler, injectContextHeaders } from "veryfront/proxy/handler";

const MUTATED_ENV_KEYS = [
  "PROXY_MODE",
  "VERYFRONT_CLI_LOCAL_PROXY_MODE",
  "VERYFRONT_TRUST_FORWARDED_HEADERS",
  "NODE_ENV",
  "DENO_ENV",
  "VERYFRONT_API_BASE_URL",
] as const;

function snapshotEnvironment(): Map<string, string | undefined> {
  return new Map(MUTATED_ENV_KEYS.map((key) => [key, Deno.env.get(key)]));
}

function restoreEnvironment(snapshot: Map<string, string | undefined>): void {
  for (const key of MUTATED_ENV_KEYS) {
    const value = snapshot.get(key);
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
}

function getAvailablePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

describe("CLI start same-process proxy trust", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  it("admits a tokenless local project without manually trusting forwarded headers", async () => {
    const previousEnv = snapshotEnvironment();
    Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
    Deno.env.delete("NODE_ENV");
    Deno.env.delete("DENO_ENV");
    Deno.env.set("VERYFRONT_API_BASE_URL", "http://127.0.0.1:1");

    const projectDir = `${Deno.cwd()}/cli/templates/files/minimal`;
    const localProjects = { minimal: projectDir };

    const proxy = createProxyHandler({
      config: {
        apiBaseUrl: "http://127.0.0.1:1",
        apiClientId: "",
        apiClientSecret: "",
        previewApiClientId: "",
        previewApiClientSecret: "",
        localProjects,
      },
    });
    const abortController = new AbortController();
    const port = getAvailablePort();
    let server: Awaited<ReturnType<typeof startCliProxyModeServer>> | undefined;

    try {
      server = await startCliProxyModeServer({
        port,
        projectDir,
        signal: abortController.signal,
        requestInterceptor: async (request) =>
          injectContextHeaders(request, await proxy.processRequest(request)),
        defaultProjectId: "local-cli-start-test",
        localProjects,
      });
      await server.ready;

      assertEquals(Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS"), undefined);
      const response = await fetch(`http://minimal.localhost:${port}/`);
      const responseBody = await response.text();

      assertEquals(response.status, 200, responseBody);
      assertStringIncludes(responseBody, "<!DOCTYPE html>");
      assertEquals(responseBody.includes("Untrusted proxy topology"), false);
      assertEquals(responseBody.includes("Missing authentication context"), false);
    } finally {
      abortController.abort();
      await server?.stop();
      await proxy.close();
      restoreEnvironment(previousEnv);
    }
  });
});
