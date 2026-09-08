import { assertEquals } from "@std/assert";
import { createProxyHandler, type ProxyConfig } from "./handler.ts";

const BASE_CONFIG: ProxyConfig = {
  apiBaseUrl: "https://api.example.test",
  apiClientId: "client",
  apiClientSecret: "secret",
  previewApiClientId: "client",
  previewApiClientSecret: "secret",
};

Deno.test("enabled legacy managed agent denial returns before lookup and leaves request bodies unread", async () => {
  let metadataRequests = 0;
  const handler = createProxyHandler({
    config: { ...BASE_CONFIG, denyLegacyManagedAgentRoutes: true },
    metadataFetch: () => {
      metadataRequests++;
      throw new Error("legacy managed route reached metadata lookup");
    },
  });
  const routes = [
    ["POST", "/api/ag-ui"],
    ["POST", "/api/runs"],
    ["POST", "/api/runs/run_1/resume"],
    ["DELETE", "/api/runs/run_1"],
    ["POST", "/api/control-plane/agents/list"],
    ["POST", "/api/control-plane/runs/run_1/execute"],
    ["POST", "/api/control-plane/runs/run_1/stream"],
    ["POST", "/api/control-plane/runs/run_1/resume"],
    ["DELETE", "/api/control-plane/runs/run_1"],
    ["POST", "//api/ag-ui"],
    ["POST", "///api/runs"],
  ] as const;
  const hosts = [
    "project.preview.veryfront.com",
    "project.production.veryfront.com",
    "project.example.test",
  ] as const;

  try {
    for (const host of hosts) {
      for (const [method, path] of routes) {
        const request = new Request(`https://${host}${path}`, {
          method,
          headers: {
            authorization: "Bearer synthetic-control-plane-token",
            "content-type": "application/json",
            "x-token": "synthetic-platform-token",
            "x-veryfront-control-plane-jws": "malformed",
          },
          body: method === "POST" ? JSON.stringify({ synthetic: "body-marker" }) : undefined,
        });

        const context = await handler.processRequest(request);

        assertEquals(context.error?.status, 404, `${method} ${host}${path}`);
        assertEquals(context.error?.message, "Not found", `${method} ${host}${path}`);
        assertEquals(request.bodyUsed, false, `${method} ${host}${path}`);
      }
    }
    assertEquals(metadataRequests, 0);
  } finally {
    await handler.close();
  }
});

Deno.test("legacy managed agent denial remains dormant when omitted", async () => {
  const handler = createProxyHandler({ config: BASE_CONFIG });
  try {
    const context = await handler.processRequest(
      new Request("http://localhost/api/runs", { method: "POST" }),
    );
    assertEquals(context.error, undefined);
  } finally {
    await handler.close();
  }
});
