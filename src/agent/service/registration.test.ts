import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAgentServiceRegistrationLifecycle,
  resolveAgentServiceRegistrationInput,
} from "./registration.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const serviceResponse = {
  service: {
    id: "22222222-2222-4222-a222-222222222222",
    service_name: "docs-agent",
    service_key: "docs-agent:generated",
    scope_kind: "project",
    scope_key: "11111111-1111-4111-a111-111111111111",
    project_id: "11111111-1111-4111-a111-111111111111",
    agent_id: "support",
    base_url: "https://agent.example.com",
    invoke_url: "https://agent.example.com/api/runs",
    status: "active",
    capabilities: null,
    metadata: null,
    version: "0.1.0",
    runtime: "node",
    region: "iad",
    last_heartbeat_at: "2026-05-13T00:00:00.000Z",
    created_at: "2026-05-13T00:00:00.000Z",
    updated_at: "2026-05-13T00:00:00.000Z",
  },
};

describe("agent/agent-service-registration", () => {
  it("resolves auto registration only when token and public service URL are present", async () => {
    const input = await resolveAgentServiceRegistrationInput({
      config: {
        VERYFRONT_API_URL: "https://api.example.com",
        VERYFRONT_API_TOKEN: "token-1",
        VERYFRONT_PROJECT_ID: "11111111-1111-4111-a111-111111111111",
        VERYFRONT_AGENT_SERVICE_URL: "https://agent.example.com",
        VERYFRONT_AGENT_SERVICE_KEY: undefined,
        VERYFRONT_AGENT_SERVICE_REGISTRATION: "auto",
        VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: 30_000,
        VERYFRONT_AGENT_SERVICE_REGION: "iad",
      },
      serviceName: "docs-agent",
      agentId: "support",
      version: "0.1.0",
      runtime: "node",
    });

    assertEquals(input?.apiUrl, "https://api.example.com");
    assertEquals(input?.authToken, "token-1");
    assertEquals(input?.scopeKind, "project");
    assertEquals(input?.projectId, "11111111-1111-4111-a111-111111111111");
    assertEquals(input?.baseUrl, "https://agent.example.com");
    assertEquals(input?.invokeUrl, "https://agent.example.com/api/runs");
    assertEquals(input?.region, "iad");
    assertEquals(input?.version, "0.1.0");
    assertEquals(input?.runtime, "node");
    assertEquals(input?.serviceKey.startsWith("docs-agent:"), true);
  });

  it("skips auto registration when the token or public URL is missing", async () => {
    const withoutToken = await resolveAgentServiceRegistrationInput({
      config: {
        VERYFRONT_API_URL: "https://api.example.com",
        VERYFRONT_API_TOKEN: undefined,
        VERYFRONT_PROJECT_ID: undefined,
        VERYFRONT_AGENT_SERVICE_URL: "https://agent.example.com",
        VERYFRONT_AGENT_SERVICE_KEY: undefined,
        VERYFRONT_AGENT_SERVICE_REGISTRATION: "auto",
        VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: 30_000,
        VERYFRONT_AGENT_SERVICE_REGION: undefined,
      },
      serviceName: "docs-agent",
      agentId: "support",
      version: undefined,
      runtime: "node",
    });
    const withoutUrl = await resolveAgentServiceRegistrationInput({
      config: {
        VERYFRONT_API_URL: "https://api.example.com",
        VERYFRONT_API_TOKEN: "token-1",
        VERYFRONT_PROJECT_ID: undefined,
        VERYFRONT_AGENT_SERVICE_URL: undefined,
        VERYFRONT_AGENT_SERVICE_KEY: undefined,
        VERYFRONT_AGENT_SERVICE_REGISTRATION: "auto",
        VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: 30_000,
        VERYFRONT_AGENT_SERVICE_REGION: undefined,
      },
      serviceName: "docs-agent",
      agentId: "support",
      version: undefined,
      runtime: "node",
    });

    assertEquals(withoutToken, null);
    assertEquals(withoutUrl, null);
  });

  it("fails explicit registration when required connection settings are missing", async () => {
    await assertRejects(
      () =>
        resolveAgentServiceRegistrationInput({
          config: {
            VERYFRONT_API_URL: "https://api.example.com",
            VERYFRONT_API_TOKEN: undefined,
            VERYFRONT_PROJECT_ID: undefined,
            VERYFRONT_AGENT_SERVICE_URL: undefined,
            VERYFRONT_AGENT_SERVICE_KEY: undefined,
            VERYFRONT_AGENT_SERVICE_REGISTRATION: "enabled",
            VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: 30_000,
            VERYFRONT_AGENT_SERVICE_REGION: undefined,
          },
          serviceName: "docs-agent",
          agentId: "support",
          version: undefined,
          runtime: "node",
        }),
      Error,
      "VERYFRONT_API_TOKEN is required",
    );
  });

  it("registers the push service and heartbeats with bearer auth", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetch: typeof globalThis.fetch = (input, init) => {
      calls.push({ url: input.toString(), init });
      return Promise.resolve(jsonResponse(serviceResponse));
    };

    const lifecycle = await createAgentServiceRegistrationLifecycle({
      apiUrl: "https://api.example.com",
      authToken: "token-1",
      serviceName: "docs-agent",
      serviceKey: "docs-agent:test",
      scopeKind: "project",
      projectId: "11111111-1111-4111-a111-111111111111",
      agentId: "support",
      baseUrl: "https://agent.example.com",
      invokeUrl: "https://agent.example.com/api/runs",
      version: "0.1.0",
      runtime: "node",
      region: "iad",
      heartbeatIntervalMs: 60_000,
      fetch,
    });

    await lifecycle.heartbeat();
    lifecycle.stop();

    assertEquals(calls.length, 2);
    assertEquals(calls[0]?.url, "https://api.example.com/agent-runtimes/push-services");
    assertEquals(
      calls[1]?.url,
      "https://api.example.com/agent-runtimes/push-services/22222222-2222-4222-a222-222222222222/heartbeat",
    );
    assertEquals(new Headers(calls[0]?.init?.headers).get("Authorization"), "Bearer token-1");
    assertEquals(JSON.parse(String(calls[0]?.init?.body)), {
      service_name: "docs-agent",
      service_key: "docs-agent:test",
      scope_kind: "project",
      project_id: "11111111-1111-4111-a111-111111111111",
      agent_id: "support",
      base_url: "https://agent.example.com",
      invoke_url: "https://agent.example.com/api/runs",
      version: "0.1.0",
      runtime: "node",
      region: "iad",
    });
  });
});
