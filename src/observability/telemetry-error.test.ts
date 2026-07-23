import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  sanitizeErrorForTelemetry,
  sanitizeStructuredTelemetryData,
  sanitizeTelemetryAttributes,
  type TelemetryAttributeValue,
} from "./telemetry-error.ts";

describe("observability/telemetry-error", () => {
  it("sanitizes hostile flattened attributes without throwing", () => {
    const attributes: Record<string, string> = { safe: "value" };
    Object.defineProperty(attributes, "detail", {
      enumerable: true,
      get() {
        throw new Error("hostile attribute getter");
      },
    });
    Object.defineProperty(attributes, "apiKey", {
      enumerable: true,
      get() {
        throw new Error("secret getter must not run");
      },
    });

    assertEquals(sanitizeTelemetryAttributes(attributes), {
      safe: "value",
      detail: "[REDACTED]",
      apiKey: "[REDACTED]",
    });
  });

  it("returns an empty safe attribute record when enumeration is hostile", () => {
    const attributes = new Proxy({}, {
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });

    assertEquals(sanitizeTelemetryAttributes(attributes), {});
  });

  it("preserves numeric semantic token counts while redacting token secrets", () => {
    const attributes: Record<string, TelemetryAttributeValue> = {
      "gen_ai.usage.input_tokens": 2,
      "gen_ai.usage.output_tokens": 3,
      "gen_ai.usage.total_tokens": 5,
      token: 12345,
      "gen_ai.usage.prompt_tokens": "secret",
    };

    assertEquals(
      sanitizeTelemetryAttributes(attributes),
      {
        "gen_ai.usage.input_tokens": 2,
        "gen_ai.usage.output_tokens": 3,
        "gen_ai.usage.total_tokens": 5,
        token: "[REDACTED]",
        "gen_ai.usage.prompt_tokens": "[REDACTED]",
      },
    );
  });

  it("sanitizes values with hostile prototype inspection without throwing", () => {
    const hostile = new Proxy({}, {
      getPrototypeOf() {
        throw new Error("prototype unavailable");
      },
      get() {
        throw new Error("property unavailable");
      },
    });

    const sanitized = sanitizeErrorForTelemetry(hostile);

    assertEquals(sanitized.name, "Unknown");
    assertEquals(sanitized.message, "Unknown error");
  });

  it("deeply detaches structured data and sanitizes every serialized string", () => {
    const date = new Date("2025-01-02T03:04:05.000Z");
    const url = new URL("https://user:password@example.test/path?token=secret");
    const cycle: Record<string, unknown> = { safe: "cycle" };
    cycle.self = cycle;
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, "value", {
      enumerable: true,
      get() {
        throw new Error("hostile getter");
      },
    });

    const snapshot = sanitizeStructuredTelemetryData({
      message: "failed https://user:password@example.test/path?access_token=secret",
      apiKey: "must-not-be-read",
      date,
      url,
      scalarJson: {
        toJSON: () => "https://example.test/path?token=secret",
      },
      cycle,
      hostile,
    }) as Record<string, unknown>;

    assertEquals(String(snapshot.message).includes("secret"), false);
    assertEquals(snapshot.apiKey, "[REDACTED]");
    assertEquals(snapshot.date instanceof Date, true);
    assertEquals(snapshot.date === date, false);
    assertEquals(snapshot.url instanceof URL, true);
    assertEquals(snapshot.url === url, false);
    assertEquals((snapshot.url as URL).href.includes("secret"), false);
    assertEquals(String(snapshot.scalarJson).includes("secret"), false);
    assertEquals((snapshot.cycle as Record<string, unknown>).self, "[REDACTED]");
    assertEquals((snapshot.hostile as Record<string, unknown>).value, "[REDACTED]");

    const snapshotDate = snapshot.date as Date;
    snapshotDate.setUTCFullYear(2030);
    assertEquals(date.getUTCFullYear(), 2025);
    assertExists(snapshot.scalarJson);
  });
});
