import "#veryfront/schemas/_test-setup.ts";
import { API_CLIENT_ERROR, VeryfrontError } from "#veryfront/errors";
import { assertInstanceOf, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createIntegrationClient,
  IntegrationApiError,
  type IntegrationCallOutcome,
  type IntegrationClient,
  type IntegrationClientContext,
  type IntegrationFailureCondition,
  type IntegrationHttpProblem,
} from "./index.ts";
import {
  createIntegrationClient as implementation,
  IntegrationApiError as errorImplementation,
} from "./client.ts";

const publicConstructor: (context: IntegrationClientContext) => Promise<IntegrationClient> =
  createIntegrationClient;
function condition(outcome: IntegrationCallOutcome): IntegrationFailureCondition | undefined {
  return outcome.status === "tool_error" ? outcome.condition : undefined;
}

describe("integration client public barrel", () => {
  it("exports the typed constructor, native outcome and safe failure metadata", () => {
    assertStrictEquals(publicConstructor, implementation);
    assertStrictEquals(IntegrationApiError, errorImplementation);
    assertStrictEquals(condition({ status: "success", result: { content: [] } }), undefined);
    const error = new IntegrationApiError("transport", undefined, true);
    const problem: IntegrationHttpProblem | undefined = error.httpProblem;
    assertInstanceOf(error, VeryfrontError);
    assertStrictEquals(error.slug, API_CLIENT_ERROR.slug);
    assertStrictEquals(error.status, API_CLIENT_ERROR.status);
    assertStrictEquals(error.httpStatus, undefined);
    assertStrictEquals(problem, undefined);
  });
});
