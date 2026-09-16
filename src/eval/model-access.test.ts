import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  buildProviderError,
  markVeryfrontGatewayResponse,
  requestJson,
} from "#veryfront/provider/runtime-loader/provider-http.ts";
import { getVeryfrontCloudBootstrap } from "#veryfront/platform/cloud/resolver.ts";
import {
  createOutboundFetchBoundary,
  OutboundRequestBlockedError,
} from "#veryfront/security/http/outbound-fetch.ts";
import { markVeryfrontGatewayTransportFailure } from "#veryfront/provider/runtime-loader/provider-http.ts";
import { WorkerEgressBlockedError } from "#veryfront/security/sandbox/worker-egress-guard.ts";
import {
  classifyAgentServiceModelAccessDenial,
  classifyEvalModelAccessDenial,
  createEvalModelAccessDeniedError,
  explainConfiguredProjectDenial,
  getEvalModelAccessDenialKind,
  isEvalModelAccessDeniedError,
} from "./model-access.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function gatewayCreditDenial(): Promise<Error> {
  const error = await buildProviderError(
    "anthropic",
    jsonResponse(402, {
      slug: "insufficient-credits",
      error: "AI credit limit exceeded",
      suggestion: "Purchase additional credits or upgrade your subscription plan.",
      balance: 0,
      required: 0.25,
    }),
  );
  // The provider runtime prefixes the label onto the same error object.
  error.message = `veryfront-cloud request failed: ${error.message}`;
  return error;
}

function veryfrontApiOrigin(): string {
  return new URL(getVeryfrontCloudBootstrap().apiBaseUrl).origin;
}

async function rejectedRequest(
  origin: string,
  status: number,
  options: { path?: string; body?: unknown } = {},
): Promise<unknown> {
  try {
    await requestJson({
      url: `${origin}${options.path ?? "/ai/gateway/anthropic/v1/messages"}`,
      fetchImpl: () => Promise.resolve(jsonResponse(status, options.body ?? { error: "Rejected" })),
      init: { method: "POST", body: "{}" },
      providerLabel: "veryfront-cloud",
      providerKind: "anthropic",
    });
  } catch (error) {
    return error;
  }
  throw new Error("expected the request to reject");
}

/** A guarded fetch whose DNS answers every host with `addresses`. */
function blockingGuardedFetch(baseUrl: string, addresses: string[]): typeof fetch {
  return createOutboundFetchBoundary({
    fetch: () => Promise.resolve(Response.json({ ok: true })),
    pinnedFetch: () => Promise.resolve(Response.json({ ok: true })),
    resolveHost: () => Promise.resolve(addresses),
  }).createOriginBoundFetch(baseUrl);
}

async function captureRejection(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("expected the request to be blocked");
}

/** A model request whose provider transport the egress guard blocks. */
function blockedModelRequest(url: string, addresses: string[]): Promise<unknown> {
  return captureRejection(() =>
    requestJson({
      url,
      fetchImpl: blockingGuardedFetch(new URL(url).origin, addresses),
      init: { method: "POST", body: "{}" },
      providerLabel: "veryfront-cloud",
      providerKind: "openai",
    })
  );
}

