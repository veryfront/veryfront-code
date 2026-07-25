import { assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_VERYFRONT_API_RETRIES } from "#veryfront/utils/config-resource-limits.ts";
import {
  createCanonicalVeryfrontApiTransport,
  createVeryfrontApiTransport,
  type TransportRetryConfig,
} from "./veryfront-api-transport.ts";

describe("Veryfront API transport retry boundaries", () => {
  const baseConfig = {
    baseUrl: "https://api.example.com",
    getToken: () => "token",
  };

  it("rejects retry policies that exceed ten total attempts", () => {
    assertThrows(
      () =>
        createVeryfrontApiTransport({
          ...baseConfig,
          retry: { maxRetries: 10, initialDelay: 0, maxDelay: 0 },
        }),
      RangeError,
      "maxRetries",
    );

    assertThrows(
      () =>
        createCanonicalVeryfrontApiTransport(
          "https://api.example.com",
          () => "token",
          { maxRetries: 10, initialDelay: 0, maxDelay: 0 },
        ),
      RangeError,
      "maxRetries",
    );
  });

  it("rejects a missing retry policy at direct JavaScript boundaries", () => {
    assertThrows(
      () =>
        createVeryfrontApiTransport({
          ...baseConfig,
          retry: undefined as unknown as TransportRetryConfig,
        }),
      RangeError,
      "retry config is required",
    );
  });

  it("rejects unsafe delays and inverted delay ranges", () => {
    for (
      const retry of [
        { maxRetries: 0, initialDelay: Number.NaN, maxDelay: 0 },
        { maxRetries: 0, initialDelay: 0, maxDelay: Number.POSITIVE_INFINITY },
        { maxRetries: 0, initialDelay: 2, maxDelay: 1 },
      ]
    ) {
      assertThrows(
        () => createVeryfrontApiTransport({ ...baseConfig, retry }),
        RangeError,
      );
    }
  });

  it("accepts nine retries as the ten-total-attempt boundary", () => {
    createVeryfrontApiTransport({
      ...baseConfig,
      retry: {
        maxRetries: MAX_VERYFRONT_API_RETRIES,
        initialDelay: 0,
        maxDelay: 0,
      },
    });
    createCanonicalVeryfrontApiTransport(
      baseConfig.baseUrl,
      baseConfig.getToken,
      {
        maxRetries: MAX_VERYFRONT_API_RETRIES,
        initialDelay: 0,
        maxDelay: 0,
      },
    );
  });
});
