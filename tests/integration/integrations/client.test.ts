import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createIntegrationClient, IntegrationApiError } from "../../../src/integrations/client.ts";
import type { IntegrationToolResult } from "../../../src/integrations/client-types.ts";

const project = { id: "11111111-1111-4111-8111-111111111111", slug: "test-project" };
const context = {
  apiBaseUrl: "https://api.example.test/v1",
  authToken: "synthetic-client-token",
  projectReference: project.slug,
};
const tool = {
  name: "github__get_current_user",
  description: "Read current user",
  inputSchema: { type: "object", properties: { account_id: { type: "string" } } },
};

function isToolRoute(path: string): boolean {
  return path === "/v1/integrations/tools/list" || path === "/v1/integrations/github/tools" ||
    path === "/v1/integrations/github/tools/get_current_user/call" ||
    path === "/v1/integrations/github/tools/create_issue/call";
}

function projectOr(input: RequestInfo | URL, result: unknown): Response {
  return Response.json(
    String(input).includes("/projects/test-project") && !String(input).includes("/connections")
      ? project
      : result,
  );
}

// Model the composed API's mandatory read-only tool-project binding probe.
// Individual fixtures below observe their operation's I/O separately.
async function withClientFetch<T>(
  mock: typeof fetch,
  run: () => Promise<T>,
  boundProjectId = project.id,
): Promise<T> {
  return await withMockFetch(async (input, init) => {
    const url = new URL(String(input));
    if (isToolRoute(url.pathname)) {
      assertEquals(init?.method, url.pathname === "/v1/integrations/github/tools" ? "GET" : "POST");
      assertEquals(
        new Headers(init?.headers).get("x-veryfront-expected-project-id"),
        boundProjectId,
      );
    }
    if (url.pathname.endsWith("/integrations/tools/list")) {
      return Response.json({ tools: [] }, {
        headers: { "x-veryfront-project-id": boundProjectId },
      });
    }
    const response = await mock(input, init);
    if (
      isToolRoute(url.pathname) && response.ok &&
      !response.headers.has("x-veryfront-project-id")
    ) {
      response.headers.set("x-veryfront-project-id", boundProjectId);
    }
    return response;
  }, run);
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}

