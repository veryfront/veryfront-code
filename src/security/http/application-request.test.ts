import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createApplicationRequest,
  createApplicationRequestHeaders,
} from "./application-request.ts";

const nativeSetHas = Set.prototype.has;
const nativeSetAdd = Set.prototype.add;

function restoreSetPrimordials(): void {
  Set.prototype.has = nativeSetHas;
  Set.prototype.add = nativeSetAdd;
}

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

  it("removes configured trusted-proxy identity headers with a bounded case-insensitive denylist", () => {
    const application = createApplicationRequest(
      new Request("https://tenant.example/api/private", {
        headers: {
          authorization: "Bearer public-user",
          "x-auth-subject": "user-123",
          "x-auth-email": "user@example.test",
          "x-auth-name": "User Name",
          "x-application-role": "editor",
        },
      }),
      {
        denyHeaders: [
          "X-Auth-Subject",
          "x-auth-email",
          "x-auth-name",
          "x-auth-subject",
        ],
      },
    );

    assertEquals(application.headers.get("authorization"), "Bearer public-user");
    assertEquals(application.headers.get("x-application-role"), "editor");
    assertEquals(application.headers.get("x-auth-subject"), null);
    assertEquals(application.headers.get("x-auth-email"), null);
    assertEquals(application.headers.get("x-auth-name"), null);
  });

  it("rejects malformed dynamic denylist names before copying application headers", () => {
    const source = new Headers({ "x-application-role": "editor" });

    for (const denyHeaders of [["x-auth-subject\n"], ["x-auth-subject".repeat(50)]]) {
      const headers = createApplicationRequestHeaders(source, { denyHeaders });
      assertEquals(headers.get("x-application-role"), null);
    }
  });

  it("fails closed for accessor, proxy, sparse, symbol, and malformed-length denylists", () => {
    const source = new Headers({ "x-application-role": "editor" });
    const accessor = Object.defineProperty([], "0", {
      enumerable: true,
      get() {
        throw new Error("must not read denylist accessor");
      },
    }) as readonly string[];
    const proxy = new Proxy(["x-auth-subject"], {
      getOwnPropertyDescriptor() {
        throw new Error("must not leak proxy trap");
      },
    });
    const sparse = new Array(1) as readonly string[];
    const symbol = ["x-auth-subject"] as Array<string> & { [key: symbol]: string };
    symbol[Symbol("deny")] = "x-auth-email";
    const malformedLength = { length: 1, 0: "x-auth-subject" } as unknown as readonly string[];

    for (const denyHeaders of [accessor, proxy, sparse, symbol, malformedLength]) {
      const headers = createApplicationRequestHeaders(source, { denyHeaders });
      assertEquals(headers.get("x-application-role"), null);
    }
  });

  it("removes configured identity headers after Set.has tampering", () => {
    try {
      Set.prototype.has = (() => false) as typeof Set.prototype.has;
      const headers = createApplicationRequestHeaders(
        new Headers({
          "x-auth-subject": "user-123",
          "x-application-role": "editor",
        }),
        { denyHeaders: ["x-auth-subject"] },
      );

      assertEquals(headers.get("x-auth-subject"), null);
    } finally {
      restoreSetPrimordials();
    }
  });

  it("removes configured identity headers after Set.add tampering", () => {
    try {
      Set.prototype.add = function (): Set<unknown> {
        return this;
      } as typeof Set.prototype.add;
      const headers = createApplicationRequestHeaders(
        new Headers({
          "x-auth-subject": "user-123",
          "x-application-role": "editor",
        }),
        { denyHeaders: ["x-auth-subject"] },
      );

      assertEquals(headers.get("x-auth-subject"), null);
    } finally {
      restoreSetPrimordials();
    }
  });
});
