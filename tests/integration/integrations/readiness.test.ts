import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createIntegrationClient, IntegrationApiError } from "../../../src/integrations/client.ts";
const project = { id: "11111111-1111-4111-8111-111111111111", slug: "test-project" };
const connectionId = "22222222-2222-4222-8222-222222222222";
const generation = "33333333-3333-4333-8333-333333333333";
function response() {
  return {
    version: 1,
    selection: {
      project_id: project.id,
      integration: "github",
      tool_name: "github__get_current_user",
      requested_connection_id: connectionId,
      state: "selected",
      mode: "oauth_connection",
      scope: "user",
      connection_id: connectionId,
      connection_generation_id: generation,
    },
    connection: { state: "connected" },
    account: { state: "unknown", id: null, display_name: null, evidence: "none" },
    credentials: { evidence: "connection_metadata", missing_keys: [] },
    local_eligibility: {
      state: "eligible",
      basis: "metadata_only",
      required_capability: "project.integrations.read",
      blockers: [],
      pending_checks: ["provider_authorization"],
    },
    provider_verification: { state: "not_checked" },
  };
}
describe("selected readiness client", () => {
  for (
    const scenario of [
      "valid",
      "absent",
      "wrong-project",
      "wrong-tool",
      "wrong-account",
      "wrong-generation",
      "stale",
      "provider-claim",
      "inconsistent-stale",
      "blocked-empty-blockers",
    ] as const
  ) {
    it(scenario, async () => {
      let reads = 0;
      await withMockFetch((url, init) => {
        const path = new URL(String(url));
        if (path.pathname.endsWith("/tools/list")) {
          return Response.json({ tools: [] }, {
            headers: { "x-veryfront-project-id": project.id },
          });
        }
        if (!path.pathname.includes("/integrations/")) return Response.json(project);
        reads++;
        assertEquals(init?.method, "GET");
        assertEquals(path.pathname, `/projects/${project.id}/integrations/github`);
        assertEquals(path.searchParams.get("tool_name"), "github__get_current_user");
        assertEquals(path.searchParams.get("expected_connection_generation_id"), generation);
        const data = response();
        if (scenario === "wrong-project") data.selection.project_id = connectionId;
        if (scenario === "wrong-tool") data.selection.tool_name = "github__write";
        if (scenario === "wrong-account") data.selection.connection_id = generation;
        if (scenario === "wrong-generation" || scenario === "stale") {
          data.selection.connection_generation_id = connectionId;
        }
        if (scenario === "stale") {
          data.selection.state = "stale";
          data.local_eligibility.state = "blocked";
          data.local_eligibility.blockers = ["connection_stale"];
        }
        if (scenario === "inconsistent-stale") data.selection.state = "stale";
        if (scenario === "blocked-empty-blockers") {
          data.local_eligibility.state = "blocked";
          data.local_eligibility.blockers = [];
        }
        if (scenario === "provider-claim") data.provider_verification.state = "verified";
        return Response.json(scenario === "absent" ? {} : { selected_readiness: data });
      }, async () => {
        const client = await createIntegrationClient({
          apiBaseUrl: "https://api.example.test",
          authToken: "synthetic-token",
          projectReference: project.id,
        });
        const read = () =>
          client.readiness("github__get_current_user", {
            connectionId,
            expectedConnectionGenerationId: generation,
          });
        if (scenario === "valid" || scenario === "stale") {
          const first = await read();
          assertEquals(first.selection.state, scenario === "stale" ? "stale" : "selected");
          assertEquals(first.provider_verification.state, "not_checked");
          await read();
          assertEquals(reads, 2);
        } else {
          const error = await assertRejects(read, IntegrationApiError);
          assertEquals(error.kind, "invalid_response");
          assertEquals(error.outcomeUnknown, false);
          assertEquals(reads, 1);
        }
      });
    });
  }
});

it("keeps out-of-order readiness reads isolated by project and credential", async () => {
  const second = { id: "44444444-4444-4444-8444-444444444444", slug: "second-project" };
  const secondConnection = "55555555-5555-4555-8555-555555555555";
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const seen: string[] = [];
  await withMockFetch(async (input, init) => {
    const url = new URL(String(input));
    const token = new Headers(init?.headers).get("authorization");
    const owner = token === "Bearer synthetic-first" ? project : second;
    if (url.pathname.endsWith("/tools/list")) {
      assertEquals(new Headers(init?.headers).get("x-veryfront-expected-project-id"), owner.id);
      return Response.json({ tools: [] }, { headers: { "x-veryfront-project-id": owner.id } });
    }
    if (!url.pathname.includes("/integrations/")) {
      assertEquals(url.pathname, `/projects/${owner.id}`);
      return Response.json(owner);
    }
    assertEquals(url.pathname, `/projects/${owner.id}/integrations/github`);
    if (owner === project) {
      started.resolve();
      await release.promise;
    }
    const result = response();
    result.selection.project_id = owner.id;
    result.selection.connection_id = owner === project ? connectionId : secondConnection;
    result.selection.requested_connection_id = result.selection.connection_id;
    seen.push(owner.id);
    return Response.json({ selected_readiness: result });
  }, async () => {
    const firstClient = await createIntegrationClient({
      apiBaseUrl: "https://api.example.test",
      authToken: "synthetic-first",
      projectReference: project.id,
    });
    const secondClient = await createIntegrationClient({
      apiBaseUrl: "https://api.example.test",
      authToken: "synthetic-second",
      projectReference: second.id,
    });
    const pendingFirst = firstClient.readiness("github__get_current_user", { connectionId });
    await started.promise;
    try {
      const secondResult = await secondClient.readiness("github__get_current_user", {
        connectionId: secondConnection,
      });
      assertEquals(secondResult.selection.project_id, second.id);
      assertEquals(secondResult.selection.connection_id, secondConnection);
    } finally {
      release.resolve();
    }
    const firstResult = await pendingFirst;
    assertEquals(firstResult.selection.project_id, project.id);
    assertEquals(firstResult.selection.connection_id, connectionId);
    assertEquals(seen, [second.id, project.id]);
  });
});
