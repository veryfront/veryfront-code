import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createApplicationRequest } from "./application-request.ts";

describe("security/http/application-request", () => {
  it("retains application credentials and withholds infrastructure metadata", () => {
    const application = createApplicationRequest(
      new Request("https://tenant.example/api/private", {
        headers: {
          Authorization: "Bearer public-user",
          Cookie: "session=public",
          "x-application-role": "editor",
          "proxy-authorization": "Basic infrastructure-proxy",
          "x-forwarded-host": "trusted-proxy.example",
          "x-project-id": "infrastructure-project",
          "x-branch-name": "infrastructure-branch",
          "x-release-id": "infrastructure-release",
          "x-content-source-id": "infrastructure-source",
          "x-environment-id": "infrastructure-environment",
          "x-token": "host-secret",
          "x-veryfront-future-control-secret": "future-secret",
          "cf-connecting-ip": "203.0.113.9",
          "fastly-client-ip": "203.0.113.9",
          "forwarded": "for=203.0.113.9",
          "true-client-ip": "203.0.113.9",
          "x-real-ip": "203.0.113.9",
          "x-authoritative": "1",
          "x-environment": "production",
        },
      }),
    );

    assertEquals(
      application.headers.get("authorization"),
      "Bearer public-user",
      "the end-user credential is part of the application contract",
    );
    assertEquals(
      application.headers.get("cookie"),
      "session=public",
      "the end-user session cookie is part of the application contract",
    );
    assertEquals(
      application.headers.get("x-application-role"),
      "editor",
      "an application-owned header must cross the project boundary",
    );
    for (
      const name of [
        "proxy-authorization",
        "x-forwarded-host",
        "x-project-id",
        "x-branch-name",
        "x-release-id",
        "x-content-source-id",
        "x-environment-id",
        "x-token",
        "x-veryfront-future-control-secret",
        "cf-connecting-ip",
        "fastly-client-ip",
        "forwarded",
        "true-client-ip",
        "x-real-ip",
        "x-authoritative",
        "x-environment",
      ]
    ) {
      assertEquals(
        application.headers.get(name),
        null,
        `${name} is infrastructure-only and must not cross the project boundary`,
      );
    }
  });

  it("detaches the request body and header list from the host request", async () => {
    const host = new Request("https://tenant.example/api/private", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-application-value": "before",
      },
      body: '{"ok":true}',
    });
    const application = createApplicationRequest(host);

    application.headers.set("x-application-value", "after");
    assertEquals(application.headers.get("x-application-value"), "after");
    assertEquals(host.headers.get("x-application-value"), "before");
    assertEquals(await application.text(), '{"ok":true}');
    assertEquals(await host.text(), '{"ok":true}');
  });
});
