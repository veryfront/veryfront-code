import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createProxyErrorResponse } from "./error-response.ts";

describe("createProxyErrorResponse", () => {
  it("renders a not found HTML page for missing preview projects", async () => {
    const response = createProxyErrorResponse({
      status: 404,
      message: "Preview project not found",
      slug: "project-not-found",
    });

    assertEquals(response.status, 404);
    assertEquals(response.headers.get("Content-Type"), "text/html; charset=utf-8");
    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");

    const body = await response.text();
    assertStringIncludes(body, "<title>404 Not Found");
    assertStringIncludes(body, "The page you requested could not be found.");
    assertEquals(body.includes("x-token header is required in proxy mode"), false);
  });

  it("preserves sign-in redirects for protected projects", () => {
    const response = createProxyErrorResponse({
      status: 302,
      message: "Authentication required",
      redirectUrl: "https://veryfront.com/sign-in?from=%2F",
    });

    assertEquals(response.status, 302);
    assertEquals(response.headers.get("Location"), "https://veryfront.com/sign-in?from=%2F");
    assertEquals(response.headers.get("Cache-Control"), "no-store");
  });

  it("fails closed for redirect targets outside the Veryfront sign-in route", async () => {
    const response = createProxyErrorResponse({
      status: 302,
      message: "Authentication required",
      redirectUrl: "https://attacker.example/steal",
    });

    assertEquals(response.status, 500);
    assertEquals(response.headers.get("Location"), null);
    assertEquals(await response.json(), { error: "Internal Proxy Error", status: 500 });
  });

  it("fails closed when the sign-in return target is not an approved proxy path", async () => {
    const response = createProxyErrorResponse({
      status: 302,
      message: "Authentication required",
      redirectUrl: "https://veryfront.com/sign-in?from=https%3A%2F%2Fattacker.example%2Fsteal",
    });

    assertEquals(response.status, 500);
    assertEquals(response.headers.get("Location"), null);
  });

  it("keeps generic errors as JSON", async () => {
    const response = createProxyErrorResponse({
      status: 502,
      message: "Failed to authenticate preview request",
    });

    assertEquals(response.status, 502);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(
      await response.text(),
      JSON.stringify({
        error: "Failed to authenticate preview request",
        status: 502,
      }),
    );
  });
});
