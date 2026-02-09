import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { resolveServerBaseUrl, VALID_HOSTNAME_RE } from "./server-url.ts";

const FALLBACK = "http://shared-server:3001";

describe("VALID_HOSTNAME_RE", () => {
  it("accepts simple hostnames", () => {
    assertEquals(VALID_HOSTNAME_RE.test("my-server"), true);
    assertEquals(VALID_HOSTNAME_RE.test("server1"), true);
    assertEquals(VALID_HOSTNAME_RE.test("a"), true);
  });

  it("accepts K8s internal DNS names", () => {
    assertEquals(
      VALID_HOSTNAME_RE.test(
        "veryfront-server-2847395106.veryfront-production.svc.cluster.local",
      ),
      true,
    );
  });

  it("accepts hostname with port", () => {
    assertEquals(VALID_HOSTNAME_RE.test("server:3001"), true);
    assertEquals(VALID_HOSTNAME_RE.test("my-server.local:8080"), true);
  });

  it("rejects URLs with protocol", () => {
    assertEquals(VALID_HOSTNAME_RE.test("http://evil.com"), false);
    assertEquals(VALID_HOSTNAME_RE.test("https://evil.com"), false);
  });

  it("rejects hostnames with paths", () => {
    assertEquals(VALID_HOSTNAME_RE.test("server/admin"), false);
    assertEquals(VALID_HOSTNAME_RE.test("server:3001/path"), false);
  });

  it("rejects hostnames with user-info", () => {
    assertEquals(VALID_HOSTNAME_RE.test("user@server"), false);
    assertEquals(VALID_HOSTNAME_RE.test("user:pass@server"), false);
  });

  it("rejects empty string", () => {
    assertEquals(VALID_HOSTNAME_RE.test(""), false);
  });

  it("rejects hostnames starting or ending with hyphen/dot", () => {
    assertEquals(VALID_HOSTNAME_RE.test("-server"), false);
    assertEquals(VALID_HOSTNAME_RE.test(".server"), false);
    assertEquals(VALID_HOSTNAME_RE.test("server-"), false);
    assertEquals(VALID_HOSTNAME_RE.test("server."), false);
  });

  it("rejects hostnames with spaces", () => {
    assertEquals(VALID_HOSTNAME_RE.test("server name"), false);
  });

  it("rejects port-only values", () => {
    assertEquals(VALID_HOSTNAME_RE.test(":3001"), false);
  });
});

describe("resolveServerBaseUrl", () => {
  it("returns http URL for valid hostname", () => {
    assertEquals(
      resolveServerBaseUrl("my-server.local", FALLBACK),
      "http://my-server.local",
    );
  });

  it("returns http URL for valid K8s hostname", () => {
    assertEquals(
      resolveServerBaseUrl(
        "veryfront-server-2847395106.veryfront-production.svc.cluster.local",
        FALLBACK,
      ),
      "http://veryfront-server-2847395106.veryfront-production.svc.cluster.local",
    );
  });

  it("returns http URL for hostname with port", () => {
    assertEquals(
      resolveServerBaseUrl("server:3001", FALLBACK),
      "http://server:3001",
    );
  });

  it("returns fallback when hostname is undefined", () => {
    assertEquals(resolveServerBaseUrl(undefined, FALLBACK), FALLBACK);
  });

  it("returns fallback when hostname is empty string", () => {
    assertEquals(resolveServerBaseUrl("", FALLBACK), FALLBACK);
  });

  it("returns fallback for invalid hostname (protocol)", () => {
    assertEquals(
      resolveServerBaseUrl("http://evil.com", FALLBACK),
      FALLBACK,
    );
  });

  it("returns fallback for invalid hostname (path)", () => {
    assertEquals(
      resolveServerBaseUrl("server/admin", FALLBACK),
      FALLBACK,
    );
  });

  it("returns fallback for invalid hostname (user-info)", () => {
    assertEquals(
      resolveServerBaseUrl("user@server", FALLBACK),
      FALLBACK,
    );
  });

  it("calls onInvalid callback for invalid hostname", () => {
    const warnings: string[] = [];
    resolveServerBaseUrl("http://evil.com", FALLBACK, (h) => warnings.push(h));
    assertEquals(warnings, ["http://evil.com"]);
  });

  it("does not call onInvalid for undefined hostname", () => {
    const warnings: string[] = [];
    resolveServerBaseUrl(undefined, FALLBACK, (h) => warnings.push(h));
    assertEquals(warnings, []);
  });

  it("does not call onInvalid for valid hostname", () => {
    const warnings: string[] = [];
    resolveServerBaseUrl("valid-server", FALLBACK, (h) => warnings.push(h));
    assertEquals(warnings, []);
  });

  it("derives https protocol from fallback URL", () => {
    assertEquals(
      resolveServerBaseUrl("my-server.local", "https://shared-server:3001"),
      "https://my-server.local",
    );
  });

  it("derives http protocol from fallback URL", () => {
    assertEquals(
      resolveServerBaseUrl("my-server.local", "http://shared-server:3001"),
      "http://my-server.local",
    );
  });
});
