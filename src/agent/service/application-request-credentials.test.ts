import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { withoutPrivateInvocationCredentials } from "./application-request-credentials.ts";

// Plain-data filter tests only: no Request, Headers, streams or replaced native/prototype hooks.
Deno.test("application invocation omits private source and inference authority", () => {
  const credentials = Object.freeze({
    authToken: "delegated-application-authority",
    sourceAuthToken: "private-release-source-authority",
    inferenceAuthToken: "private-inference-authority",
  });
  const result = withoutPrivateInvocationCredentials(credentials);
  assertEquals(Object.keys(result), ["authToken"]);
  assertEquals(result.authToken, credentials.authToken);
  assertEquals(credentials.sourceAuthToken, "private-release-source-authority");
  assertEquals(credentials.inferenceAuthToken, "private-inference-authority");
});

Deno.test("application invocation preserves delegated credential values and ownership", () => {
  const delegated = Object.freeze({ audience: "application" });
  const credentials = Object.freeze({ authToken: "application-authority", delegated });
  const result = withoutPrivateInvocationCredentials(credentials);
  assertEquals(Object.keys(result), ["authToken", "delegated"]);
  assertStrictEquals(result.delegated, delegated);
  assertStrictEquals(Object.getPrototypeOf(result), null);
});
