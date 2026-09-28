import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createIntegrationClient, IntegrationApiError } from "../../../src/integrations/client.ts";

const project = { id: "11111111-1111-4111-8111-111111111111", slug: "test-project" };
const connectionId = "22222222-2222-4222-8222-222222222222";
const generation = "33333333-3333-4333-8333-333333333333";
const context = {
  apiBaseUrl: "https://api.example.test",
  authToken: "synthetic-token",
  projectReference: project.id,
};

describe("published client generation preconditions", () => {
  for (
    const scenario of [
      "supported",
      "unsupported",
      "downgraded",
      "missing-connection",
      "malformed",
    ] as const
  ) {
    it(scenario, async () => {
      let calls = 0;
      await withMockFetch(async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path.startsWith("/projects/")) return Response.json(project);
        const isCall = path.endsWith("/call");
        const headers = new Headers({ "x-veryfront-project-id": project.id });
        if (scenario !== "unsupported" && !(scenario === "downgraded" && isCall)) {
          headers.set("x-veryfront-tool-preconditions", "project_id, connection_generation_id");
        }
        if (!isCall) return Response.json({ tools: [] }, { headers });
        calls++;
        assertEquals(JSON.parse(String(init?.body)), {
          connection_id: connectionId,
          expected_connection_generation_id: generation,
          arguments: { expected_connection_generation_id: "provider-native" },
        });
        return Response.json({ content: [], structuredContent: { ok: true } }, { headers });
      }, async () => {
        const client = await createIntegrationClient(context);
        const call = () =>
          client.call("github__get_current_user", {
            expected_connection_generation_id: "provider-native",
          }, {
            connectionId: scenario === "missing-connection" ? undefined : connectionId,
            expectedConnectionGenerationId: scenario === "malformed"
              ? "bad-generation"
              : generation,
          });
        if (scenario === "supported") {
          assertEquals((await call()).status, "success");
        } else if (scenario === "unsupported" || scenario === "downgraded") {
          const error = await assertRejects(call, IntegrationApiError);
          assertEquals(error.kind, "unsupported_precondition");
          assertEquals(error.outcomeUnknown, scenario === "downgraded");
          assertEquals(error.retryable, false);
        } else {
          await assertRejects(call, TypeError);
        }
        assertEquals(calls, scenario === "supported" || scenario === "downgraded" ? 1 : 0);
      });
    });
  }
});

describe("published client stale generation refusal", () => {
  for (const slug of ["integration-connection-stale", "validation-failed"] as const) {
    it(`types ${slug} without replaying the call`, async () => {
      let calls = 0;
      await withMockFetch(async (input) => {
        const path = new URL(String(input)).pathname;
        if (path.startsWith("/projects/")) return Response.json(project);
        const headers = new Headers({
          "x-veryfront-project-id": project.id,
          "x-veryfront-tool-preconditions": "project_id,connection_generation_id",
        });
        if (!path.endsWith("/call")) return Response.json({ tools: [] }, { headers });
        calls++;
        const status = slug === "integration-connection-stale" ? 409 : 400;
        return Response.json({ slug, status, title: "Refused" }, {
          status,
          headers: { "content-type": "application/problem+json" },
        });
      }, async () => {
        const client = await createIntegrationClient(context);
        const error = await assertRejects(
          () =>
            client.call("github__get_current_user", {}, {
              connectionId,
              expectedConnectionGenerationId: generation,
            }),
          IntegrationApiError,
        ) as IntegrationApiError;
        assertEquals(error.outcomeUnknown, false);
        assertEquals(
          error.condition,
          slug === "integration-connection-stale"
            ? { slug, status: 409, retryable: false }
            : undefined,
        );
        assertEquals(calls, 1);
      });
    });
  }
});
