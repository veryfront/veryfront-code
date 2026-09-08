import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createProxyHandler, type ProxyConfig } from "./handler.ts";

const BASE_CONFIG: ProxyConfig = {
  apiBaseUrl: "https://api.example.test",
  apiClientId: "client",
  apiClientSecret: "secret",
  previewApiClientId: "client",
  previewApiClientSecret: "secret",
};

describe("proxy legacy managed agent route denial", () => {
  it("returns before lookup and leaves request bodies unread when enabled", async () => {
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
      ["POST", "/api/ag-ui/"],
      ["POST", "/api//ag-ui"],
      ["POST", "/api/runs//run_1//resume/"],
      ["DELETE", "/api//control-plane/runs/run_1/"],
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

  it("remains dormant when omitted", async () => {
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

  it("keeps renderer-equivalent internal namespace aliases reserved", async () => {
    let metadataRequests = 0;
    const handler = createProxyHandler({
      config: BASE_CONFIG,
      metadataFetch: () => {
        metadataRequests++;
        throw new Error("reserved route reached metadata lookup");
      },
    });
    try {
      for (
        const path of [
          "//api//control-plane/application-route/",
          "/api/control-plane/runs/run_1/stream/",
          "/channels/invoke/",
        ]
      ) {
        const request = new Request(`https://project.preview.veryfront.com${path}`, {
          method: "POST",
          body: "synthetic-body-marker",
        });
        const context = await handler.processRequest(request);
        assertEquals(context.error?.status, 404, path);
        assertEquals(context.error?.message, "Not found", path);
        assertEquals(request.bodyUsed, false, path);
      }
      assertEquals(metadataRequests, 0);
    } finally {
      await handler.close();
    }
  });
});
