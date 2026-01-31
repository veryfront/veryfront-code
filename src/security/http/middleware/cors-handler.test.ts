import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { setCors } from "./cors-handler.ts";

function createHeadersAndRequest(origin?: string): { headers: Headers; req: Request } {
  const headers = new Headers();
  const req = new Request(
    "http://localhost/",
    origin ? { headers: { Origin: origin } } : undefined,
  );
  return { headers, req };
}

describe("security/http/middleware/cors-handler", () => {
  describe("setCors", () => {
    it("should not set headers when securityConfig is null", () => {
      const { headers, req } = createHeadersAndRequest("http://example.com");
      setCors(headers, req, null);
      assertEquals(headers.has("Access-Control-Allow-Origin"), false);
    });

    it("should not set headers when cors is undefined", () => {
      const { headers, req } = createHeadersAndRequest("http://example.com");
      setCors(headers, req, {});
      assertEquals(headers.has("Access-Control-Allow-Origin"), false);
    });

    it("should set wildcard origin when cors is true and no Origin header", () => {
      const { headers, req } = createHeadersAndRequest();
      setCors(headers, req, { cors: true });
      assertEquals(headers.get("Access-Control-Allow-Origin"), "*");
    });

    it("should reflect origin when cors is true and Origin header present", () => {
      const { headers, req } = createHeadersAndRequest("http://example.com");
      setCors(headers, req, { cors: true });
      assertEquals(headers.get("Access-Control-Allow-Origin"), "http://example.com");
    });

    it("should set Vary: Origin for non-wildcard origins", () => {
      const { headers, req } = createHeadersAndRequest("http://example.com");
      setCors(headers, req, { cors: true });
      assertEquals(headers.get("Vary"), "Origin");
    });

    it("should not set Vary for wildcard origin", () => {
      const { headers, req } = createHeadersAndRequest();
      setCors(headers, req, { cors: true });
      assertEquals(headers.has("Vary"), false);
    });

    it("should set matching origin from cors config string", () => {
      const { headers, req } = createHeadersAndRequest("http://example.com");
      setCors(headers, req, { cors: { origin: "http://example.com" } });
      assertEquals(headers.get("Access-Control-Allow-Origin"), "http://example.com");
    });

    it("should not set origin when cors config string does not match", () => {
      const { headers, req } = createHeadersAndRequest("http://evil.com");
      setCors(headers, req, { cors: { origin: "http://example.com" } });
      assertEquals(headers.has("Access-Control-Allow-Origin"), false);
    });

    it("should set wildcard when cors config origin is *", () => {
      const { headers, req } = createHeadersAndRequest("http://example.com");
      setCors(headers, req, { cors: { origin: "*" } });
      assertEquals(headers.get("Access-Control-Allow-Origin"), "*");
    });
  });
});
