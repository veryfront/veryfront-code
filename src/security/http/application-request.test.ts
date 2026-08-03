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
        },
      }),
    );

    assertEquals(application.headers.get("authorization"), "Bearer public-user");
    assertEquals(application.headers.get("cookie"), "session=public");
    assertEquals(application.headers.get("x-application-role"), "editor");
    assertEquals(application.headers.get("proxy-authorization"), null);
    assertEquals(application.headers.get("x-forwarded-host"), null);
    assertEquals(application.headers.get("x-project-id"), null);
    assertEquals(application.headers.get("x-branch-name"), null);
    assertEquals(application.headers.get("x-release-id"), null);
    assertEquals(application.headers.get("x-content-source-id"), null);
    assertEquals(application.headers.get("x-environment-id"), null);
    assertEquals(application.headers.get("x-token"), null);
    assertEquals(application.headers.get("x-veryfront-future-control-secret"), null);
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
