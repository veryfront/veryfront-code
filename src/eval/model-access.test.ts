import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { buildProviderError } from "#veryfront/provider/runtime-loader/provider-http.ts";
import {
  classifyAgentServiceModelAccessDenial,
  classifyEvalModelAccessDenial,
  createEvalModelAccessDeniedError,
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

  it("rebuilds agent service denial messages from the curated code", () => {
    const denial = classifyAgentServiceModelAccessDenial({
      status: 402,
      body: null,
      runErrorCode: "INSUFFICIENT_CREDITS",
      runErrorMessage: "secret prompt text sk-live-123",
    });
    const runLimit = classifyAgentServiceModelAccessDenial({
      status: 402,
      body: null,
      runErrorCode: "INSUFFICIENT_CREDITS",
      runErrorMessage: "Agent run credit limit exceeded: 1 credits required, 0 remaining.",
    });

    assertEquals(denial, {
      kind: "billing",
      code: "INSUFFICIENT_CREDITS",
      message: "Insufficient AI credits",
    });
    assertEquals(runLimit, undefined);
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
    const error = await buildProviderError(
      "anthropic",
      jsonResponse(400, {
        error: "echoed prompt text sk-live-123",
        code: "gateway_project_required",
      }),
    );
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
      "Run veryfront eval from a linked project directory, or set VERYFRONT_PROJECT_SLUG (see .env.example)",
    );
    assertEquals(isEvalModelAccessDeniedError(evalError), true);
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

  it("classifies agent service RUN_ERROR codes and 402 problem bodies", () => {
    assertEquals(
      classifyAgentServiceModelAccessDenial({
        status: 402,
        body: null,
        runErrorCode: "INSUFFICIENT_CREDITS",
        runErrorMessage: "Insufficient AI credits",
      })?.code,
      "INSUFFICIENT_CREDITS",
    );
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
});