describe("explicit integration client", () => {
  it("binds project and trusted credential once and preserves a native tool envelope with one execution", async () => {
    const native: IntegrationToolResult = {
      content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }, {
        type: "audio",
        data: "aGVsbG8=",
        mimeType: "audio/wav",
      }, { type: "resource", resource: { uri: "fixture://resource", text: "native" } }],
      structuredContent: { nested_value: [1, { native_key: true }] },
      _meta: { provider_trace: "synthetic-trace" },
    };
    let executions = 0;
    await withClientFetch(async (url, init) => {
      assertEquals(new URL(String(url)).origin, "https://api.example.test");
      assertEquals(
        new Headers(init?.headers).get("authorization"),
        "Bearer synthetic-client-token",
      );
      if (String(url).includes("/tools/")) {
        executions++;
        assertEquals(new Headers(init?.headers).get("x-veryfront-project-slug"), project.slug);
        assertEquals(JSON.parse(String(init?.body)), {
          arguments: {
            account_id: "provider-account",
            connection_id: "provider-native-id",
            run_id: "provider-run",
            agent_id: "provider-agent",
          },
          connection_id: "22222222-2222-4222-8222-222222222222",
        });
      }
      return projectOr(url, native);
    }, async () => {
      const client = await createIntegrationClient(context);
      assertEquals(client.project, project);
      assertEquals(JSON.stringify(client).includes(context.authToken), false);
      const outcome = await client.call(tool.name, {
        account_id: "provider-account",
        connection_id: "provider-native-id",
        run_id: "provider-run",
        agent_id: "provider-agent",
      }, { connectionId: "22222222-2222-4222-8222-222222222222" });
      assertEquals(outcome, { status: "success", result: native });
    });
    assertEquals(executions, 1);
  });

  it("retains typed rate limit metadata and native retryAfter without replay", async () => {
    let calls = 0;
    const condition = {
      slug: "rate-limit-exceeded",
      status: 429,
      retryable: true,
      retry_after_seconds: 17,
    };
    const native = {
      content: [],
      isError: true,
      structuredContent: { error: "rate_limited", retryAfter: 17 },
      _meta: { condition },
    };
    await withClientFetch(async (url) => {
      if (String(url).includes("/tools/")) calls++;
      return projectOr(url, native);
    }, async () => {
      const client = await createIntegrationClient(context);
      assertEquals(await client.call("github__create_issue", { title: "Synthetic issue" }), {
        status: "tool_error",
        result: native,
        condition,
      });
    });
    assertEquals(calls, 1);
  });

  it("follows complete opaque tool cursors without changing project/filter/order", async () => {
    const seen: string[] = [];
    await withClientFetch(async (input) => {
      const url = new URL(String(input));
      if (!isToolRoute(url.pathname)) return Response.json(project);
      assertEquals(url.searchParams.get("name"), "get_");
      assertEquals(url.searchParams.get("order"), "asc");
      seen.push(url.searchParams.get("cursor") ?? "first");
      return Response.json({
        tools: [{ ...tool, name: `github__get_${seen.length}` }],
        total: 3,
        page_info: { next: seen.length < 3 ? `opaque/${seen.length}?x=y` : null },
      });
    }, async () => {
      const client = await createIntegrationClient(context);
      assertEquals(
        (await collect(client.listTools("github", { name: "get_" }))).map((item) => item.name),
        ["github__get_1", "github__get_2", "github__get_3"],
      );
    });
    assertEquals(seen, ["first", "opaque/1?x=y", "opaque/2?x=y"]);
  });

  it("rejects cursor loops instead of returning an apparently complete partial catalog", async () => {
    await withClientFetch(
      async (url) =>
        projectOr(url, {
          data: [{
            name: "github",
            display_name: "GitHub",
            description: "Fixture",
            auth_type: "oauth2",
          }],
          page_info: { next: "same-cursor" },
          total: 10,
        }),
      async () => {
        const client = await createIntegrationClient(context);
        await assertRejects(() => collect(client.discover()), Error, "cursor");
      },
    );
  });

  it("does not infer readiness or TTL from raw connected status", async () => {
    const status = {
      connected: true,
      integration: "github",
      connection_id: project.id,
      connection_generation_id: "22222222-2222-4222-8222-222222222222",
    };
    await withClientFetch(async (url) => {
      if (String(url).includes("/oauth/status/")) {
        assertEquals(new URL(String(url)).searchParams.get("scope"), "user");
      }
      return projectOr(url, status);
    }, async () => {
      const client = await createIntegrationClient(context);
      assertEquals(await client.status("github", "user"), status);
    });
  });

  it("rejects a mismatched project before any call and never sends credentials to an untrusted origin", async () => {
    let requests = 0;
    await withClientFetch(async () => {
      requests++;
      return Response.json({ id: project.id, slug: "foreign-project" });
    }, async () => {
      await assertRejects(() => createIntegrationClient(context), Error, "project");
      await assertRejects(
        () => createIntegrationClient({ ...context, apiBaseUrl: "http://api.example.test" }),
        TypeError,
        "HTTPS",
      );
      await assertRejects(
        () => createIntegrationClient({ ...context, authToken: "" }),
        TypeError,
        "credential",
      );
    });
    assertEquals(requests, 1);
  });

  it("cancels a bound client without starting another request", async () => {
    const controller = new AbortController();
    const reason = new Error("fixture cancellation");
    let requests = 0;
    await withClientFetch(async () => {
      requests++;
      return Response.json(project);
    }, async () => {
      const client = await createIntegrationClient({ ...context, abortSignal: controller.signal });
      controller.abort(reason);
      try {
        await client.call(tool.name, {});
        throw new Error("expected cancellation");
      } catch (error) {
        assertStrictEquals(error, reason);
      }
    });
    assertEquals(requests, 1);
  });

  it("reports uncertain execution without replay when dispatch fails", async () => {
    let calls = 0;
    await withClientFetch(async (url) => {
      if (String(url).includes("/tools/")) {
        calls++;
        throw new Error("synthetic network failure");
      }
      return Response.json(project);
    }, async () => {
      const client = await createIntegrationClient(context);
      const error = await assertRejects(
        () => client.call("github__create_issue", {}),
        IntegrationApiError,
      );
      assertInstanceOf(error, IntegrationApiError);
      assertEquals(error.outcomeUnknown, true);
      assertEquals(error.retryable, false);
    });
    assertEquals(calls, 1);
  });
  it("traverses catalog and connection pages without the legacy 1000-tool cap", async () => {
    let catalogPage = 0;
    let connectionPage = 0;
    await withClientFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/integrations")) {
        const page = catalogPage++;
        return Response.json({
          data: Array.from(
            { length: 100 },
            (_, offset) => ({
              name: `integration-${String(page * 100 + offset).padStart(4, "0")}`,
              display_name: "Fixture",
              description: "Fixture",
              auth_type: "oauth2",
            }),
          ),
          page_info: { next: catalogPage < 12 ? `page-${catalogPage}` : null },
          total: 1200,
        });
      }
      if (url.pathname.endsWith("/connections")) {
        connectionPage++;
        return Response.json({
          data: [{
            id: project.id,
            connection_generation_id: project.id,
            integration: "github",
            scope: "user",
            status: "connected",
            display_name: null,
          }],
          page_info: { next: connectionPage === 1 ? "connections-next" : null },
          total: 2,
        });
      }
      return Response.json(project);
    }, async () => {
      const client = await createIntegrationClient(context);
      assertEquals((await collect(client.discover())).length, 1200);
      assertEquals((await collect(client.listConnections("github"))).length, 2);
    });
    assertEquals(catalogPage, 12);
    assertEquals(connectionPage, 2);
  });

  it("preserves credential requirements without inferring an OAuth setup flow", async () => {
    const details = {
      name: "github",
      auth: { type: "oauth2" },
      credential_requirement: {
        mode: "project_credentials",
        mandatory_env_vars: ["SYNTHETIC_CLIENT_ID"],
      },
      setup_guide: { notes: ["Configure project credentials"] },
    };
    await withClientFetch(async (url) => projectOr(url, details), async () => {
      const client = await createIntegrationClient(context);
      assertEquals(await client.getIntegration("github"), details);
    });
  });

  for (
    const failure of [
      { status: 400, slug: "validation-failed", title: "Validation failed" },
      { status: 401, slug: "authentication-required", title: "Authentication required" },
      { status: 403, slug: "authorization-denied", title: "Authorization denied" },
    ]
  ) {
    it(`classifies a real-shaped HTTP ${failure.status} Problem without inventing retryability`, async () => {
      const problem = {
        type: `https://errors.example.test/${failure.slug}`,
        title: failure.title,
        status: failure.status,
        slug: failure.slug,
        detail: "synthetic-private-detail",
        instance: "synthetic-private-instance",
        errors: [{ field: "scope", message: "synthetic-private-error" }],
      };
      let executions = 0;
      await withClientFetch(async (url) => {
        if (String(url).includes("/tools/")) {
          executions++;
          return Response.json(problem, { status: failure.status });
        }
        return Response.json(project);
      }, async () => {
        const client = await createIntegrationClient(context);
        const error = await assertRejects(() => client.call(tool.name, {}), IntegrationApiError);
        assertInstanceOf(error, IntegrationApiError);
        assertInstanceOf(error, VeryfrontError);
        assertEquals(error.slug, failure.slug);
        assertEquals(error.status, failure.status);
        assertEquals(error.httpStatus, failure.status);
        assertEquals(error.toRFC9457().status, failure.status);
        assertEquals(error.outcomeUnknown, false);
        assertEquals(error.httpProblem, { slug: failure.slug, status: failure.status });
        assertEquals(error.condition, undefined);
        assertEquals(Object.hasOwn(error.httpProblem ?? {}, "retryable"), false);
        assertEquals(error.problem, problem);
        for (
          const privateValue of [
            problem.detail,
            problem.instance,
            ...problem.errors.map((error) => error.message),
          ]
        ) {
          assertEquals(JSON.stringify(error).includes(privateValue), false);
          assertEquals(error.message.includes(privateValue), false);
          assertEquals(error.stack?.includes(privateValue), false);
          assertEquals(JSON.stringify(error.toRFC9457()).includes(privateValue), false);
          assertEquals(JSON.stringify(error.context).includes(privateValue), false);
        }
      });
      assertEquals(executions, 1);
    });
  }

  for (
    const failure of [
      { status: 409, slug: "integration-execution-outcome-unknown", unknown: true },
      { status: 408, slug: "request-timeout", unknown: true },
      { status: 409, slug: "conflict", unknown: false },
    ]
  ) {
    it(`reports HTTP ${failure.status}/${failure.slug} execution uncertainty precisely without replay`, async () => {
      const problem = {
        type: "about:blank",
        title: "Request failed",
        status: failure.status,
        slug: failure.slug,
      };
      let executions = 0;
      await withClientFetch(async (url) => {
        if (String(url).includes("/tools/")) {
          executions++;
          return Response.json(problem, { status: failure.status });
        }
        return Response.json(project);
      }, async () => {
        const client = await createIntegrationClient(context);
        const error = await assertRejects(
          () => client.call("github__create_issue", {}),
          IntegrationApiError,
        );
        assertInstanceOf(error, IntegrationApiError);
        assertEquals(error.httpProblem, { slug: failure.slug, status: failure.status });
        assertEquals(error.outcomeUnknown, failure.unknown);
        assertEquals(error.retryable, false);
      });
      assertEquals(executions, 1);
    });
  }

  it("rejects conflicting status aliases instead of confirming an ambiguous generation", async () => {
    const status = {
      connected: true,
      integration: "github",
      connection_id: project.id,
      connectionId: "22222222-2222-4222-8222-222222222222",
    };
    await withClientFetch(async (url) => projectOr(url, status), async () => {
      const client = await createIntegrationClient(context);
      await assertRejects(() => client.status("github", "user"), IntegrationApiError);
    });
  });

  it("aborts a streamed call response and reports uncertainty without a second dispatch", async () => {
    const controller = new AbortController();
    let calls = 0;
    let cancelled = 0;
    await withClientFetch(async (url) => {
      if (!String(url).includes("/tools/")) return Response.json(project);
      calls++;
      return new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('{"content":'));
            setTimeout(() => controller.abort(), 1);
          },
          cancel() {
            cancelled++;
          },
        }),
      );
    }, async () => {
      const client = await createIntegrationClient(context);
      const error = await assertRejects(
        () => client.call(tool.name, {}, { abortSignal: controller.signal }),
        IntegrationApiError,
      );
      assertInstanceOf(error, IntegrationApiError);
      assertEquals(error.kind, "transport");
      assertInstanceOf(error, IntegrationApiError);
      assertEquals(error.outcomeUnknown, true);
    });
    assertEquals(calls, 1);
    assertEquals(cancelled, 1);
  });
  it("resolves canonical UUID identity without treating hexadecimal casing as another project", async () => {
    const canonical = { id: "abcdefab-1111-4111-8111-111111111111", slug: project.slug };
    await withClientFetch(async () => Response.json(canonical), async () => {
      const client = await createIntegrationClient({
        ...context,
        projectReference: canonical.id.toUpperCase(),
      });
      assertEquals(client.project, canonical);
    }, canonical.id);
  });

  it("rejects credential accessors and authored argument accessors without invoking them", async () => {
    let accessorCalls = 0;
    let requests = 0;
    await withClientFetch(async () => {
      requests++;
      return Response.json(project);
    }, async () => {
      await assertRejects(
        () =>
          createIntegrationClient({
            ...context,
            get authToken() {
              accessorCalls++;
              return context.authToken;
            },
          }),
        TypeError,
        "data properties",
      );
      const client = await createIntegrationClient(context);
      await assertRejects(
        () =>
          client.call(tool.name, {
            get secret() {
              accessorCalls++;
              return "synthetic-private";
            },
          }),
        TypeError,
        "bounded JSON",
      );
    });
    assertEquals(accessorCalls, 0);
    assertEquals(requests, 1);
  });
  for (
    const failure of [
      {
        error: "provider_permission_denied",
        slug: "integration-provider-permission-denied",
        status: 403,
      },
      {
        error: "execution_outcome_unknown",
        slug: "integration-execution-outcome-unknown",
        status: 409,
      },
    ]
  ) {
    it(`preserves ${failure.error} and never replays the selected call`, async () => {
      let executions = 0;
      const condition = { slug: failure.slug, status: failure.status, retryable: false };
      const native = {
        content: [{ type: "text", text: "Synthetic failure" }],
        isError: true,
        structuredContent: { error: failure.error, retryable: false },
        _meta: { condition },
      };
      await withClientFetch(async (url) => {
        if (String(url).includes("/tools/")) executions++;
        return projectOr(url, native);
      }, async () => {
        const client = await createIntegrationClient(context);
        assertEquals(await client.call("github__create_issue", {}), {
          status: "tool_error",
          result: native,
          condition,
        });
      });
      assertEquals(executions, 1);
    });
  }

  it("rejects malformed native envelopes without replaying execution", async () => {
    let executions = 0;
    await withClientFetch(async (url) => {
      if (String(url).includes("/tools/")) executions++;
      return projectOr(url, { content: [], structuredContent: [] });
    }, async () => {
      const client = await createIntegrationClient(context);
      const error = await assertRejects(() => client.call(tool.name, {}), IntegrationApiError);
      assertInstanceOf(error, IntegrationApiError);
      assertEquals(error.kind, "invalid_response");
      assertEquals(error.outcomeUnknown, true);
    });
    assertEquals(executions, 1);
  });
  it("does not follow a redirected call or forward credentials beyond the bound API", async () => {
    const dispatched: string[] = [];
    await withClientFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/projects/")) return Response.json(project);
      dispatched.push(url.origin);
      return url.origin === "https://api.example.test"
        ? Response.redirect("https://foreign.example.test/call", 307)
        : Response.json({ content: [] });
    }, async () => {
      const client = await createIntegrationClient(context);
      await assertRejects(() => client.call("github__create_issue", {}), IntegrationApiError);
    });
    assertEquals(dispatched, ["https://api.example.test"]);
  });
  for (const effectiveProjectId of [undefined, "22222222-2222-4222-8222-222222222222"]) {
    it(`refuses an unconfirmed tool binding before execution: ${effectiveProjectId ?? "missing header"}`, async () => {
      let executions = 0;
      await withMockFetch(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/call")) {
          executions++;
          return Response.json({ content: [] });
        }
        if (url.pathname.endsWith("/integrations/tools/list")) {
          return Response.json({ tools: [] }, {
            headers: effectiveProjectId ? { "x-veryfront-project-id": effectiveProjectId } : {},
          });
        }
        // Accessible project detail is NOT evidence of the tool token's binding.
        return Response.json(project);
      }, async () => {
        const error = await assertRejects(async () => {
          const client = await createIntegrationClient(context);
          await client.call("github__create_issue", {});
        }, IntegrationApiError);
        assertInstanceOf(error, IntegrationApiError);
        assertEquals(error.kind, "project_binding");
      });
      assertEquals(executions, 0);
    });
  }
  it("sends the canonical project precondition on preflight, tool pagination, and execution", async () => {
    const expectedIds: Array<string | null> = [];
    await withMockFetch(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/projects/")) return Response.json(project);
      expectedIds.push(new Headers(init?.headers).get("x-veryfront-expected-project-id"));
      return Response.json(
        url.pathname.endsWith("/call")
          ? { content: [] }
          : { tools: [tool], page_info: { next: null } },
        { headers: { "x-veryfront-project-id": project.id } },
      );
    }, async () => {
      const client = await createIntegrationClient(context);
      await collect(client.listTools("github"));
      await client.call(tool.name, {});
    });
    assertEquals(expectedIds, [project.id, project.id, project.id]);
  });
  it("keeps the expected UUID when a legacy slug is reused and does not replay the server refusal", async () => {
    let routedProject = project.id;
    let executions = 0;
    let callRequests = 0;
    await withMockFetch(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/projects/")) return Response.json(project);
      const expected = new Headers(init?.headers).get("x-veryfront-expected-project-id");
      if (url.pathname.endsWith("/call")) callRequests++;
      if (expected !== routedProject) {
        return Response.json({ slug: "validation-failed", status: 400, retryable: false }, {
          status: 400,
        });
      }
      if (url.pathname.endsWith("/call")) executions++;
      return Response.json(url.pathname.endsWith("/call") ? { content: [] } : { tools: [] }, {
        headers: { "x-veryfront-project-id": routedProject },
      });
    }, async () => {
      const client = await createIntegrationClient(context);
      routedProject = "22222222-2222-4222-8222-222222222222";
      const error = await assertRejects(
        () => client.call("github__create_issue", {}),
        IntegrationApiError,
      );
      assertInstanceOf(error, IntegrationApiError);
      assertEquals(error.status, 400);
      assertEquals(error.outcomeUnknown, false);
    });
    assertEquals(callRequests, 1);
    assertEquals(executions, 0);
  });
  it("creates a personal OAuth handoff with the exact API expiry and no enumerable consent URL", async () => {
    const expires = "2099-01-01T00:00:00.000Z";
    const token = "a".repeat(64);
    const connectUrl = `https://api.example.test/v1/oauth/connect/github?session_token=${token}`;
    let sessions = 0;
    await withClientFetch(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/integrations/github")) {
        return Response.json({
          name: "github",
          auth: { type: "oauth2", provider: "github" },
          credential_requirement: { mode: "oauth_connection" },
        });
      }
      if (path.endsWith("/oauth/connect/session")) {
        sessions++;
        assertEquals(JSON.parse(String(init?.body)), {
          integration: "github",
          project_reference: project.id,
          scope: "user",
          redirect_uri: "http://localhost:9876/callback?state=synthetic",
        });
        return Response.json({
          session_token: token,
          connect_url: connectUrl,
          expires_at: expires,
        });
      }
      return Response.json(project);
    }, async () => {
      const client = await createIntegrationClient(context);
      const result = await client.connect("github", {
        redirectUri: "http://localhost:9876/callback?state=synthetic",
      });
      assertEquals(result.status, "oauth_handoff");
      if (result.status !== "oauth_handoff") throw new Error("Expected handoff");
      assertEquals(result.connect_url, connectUrl);
      assertEquals(result.expires_at, expires);
      assertEquals(JSON.stringify(result).includes(token), false);
      assertEquals(JSON.stringify(result).includes(connectUrl), false);
    });
    assertEquals(sessions, 1);
  });

  it("returns catalog setup requirements without creating OAuth state or invoking a redirect factory", async () => {
    const details = {
      name: "activecampaign",
      auth: { type: "api-key" },
      credential_requirement: {
        mode: "project_credentials",
        mandatory_env_vars: ["ACTIVECAMPAIGN_API_KEY"],
      },
      env_vars: [{ name: "ACTIVECAMPAIGN_API_KEY", required: true }],
      setup_guide: { title: "Configure credentials" },
    };
    let redirectCalls = 0;
    await withClientFetch(async (input) => {
      if (String(input).endsWith("/integrations/activecampaign")) return Response.json(details);
      if (String(input).includes("/oauth/")) throw new Error("OAuth must not start");
      return Response.json(project);
    }, async () => {
      const client = await createIntegrationClient(context);
      const result = await client.connect("activecampaign", {
        redirectUri: () => {
          redirectCalls++;
          return "http://localhost:9876/callback";
        },
      });
      assertEquals(result, { status: "setup_required", integration: "activecampaign", details });
    });
    assertEquals(redirectCalls, 0);
  });

  it("rejects a handoff for a foreign origin, wrong integration, token mismatch, or missing expiry", async () => {
    const token = "a".repeat(64);
    for (
      const payload of [
        {
          session_token: token,
          connect_url: `https://foreign.example.test/oauth/connect/github?session_token=${token}`,
          expires_at: "2099-01-01T00:00:00.000Z",
        },
        {
          session_token: token,
          connect_url: `https://api.example.test/v1/oauth/connect/slack?session_token=${token}`,
          expires_at: "2099-01-01T00:00:00.000Z",
        },
        {
          session_token: token,
          connect_url: "https://api.example.test/v1/oauth/connect/github?session_token=wrong",
          expires_at: "2099-01-01T00:00:00.000Z",
        },
        {
          session_token: token,
          connect_url: `https://api.example.test/v1/oauth/connect/github?session_token=${token}`,
        },
      ]
    ) {
      await withClientFetch(async (input) => {
        if (String(input).endsWith("/integrations/github")) {
          return Response.json({
            name: "github",
            auth: { type: "oauth2", provider: "github" },
            credential_requirement: { mode: "oauth_connection" },
          });
        }
        return String(input).includes("/oauth/connect/session")
          ? Response.json(payload)
          : Response.json(project);
      }, async () => {
        const client = await createIntegrationClient(context);
        await assertRejects(
          () =>
            client.connect("github", {
              scope: "project",
              redirectUri: "http://127.0.0.1:9876/callback",
            }),
          IntegrationApiError,
        );
      });
    }
  });
});

