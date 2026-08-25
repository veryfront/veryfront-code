import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateCsrf } from "#veryfront/security/csrf/helpers.ts";
import { csrfMutationHeaders } from "#veryfront/security/csrf/browser-mutation-headers.ts";

function withDocument<T>(value: Document, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value,
  });

  try {
    return run();
  } finally {
    if (original) {
      Object.defineProperty(globalThis, "document", original);
    } else {
      delete (globalThis as { document?: Document }).document;
    }
  }
}

describe("security/csrf/browser-mutation-headers", () => {
  it("uses the default names and preserves caller headers", () => {
    withDocument(
      {
        baseURI: "https://app.example.test/cases",
        cookie: "__Host-vf_csrf=default-token",
        location: { origin: "https://app.example.test" },
      } as Document,
      () => {
        const headers = csrfMutationHeaders("/api/cases", {
          headers: { "content-type": "application/json" },
        });

        assertEquals(headers.get("content-type"), "application/json");
        assertEquals(headers.get("x-csrf-token"), "default-token");
      },
    );
  });

  it("uses configured names to build a request the server accepts", () => {
    withDocument(
      {
        baseURI: "https://app.example.test/cases",
        cookie: "my_csrf=token-123",
        location: { origin: "https://app.example.test" },
      } as Document,
      () => {
        const csrf = { cookieName: "my_csrf", headerName: "x-my-csrf" };
        const headers = csrfMutationHeaders("/api/cases", {
          headers: { "content-type": "application/json" },
          ...csrf,
        });

        assertEquals(headers.get("content-type"), "application/json");
        assertEquals(headers.get("x-my-csrf"), "token-123");
        assertEquals(headers.get("x-csrf-token"), null);

        const requestHeaders = new Headers(headers);
        requestHeaders.set("cookie", "my_csrf=token-123");
        const request = new Request("https://app.example.test/api/cases", {
          method: "POST",
          headers: requestHeaders,
        });

        assertEquals(validateCsrf(request, csrf), true);
      },
    );
  });

  it("rejects invalid configured names instead of silently diverging from the server", () => {
    assertThrows(
      () => csrfMutationHeaders("/api/cases", { cookieName: "bad\r\nname" }),
      TypeError,
    );
    assertThrows(
      () => csrfMutationHeaders("/api/cases", { headerName: "" }),
      TypeError,
    );
  });
});