describe("eval/model-access", () => {
  it("classifies a gateway insufficient-credits 402 with its balance", async () => {
    const denial = classifyEvalModelAccessDenial(await gatewayCreditDenial());

    assertEquals(denial?.code, "INSUFFICIENT_CREDITS");
    assertEquals(
      denial?.message,
      "AI credit limit exceeded: 0.25 credits required, 0 available. Purchase additional credits or upgrade your subscription plan.",
    );
  });

  it("classifies the platform provider spend limit separately", async () => {
    const error = await buildProviderError(
      "openai",
      jsonResponse(402, {
        slug: "insufficient-credits",
        error: "AI provider spend limit exceeded for the daily window.",
        suggestion: "Try again later or ask an administrator to raise the AI provider spend limit.",
        balance: 0,
        required: 0.01,
      }),
    );

    const denial = classifyEvalModelAccessDenial(error);
    assertEquals(denial?.code, "AI_PROVIDER_SPEND_LIMIT_EXCEEDED");
    assertEquals(denial?.kind, "spend-limit");
    const evalError = createEvalModelAccessDeniedError("eval:triage", denial!, error);
    assertEquals(evalError.slug, "eval-model-spend-limit-exceeded");
    assertEquals(
      evalError.suggestion,
      "Try again after the spend limit window resets, or ask a Veryfront administrator to raise the AI provider spend limit",
    );
    assertEquals(isEvalModelAccessDeniedError(evalError), true);
  });

  it("does not classify billing codes carried only by an AG-UI run error", () => {
    // The stream can derive INSUFFICIENT_CREDITS from a direct or BYOK provider
    // failure, so the code alone is not Veryfront gateway provenance.
    for (const code of ["INSUFFICIENT_CREDITS", "AI_PROVIDER_SPEND_LIMIT_EXCEEDED"]) {
      assertEquals(
        classifyAgentServiceModelAccessDenial({
          status: 402,
          body: null,
          runErrorCode: code,
          runErrorMessage: "Insufficient AI credits",
        }),
        undefined,
      );
    }
  });

  it("does not classify curated billing failures that crossed a runtime boundary", () => {
    const curated = Object.assign(new Error("Insufficient AI credits"), {
      slug: "insufficient-credits",
    });
    assertEquals(classifyEvalModelAccessDenial(curated), undefined);
  });

  it("classifies an agent service project-required 400 with a fixed message", () => {
    const denial = classifyAgentServiceModelAccessDenial({
      status: 400,
      body: JSON.stringify({ error: "untrusted endpoint text", code: "gateway_project_required" }),
    });

    assertEquals(denial, {
      kind: "project-required",
      code: "gateway_project_required",
      message: "A project is required to use Veryfront-managed AI inference",
    });
  });

  it("classifies the project-required RUN_ERROR code from streaming agent services", () => {
    assertEquals(
      classifyAgentServiceModelAccessDenial({
        status: 200,
        body: null,
        runErrorCode: "GATEWAY_PROJECT_REQUIRED",
        runErrorMessage: "untrusted endpoint text",
      }),
      {
        kind: "project-required",
        code: "gateway_project_required",
        message: "A project is required to use Veryfront-managed AI inference",
      },
    );
  });

  it("keeps request-scoped and unrecognized 402 responses as record failures", async () => {
    const bodyless = await buildProviderError("anthropic", new Response("", { status: 402 }));
    const resourceLimit = await buildProviderError(
      "anthropic",
      jsonResponse(402, { slug: "resource-limit-exceeded", error: "Too many output tokens" }),
    );
    const runLimit = await buildProviderError(
      "anthropic",
      jsonResponse(402, {
        slug: "insufficient-credits",
        error: "Agent run credit limit exceeded",
        suggestion: "Start a new reviewed run or reduce the scope of this run.",
        balance: 0,
        required: 1,
      }),
    );

    assertEquals(classifyEvalModelAccessDenial(bodyless), undefined);
    assertEquals(classifyEvalModelAccessDenial(resourceLimit), undefined);
    assertEquals(classifyEvalModelAccessDenial(runLimit), undefined);
  });

  it("classifies the gateway project-required 400 with fixed gateway wording", async () => {
    const error = await rejectedRequest(veryfrontApiOrigin(), 400, {
      body: { error: "echoed prompt text sk-live-123", code: "gateway_project_required" },
    });
    const denial = classifyEvalModelAccessDenial(error);
    if (!denial) throw new Error("expected a project-required denial");
    const evalError = createEvalModelAccessDeniedError("eval:triage", denial, error);

    assertEquals(denial.kind, "project-required");
    assertEquals(evalError.slug, "eval-project-required");
    assertEquals(
      evalError.detail,
      'Eval "eval:triage" stopped at its first refused model request: A project is required to use Veryfront-managed AI inference',
    );
    assertEquals(
      evalError.suggestion,
      "Set VERYFRONT_PROJECT_SLUG in .env or projectSlug in veryfront.config.ts to a project you can edit, then run veryfront eval again",
    );
    assertEquals(isEvalModelAccessDeniedError(evalError), true);
  });

  it("requires the gateway route for 400, 401, and 403 classification", async () => {
    const projectRequiredBody = { error: "x", code: "gateway_project_required" };
    // A BYOK provider behind a reverse proxy that shares the Veryfront API origin.
    const proxiedPath = "/proxy/anthropic/v1/messages";
    assertEquals(
      classifyEvalModelAccessDenial(
        await rejectedRequest(veryfrontApiOrigin(), 401, { path: proxiedPath }),
      ),
      undefined,
    );
    assertEquals(
      classifyEvalModelAccessDenial(
        await rejectedRequest(veryfrontApiOrigin(), 403, { path: proxiedPath }),
      ),
      undefined,
    );
    assertEquals(
      classifyEvalModelAccessDenial(
        await rejectedRequest(veryfrontApiOrigin(), 400, {
          path: proxiedPath,
          body: projectRequiredBody,
        }),
      ),
      undefined,
    );
    const unrouted = await buildProviderError("anthropic", jsonResponse(400, projectRequiredBody));
    assertEquals(classifyEvalModelAccessDenial(unrouted), undefined);
  });

  it("classifies rejections from a gateway fetch built with an explicit base URL", async () => {
    // A marked response is what the Veryfront Cloud gateway fetch returns,
    // whatever base URL it was created with (see shared.test.ts).
    const classifyStatus = async (status: number) => {
      try {
        await requestJson({
          url: "https://93.184.216.40/ai/gateway/anthropic/v1/messages",
          fetchImpl: () =>
            Promise.resolve(
              markVeryfrontGatewayResponse(jsonResponse(status, { error: "Rejected" })),
            ),
          init: { method: "POST", body: "{}" },
          providerLabel: "veryfront-cloud",
          providerKind: "anthropic",
        });
      } catch (error) {
        return classifyEvalModelAccessDenial(error)?.kind;
      }
      throw new Error("expected the request to reject");
    };

    assertEquals(await classifyStatus(401), "unauthorized");
    assertEquals(await classifyStatus(403), "forbidden");
  });

  it("keeps other 400 responses as record failures", async () => {
    const otherCode = await buildProviderError(
      "anthropic",
      jsonResponse(400, { error: "Bad request", code: "invalid_model" }),
    );
    const invalidRequest = await buildProviderError(
      "anthropic",
      jsonResponse(400, {
        type: "error",
        error: { type: "invalid_request_error", message: "gateway_project_required" },
      }),
    );

    assertEquals(classifyEvalModelAccessDenial(otherCode), undefined);
    assertEquals(classifyEvalModelAccessDenial(invalidRequest), undefined);
  });

  it("keeps direct-provider 402 responses as record failures", async () => {
    const anthropic = await buildProviderError(
      "anthropic",
      jsonResponse(402, {
        type: "error",
        error: { type: "billing_error", message: "Your credit balance is too low" },
      }),
    );
    const openai = await buildProviderError(
      "openai",
      jsonResponse(402, { error: { code: "insufficient_quota", message: "Payment required" } }),
    );
    anthropic.message = `anthropic request failed: ${anthropic.message}: payment required`;

    assertEquals(classifyEvalModelAccessDenial(anthropic), undefined);
    assertEquals(classifyEvalModelAccessDenial(openai), undefined);
  });

  it("classifies agent service 402 gateway problem bodies", () => {
    assertEquals(
      classifyAgentServiceModelAccessDenial({
        status: 402,
        body: JSON.stringify({ slug: "insufficient-credits", error: "AI credit limit exceeded" }),
      })?.code,
      "INSUFFICIENT_CREDITS",
    );
    assertEquals(
      classifyAgentServiceModelAccessDenial({
        status: 402,
        body: null,
        runErrorCode: "RESOURCE_LIMIT_EXCEEDED",
        runErrorMessage: "Resource limit exceeded",
      }),
      undefined,
    );
    assertEquals(
      classifyAgentServiceModelAccessDenial({ status: 500, body: "Payment required" }),
      undefined,
    );
  });

  it("finds a denial wrapped by retry and cause chains", async () => {
    const denial = await gatewayCreditDenial();
    const retryError = Object.assign(new Error("retries exhausted"), { lastError: denial });
    const wrapped = new Error("agent failed", { cause: retryError });

    assertEquals(classifyEvalModelAccessDenial(wrapped)?.code, "INSUFFICIENT_CREDITS");
  });

  it("ignores non-402 provider errors and free-form project error text", async () => {
    const serverError = await buildProviderError(
      "anthropic",
      jsonResponse(500, { error: { type: "api_error" } }),
    );

    assertEquals(classifyEvalModelAccessDenial(serverError), undefined);
    assertEquals(
      classifyEvalModelAccessDenial(new Error("Payment required: credit limit exceeded")),
      undefined,
    );
    assertEquals(classifyEvalModelAccessDenial("insufficient-credits"), undefined);
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    assertEquals(classifyEvalModelAccessDenial(cyclic), undefined);
  });

  it("classifies 401 and 403 rejections from the configured Veryfront API origin", async () => {
    const unauthorized = classifyEvalModelAccessDenial(
      await rejectedRequest(veryfrontApiOrigin(), 401),
    );
    const forbidden = classifyEvalModelAccessDenial(
      await rejectedRequest(veryfrontApiOrigin(), 403),
    );

    assertEquals(unauthorized?.kind, "unauthorized");
    assertEquals(forbidden?.kind, "forbidden");
    const unauthorizedError = createEvalModelAccessDeniedError("eval:a", unauthorized!, undefined);
    const forbiddenError = createEvalModelAccessDeniedError("eval:a", forbidden!, undefined);
    assertEquals(unauthorizedError.slug, "eval-model-unauthorized");
    assertEquals(forbiddenError.slug, "eval-model-project-access-denied");
    assertEquals(getEvalModelAccessDenialKind(forbiddenError), "forbidden");
    assertEquals(isEvalModelAccessDeniedError(unauthorizedError), true);
  });

  it("keeps 401 and 403 rejections from other origins as record failures", async () => {
    // A direct or BYOK provider, even one configured with the veryfront-cloud label.
    assertEquals(
      classifyEvalModelAccessDenial(await rejectedRequest("https://api.anthropic.com", 401)),
      undefined,
    );
    assertEquals(
      classifyEvalModelAccessDenial(await rejectedRequest("https://api.openai.com", 403)),
      undefined,
    );
    const originless = await buildProviderError("anthropic", jsonResponse(401, { error: "x" }));
    assertEquals(classifyEvalModelAccessDenial(originless), undefined);
    assertEquals(
      classifyEvalModelAccessDenial(new Error("veryfront-cloud request failed: 401 Unauthorized")),
      undefined,
    );
  });

  it("builds one registry error that names the eval and the denial", async () => {
    const cause = await gatewayCreditDenial();
    const denial = classifyEvalModelAccessDenial(cause);
    if (!denial) throw new Error("expected a denial");

    const error = createEvalModelAccessDeniedError("eval:triage", denial, cause);

    assertEquals(error instanceof VeryfrontError, true);
    assertEquals(error.slug, "eval-model-access-denied");
    assertEquals(error.status, 402);
    assertEquals(
      error.detail,
      'Eval "eval:triage" stopped at its first refused model request: AI credit limit exceeded: 0.25 credits required, 0 available. Purchase additional credits or upgrade your subscription plan.',
    );
    assertEquals(
      error.suggestion,
      "Veryfront Cloud refused the model request for billing or entitlement reasons, not authentication. Add AI credits or upgrade the plan for the account that owns the linked project at https://veryfront.com/settings/billing, then run the eval again. See https://veryfront.com/docs/api/errors/insufficient-credits",
    );
    assertEquals(isEvalModelAccessDeniedError(error), true);
    assertEquals(isEvalModelAccessDeniedError(cause), false);
  });

  it("classifies a gateway request the egress guard blocks for a private DNS answer", async () => {
    const apiHost = new URL(veryfrontApiOrigin()).hostname;
    const blocked = await blockedModelRequest(
      `${veryfrontApiOrigin()}/ai/gateway/openai/v1/chat/completions`,
      ["10.255.128.3"],
    );
    const denial = classifyEvalModelAccessDenial(new Error("agent failed", { cause: blocked }));

    assertEquals(denial?.kind, "egress-blocked");
    assertEquals(
      denial?.message,
      "Veryfront blocked the request to the configured Veryfront API because its host resolves to a private network address",
    );
    const error = createEvalModelAccessDeniedError("eval:staging", denial!, blocked);
    // An internal API hostname must not reach user-facing error output.
    assertEquals(error.detail?.includes(apiHost), false);
    assertEquals(error.message.includes(apiHost), false);
    assertEquals(error.slug, "eval-model-egress-blocked");
    assertEquals(error.status, 403);
    assertEquals(
      error.suggestion?.includes("VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS"),
      true,
    );
    assertEquals(getEvalModelAccessDenialKind(error), "egress-blocked");
  });

  it("keeps an egress block outside the Veryfront gateway route as a record failure", async () => {
    const api = new URL(veryfrontApiOrigin());
    // Another port on the API host, a non-gateway path on the API origin, and a
    // local provider.
    for (
      const url of [
        `${api.protocol}//${api.hostname}:8443/ai/gateway/openai/v1/chat/completions`,
        `${api.origin}/v1/chat/completions`,
        "http://localhost:11434/v1/chat/completions",
      ]
    ) {
      assertEquals(
        classifyEvalModelAccessDenial(await blockedModelRequest(url, ["10.255.128.3"])),
        undefined,
        url,
      );
    }
  });

  it("ignores a private-address block outside a model request", async () => {
    // A tool, agent tool, or custom metric calling a private endpoint through a
    // guarded transport fails only its own record, even on the gateway route.
    const gatewayUrl = `${veryfrontApiOrigin()}/ai/gateway/openai/v1/chat/completions`;
    const toolBlock = await captureRejection(() =>
      blockingGuardedFetch(veryfrontApiOrigin(), ["10.255.128.3"])(gatewayUrl)
    );

    assertEquals(toolBlock instanceof OutboundRequestBlockedError, true);
    assertEquals(classifyEvalModelAccessDenial(toolBlock), undefined);
    assertEquals(
      classifyEvalModelAccessDenial(new Error("tool failed", { cause: toolBlock })),
      undefined,
    );
  });

  it("ignores egress refusals that are not a private-address block", async () => {
    const crossOrigin = await captureRejection(() =>
      requestJson({
        url: `https://other.example/ai/gateway/openai/v1/chat/completions`,
        fetchImpl: blockingGuardedFetch("https://api.example", ["93.184.216.34"]),
        init: { method: "POST", body: "{}" },
        providerLabel: "veryfront-cloud",
        providerKind: "openai",
      })
    );
    assertEquals(classifyEvalModelAccessDenial(crossOrigin), undefined);
    assertEquals(
      classifyEvalModelAccessDenial(
        new Error("Outbound network egress blocked for host: api.veryfront.org"),
      ),
      undefined,
    );
  });

  it("ignores a proxy or broker failure that reuses the private-address wording", () => {
    // The SOCKS proxy and the worker broker report connection refused or
    // network unreachable with the same message as a private DNS answer.
    const apiHost = new URL(veryfrontApiOrigin()).hostname;
    const boundaryError = new OutboundRequestBlockedError(
      `Outbound network egress blocked for host: ${apiHost}`,
      {
        cause: new WorkerEgressBlockedError(`Worker network egress blocked for host: ${apiHost}`),
      },
    );

    assertEquals(classifyEvalModelAccessDenial(boundaryError), undefined);
  });

  it("classifies a block from a gateway transport with an explicit base URL", async () => {
    // createVeryfrontCloudInferenceModel(..., { apiBaseUrl }) builds a gateway
    // transport for a run-scoped API URL that no globally configured route
    // matches. The gateway fetch marks what it throws, so provenance holds.
    const explicitGateway = "https://run-scoped.example:8443";
    const blocked = await blockedModelRequest(
      `${explicitGateway}/ai/gateway/openai/v1/chat/completions`,
      ["10.255.128.3"],
    );
    assertEquals(classifyEvalModelAccessDenial(blocked), undefined);

    markVeryfrontGatewayTransportFailure(blocked);
    assertEquals(classifyEvalModelAccessDenial(blocked)?.kind, "egress-blocked");
  });

  describe("explainConfiguredProjectDenial", () => {
    const projectRequired = () =>
      createEvalModelAccessDeniedError("eval:triage", {
        kind: "project-required",
        code: "gateway_project_required",
        message: "A project is required to use Veryfront-managed AI inference",
      }, undefined);

    it("names the slug that was sent without confirming the project exists", () => {
      const original = projectRequired();
      const explained = explainConfiguredProjectDenial(
        original,
        " agentic-email-processing-outlok ",
      );

      if (!(explained instanceof VeryfrontError)) throw new Error("expected a VeryfrontError");
      assertEquals(explained.slug, "eval-project-required");
      assertEquals(
        explained.detail,
        'Eval "eval:triage" stopped at its first refused model request: Veryfront Cloud found no project ' +
          '"agentic-email-processing-outlok" that this credential can use (it does not exist or you do not have access)',
      );
      assertEquals(explained.cause, original);
      assertEquals(isEvalModelAccessDeniedError(explained), true);
    });

    it("bounds a long slug", () => {
      const explained = explainConfiguredProjectDenial(projectRequired(), "a".repeat(150));

      if (!(explained instanceof VeryfrontError)) throw new Error("expected a VeryfrontError");
      assertEquals(explained.detail?.includes(`"${"a".repeat(100)}..."`), true);
    });

    it("leaves the error alone without a slug or for other denials", () => {
      const original = projectRequired();
      const billing = createEvalModelAccessDeniedError("eval:triage", {
        kind: "billing",
        code: "INSUFFICIENT_CREDITS",
        message: "Insufficient AI credits",
      }, undefined);
      const other = new Error("boom");

      assertEquals(explainConfiguredProjectDenial(original, undefined), original);
      assertEquals(explainConfiguredProjectDenial(original, "  "), original);
      assertEquals(explainConfiguredProjectDenial(billing, "some-project"), billing);
      assertEquals(explainConfiguredProjectDenial(other, "some-project"), other);
    });
  });
});