describe("audited REST wire contract", () => {
  it("uses exact endpoint methods, queries, bodies, and project headers for every primitive", async () => {
    const connectionId = "22222222-2222-4222-8222-222222222222";
    const generationId = "33333333-3333-4333-8333-333333333333";
    const token = "a".repeat(64);
    const details = {
      name: "github",
      auth: { type: "oauth2" },
      credential_requirement: { mode: "oauth_connection" },
    };
    const catalog = {
      name: "github",
      display_name: "GitHub",
      description: "Fixture",
      auth_type: "oauth2",
    };
    const row = {
      id: connectionId,
      integration: "github",
      connection_generation_id: generationId,
      scope: "user",
      status: "connected",
    };
    const fixtures: Array<
      {
        method: string;
        path: string;
        query?: Record<string, string>;
        body?: unknown;
        tool?: boolean;
        response: unknown;
      }
    > = [
      { method: "GET", path: `/projects/${project.slug}`, response: project },
      {
        method: "POST",
        path: "/integrations/tools/list",
        query: { limit: "1" },
        tool: true,
        response: { tools: [] },
      },
      {
        method: "GET",
        path: "/integrations",
        query: { sort_by: "name", sort_order: "desc", search: "git", limit: "100" },
        response: { data: [catalog], page_info: { next: "catalog/next" } },
      },
      {
        method: "GET",
        path: "/integrations",
        query: {
          sort_by: "name",
          sort_order: "desc",
          search: "git",
          limit: "100",
          cursor: "catalog/next",
        },
        response: { data: [catalog], page_info: { next: null } },
      },
      { method: "GET", path: "/integrations/github", response: details },
      {
        method: "GET",
        path: "/integrations/github/tools",
        query: { name: "get_", order: "desc", limit: "100" },
        tool: true,
        response: { tools: [tool], page_info: { next: "tools/next" } },
      },
      {
        method: "GET",
        path: "/integrations/github/tools",
        query: { name: "get_", order: "desc", limit: "100", cursor: "tools/next" },
        tool: true,
        response: { tools: [tool], page_info: { next: null } },
      },
      {
        method: "GET",
        path: `/projects/${project.id}/integrations/github/connections`,
        query: { sort_by: "created_at", sort_order: "asc", limit: "100" },
        response: { data: [row], page_info: { next: "connections/next" } },
      },
      {
        method: "GET",
        path: `/projects/${project.id}/integrations/github/connections`,
        query: {
          sort_by: "created_at",
          sort_order: "asc",
          limit: "100",
          cursor: "connections/next",
        },
        response: { data: [row], page_info: { next: null } },
      },
      {
        method: "GET",
        path: "/oauth/status/github",
        query: { project_reference: project.id, scope: "user" },
        response: {
          integration: "github",
          connected: true,
          connection_id: connectionId,
          connection_generation_id: generationId,
        },
      },
      {
        method: "POST",
        path: "/integrations/github/tools/get_current_user/call",
        body: {
          arguments: { run_id: "native", connection_id: "provider-native" },
          connection_id: connectionId,
        },
        tool: true,
        response: { content: [] },
      },
      { method: "GET", path: "/integrations/github", response: details },
      {
        method: "POST",
        path: "/oauth/connect/session",
        body: {
          integration: "github",
          project_reference: project.id,
          scope: "user",
          redirect_uri: "http://localhost:9876/callback",
        },
        response: {
          session_token: token,
          connect_url: `${context.apiBaseUrl}/oauth/connect/github?session_token=${token}`,
          expires_at: "2099-01-01T00:00:00.000Z",
        },
      },
    ];
    let index = 0;
    await withMockFetch(async (input, init) => {
      const fixture = fixtures[index++];
      if (!fixture) throw new Error("Unexpected extra request");
      const url = new URL(String(input));
      assertEquals(url.origin, "https://api.example.test");
      assertEquals(url.pathname, `/v1${fixture.path}`);
      assertEquals(init?.method, fixture.method);
      assertEquals(Object.fromEntries(url.searchParams), fixture.query ?? {});
      assertEquals(
        init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        fixture.body,
      );
      const headers = new Headers(init?.headers);
      assertEquals(headers.get("authorization"), `Bearer ${context.authToken}`);
      if (fixture.tool) {
        assertEquals(headers.get("x-veryfront-project-slug"), project.slug);
        assertEquals(headers.get("x-veryfront-expected-project-id"), project.id);
      }
      return Response.json(fixture.response, {
        headers: fixture.tool ? { "x-veryfront-project-id": project.id } : {},
      });
    }, async () => {
      const client = await createIntegrationClient(context);
      assertEquals(
        (await collect(client.discover({ search: "git", sortOrder: "desc" }))).length,
        2,
      );
      assertEquals(await client.getIntegration("github"), details);
      assertEquals(
        (await collect(client.listTools("github", { name: "get_", order: "desc" }))).length,
        2,
      );
      assertEquals((await collect(client.listConnections("github"))).length, 2);
      assertEquals((await client.status("github", "user")).connected, true);
      await client.call(tool.name, { run_id: "native", connection_id: "provider-native" }, {
        connectionId,
      });
      assertEquals(
        (await client.connect("github", { redirectUri: "http://localhost:9876/callback" })).status,
        "oauth_handoff",
      );
    });
    assertEquals(index, fixtures.length);
  });
});

