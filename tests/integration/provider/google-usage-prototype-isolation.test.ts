// These cases mutate process-wide prototypes, so they run outside hermetic unit suites.
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { extractGoogleUsage } from "../../../extensions/ext-llm-google/src/google-stream.ts";

const gatewayFields = {
  billing_mode: "direct",
  cost_source: "gateway",
  usage_capture_status: "complete",
  billable_input_tokens: 8,
  billable_output_tokens: 2,
  cost_credits: "0.0250000000",
};
const nativeUsage = { promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10 };
const normalizedNativeUsage = { inputTokens: 8, outputTokens: 2, totalTokens: 10 };

it("ignores billing fields inherited from Object.prototype", () => {
  const original = Object.setPrototypeOf(
    Object.getOwnPropertyDescriptors(Object.prototype),
    null,
  );
  let actual: ReturnType<typeof extractGoogleUsage>;
  try {
    for (const [key, value] of Object.entries(gatewayFields)) {
      Object.defineProperty(Object.prototype, key, { configurable: true, value });
    }
    actual = extractGoogleUsage({ usageMetadata: { ...nativeUsage, veryfront: {} } });
  } finally {
    for (const key of Object.keys(gatewayFields)) {
      const descriptor = original[key];
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
      else Reflect.deleteProperty(Object.prototype, key);
    }
  }
  assertEquals(actual, normalizedNativeUsage);
});

it("does not consult an inherited descriptor value when rejecting an accessor", () => {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  let reads = 0;
  const veryfront = {};
  Object.defineProperty(veryfront, "billing_mode", { get: () => "direct" });
  let actual: ReturnType<typeof extractGoogleUsage>;
  try {
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      get() {
        reads++;
        return "direct";
      },
    });
    actual = extractGoogleUsage({ usageMetadata: { ...nativeUsage, veryfront } });
  } finally {
    if (original) Object.defineProperty(Object.prototype, "value", original);
    else Reflect.deleteProperty(Object.prototype, "value");
  }
  assertEquals(reads, 0);
  assertEquals(actual, normalizedNativeUsage);
});
