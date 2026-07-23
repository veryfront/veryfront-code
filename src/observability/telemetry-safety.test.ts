import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  classifyTelemetryError,
  extractSafeHttpScheme,
  normalizeHttpMethod,
  normalizeRouteTemplate,
  normalizeTelemetryName,
  sanitizeTelemetryAttributes,
} from "./telemetry-safety.ts";

describe("observability/telemetry-safety", () => {
  it("normalizes HTTP dimensions to bounded values", () => {
    assertEquals(normalizeHttpMethod("post"), "POST");
    assertEquals(normalizeHttpMethod("PRIVATE_CUSTOM_METHOD_CANARY"), "OTHER");
    assertEquals(normalizeHttpMethod({}), "OTHER");
    assertEquals(extractSafeHttpScheme("https://private.example/path"), "https");
    assertEquals(extractSafeHttpScheme("private-canary://customer/path"), undefined);
    assertEquals(extractSafeHttpScheme("not a url"), undefined);
  });

  it("accepts only bounded, code-owned route template syntax", () => {
    assertEquals(normalizeRouteTemplate("/"), "/");
    assertEquals(
      normalizeRouteTemplate("/projects/{project}/files/:file"),
      "/projects/{project}/files/:file",
    );
    assertEquals(normalizeRouteTemplate("https://private.example/path"), undefined);
    assertEquals(normalizeRouteTemplate("/path?customer=private-canary"), undefined);
    assertEquals(normalizeRouteTemplate("/path#private-canary"), undefined);
    assertEquals(normalizeRouteTemplate("/path/private value"), undefined);
  });

  it("classifies hostile thrown values without stringifying them", () => {
    let stringificationReads = 0;
    let errorDetailReads = 0;
    const hostile = {
      get toString(): never {
        stringificationReads++;
        throw new Error("private-stringification-canary");
      },
    };
    const hostileError = new Error();
    for (const property of ["message", "stack", "cause"] as const) {
      Object.defineProperty(hostileError, property, {
        configurable: true,
        get() {
          errorDetailReads++;
          throw new Error(`private-${property}-canary`);
        },
      });
    }

    assertEquals(classifyTelemetryError(hostile), "thrown_object");
    assertEquals(classifyTelemetryError(Symbol("private-symbol-canary")), "thrown_symbol");
    assertEquals(classifyTelemetryError(new TypeError("private-message-canary")), "type_error");
    assertEquals(classifyTelemetryError(hostileError), "error");
    assertEquals(stringificationReads, 0);
    assertEquals(errorDetailReads, 0);
  });

  it("bounds caller-controlled telemetry names and attributes", () => {
    const attributes = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `dimension.${index}`,
        index === 0 ? "token=secret-value" : "x".repeat(500),
      ]),
    );
    attributes.invalidNumber = Number.NaN as unknown as string;

    const sanitized = sanitizeTelemetryAttributes(attributes);

    assertEquals(Object.keys(sanitized).length, 32);
    assertEquals(String(sanitized["dimension.0"]).includes("secret-value"), false);
    assertEquals(
      Object.values(sanitized).every((value) => typeof value !== "string" || value.length <= 256),
      true,
    );
    assertEquals(sanitized.invalidNumber, undefined);
    assertEquals(
      normalizeTelemetryName(`operation\n${"x".repeat(200)}`),
      `operation${"x".repeat(119)}`,
    );
    assertEquals(normalizeTelemetryName("\n"), "operation");
  });
});