describe("native response resource budgets", () => {
  for (const type of ["image", "audio"]) {
    it(`preserves a 1.4MiB native ${type} without generic argument string limits`, async () => {
      const data = "a".repeat(1400000);
      await withClientFetch(
        async (input) =>
          projectOr(input, {
            content: [{ type, data, mimeType: `${type}/fixture` }],
            structuredContent: { native: true },
          }),
        async () => {
          const client = await createIntegrationClient(context);
          const outcome = await client.call(tool.name, {});
          assertEquals(outcome.result.content[0]?.data, data);
          assertEquals(outcome.result.structuredContent, { native: true });
        },
      );
    });
  }
  it("fully preserves discovery above4MiB below16MiB without reserializing native fields", async () => {
    const rows = Array.from(
      { length: 6 },
      (_, index) => ({ ...tool, name: `github__read_${index}`, description: "a".repeat(900000) }),
    );
    await withClientFetch(
      async (input) => projectOr(input, { tools: rows, page_info: { next: null } }),
      async () => {
        const client = await createIntegrationClient(context);
        assertEquals(await collect(client.listTools("github")), rows);
      },
    );
  });
  for (const operation of ["call", "list"] as const) {
    it(`rejects ${operation} responses over their transport limit`, async () => {
      const data = "a".repeat((operation === "call" ? 4 : 16) * 1024 * 1024);
      await withClientFetch(
        async (input) =>
          projectOr(
            input,
            operation === "call"
              ? { content: [{ type: "image", data }] }
              : { tools: [{ ...tool, description: data }] },
          ),
        async () => {
          const client = await createIntegrationClient(context);
          await assertRejects(
            () =>
              operation === "call"
                ? client.call(tool.name, {})
                : collect(client.listTools("github")),
            IntegrationApiError,
          );
        },
      );
    });
  }
});
