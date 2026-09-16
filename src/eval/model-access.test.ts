import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { buildProviderError } from "#veryfront/provider/runtime-loader/provider-http.ts";
import {
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

    assertEquals(classifyEvalModelAccessDenial(error)?.code, "AI_PROVIDER_SPEND_LIMIT_EXCEEDED");
  });

  it("classifies a 402 without a recognized body as payment required", async () => {
    const error = await buildProviderError("anthropic", new Response("", { status: 402 }));

    assertEquals(classifyEvalModelAccessDenial(error)?.code, "PAYMENT_REQUIRED");
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
