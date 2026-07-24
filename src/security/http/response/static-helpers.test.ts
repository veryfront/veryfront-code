import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ResponseBuilder } from "./builder.ts";
import { MAX_CORS_TOKEN_LENGTH } from "#veryfront/utils/cors-policy-limits.ts";
import { DEFAULT_METHODS } from "../cors/constants.ts";

describe("security/http/response/static-helpers", () => {
  it("emits the effective configured CORS max age on an allowed preflight", () => {
    const origin = "https://app.example.com";
    const response = ResponseBuilder.preflight(
      new Request("https://project.example.com/api/items", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "GET",
        },
      }),
      {
        corsConfig: {
          origin,
          maxAge: 7,
        },
      },
    );

    assertEquals(response.status, 204);
    assertEquals(response.headers.get("access-control-allow-origin"), origin);
    assertEquals(response.headers.get("access-control-max-age"), "7");
  });

  it("does not emit an oversized runtime method capability", () => {
    const origin = "https://app.example.com";
    const response = ResponseBuilder.preflight(
      new Request("https://project.example.com/api/items", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "GET",
        },
      }),
      {
        allowMethods: ["M".repeat(MAX_CORS_TOKEN_LENGTH + 1)],
        corsConfig: { origin },
      },
    );

    assertEquals(response.status, 204);
    assertEquals(response.headers.get("allow"), null);
    assertEquals(response.headers.get("access-control-allow-methods"), null);
  });

  it("fails malformed CORS configuration closed without emitting max age", () => {
    const origin = "https://app.example.com";

    for (
      const corsConfig of [
        { origin, maxAge: Number.NaN },
        { origin, maxAge: Number.POSITIVE_INFINITY },
        { origin, maxAge: -1 },
        { origin, maxAge: Number.MAX_SAFE_INTEGER + 1 },
        { origin, credentials: "true" },
        { origin, unknown: true },
      ]
    ) {
      const response = ResponseBuilder.preflight(
        new Request("https://project.example.com/api/items", {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": "GET",
          },
        }),
        { corsConfig: corsConfig as never },
      );

      assertEquals(response.headers.get("access-control-allow-origin"), null);
      assertEquals(response.headers.get("access-control-allow-methods"), null);
      assertEquals(response.headers.get("access-control-allow-headers"), null);
      assertEquals(response.headers.get("access-control-max-age"), null);
    }
  });

  it("never emits max age for a denied origin", () => {
    const response = ResponseBuilder.preflight(
      new Request("https://project.example.com/api/items", {
        method: "OPTIONS",
        headers: {
          origin: "https://denied.example.com",
          "access-control-request-method": "GET",
        },
      }),
      {
        corsConfig: {
          origin: "https://allowed.example.com",
          maxAge: 7,
        },
      },
    );

    assertEquals(response.headers.get("access-control-allow-origin"), null);
    assertEquals(response.headers.get("access-control-max-age"), null);
  });

  it("scrubs all CORS policy headers on disabled, denied, and malformed preflights", () => {
    const request = new Request("https://project.example.com/api/items", {
      method: "OPTIONS",
      headers: {
        origin: "https://denied.example.com",
        "access-control-request-method": "GET",
        "access-control-request-headers": "Authorization",
      },
    });

    for (
      const corsConfig of [
        false,
        { origin: "https://allowed.example.com" },
        { origin: "https://denied.example.com", unknown: true },
      ]
    ) {
      const response = ResponseBuilder.preflight(request, {
        corsConfig: corsConfig as never,
      });

      assertEquals(response.headers.get("Allow"), DEFAULT_METHODS.join(", "));
      for (const [name] of response.headers) {
        assertEquals(name.toLowerCase().startsWith("access-control-"), false);
      }
    }
  });
});
