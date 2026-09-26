import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  resolveTrustedStudioOrigin,
  studioTargetOriginHelperSource,
} from "./studio-origin-policy.ts";

describe("security/http/studio-origin-policy", () => {
  it("admits only an exact HTTPS Studio origin at the configured platform root", async () => {
    const policy = await import("./studio-origin-policy.ts") as Record<string, unknown>;
    const parseOperatorStudioOrigin = policy.parseOperatorStudioOrigin as
      | ((raw: string, roots: readonly string[]) => string | null)
      | undefined;
    assertEquals(typeof parseOperatorStudioOrigin, "function");
    if (!parseOperatorStudioOrigin) return;
    const root = "verified-0924.127.0.0.1.sslip.io";
    const expected = `https://${root}:58443`;
    assertEquals(parseOperatorStudioOrigin(expected, [root]), expected);
    for (
      const value of [
        `http://${root}:58443`,
        `https://app.preview.${root}:58443`,
        `https://${root}.evil.example:58443`,
        `https://*.${root}:58443`,
        `https://${root}:58443/path`,
        `https://${root}:58443?x=1`,
        `https://user@${root}:58443`,
        `https://${root}:58443; frame-ancestors *`,
      ]
    ) {
      let refused = false;
      try {
        parseOperatorStudioOrigin(value, [root]);
      } catch {
        refused = true;
      }
      assertEquals(refused, true, value);
    }
  });

  it("accepts only the exact HTTPS hosted Studio origins", () => {
    assertEquals(resolveTrustedStudioOrigin("https://veryfront.com"), "https://veryfront.com");
    assertEquals(resolveTrustedStudioOrigin("https://veryfront.org"), "https://veryfront.org");
  });

  it("rejects tenant, insecure, and non-default-port hosted origins", () => {
    assertEquals(resolveTrustedStudioOrigin("https://project.preview.veryfront.com"), null);
    assertEquals(resolveTrustedStudioOrigin("https://project.production.veryfront.org"), null);
    // studio.* subdomains are not deployed and are no longer trusted origins.
    assertEquals(resolveTrustedStudioOrigin("https://studio.veryfront.com"), null);
    assertEquals(resolveTrustedStudioOrigin("https://studio.veryfront.org"), null);
    assertEquals(resolveTrustedStudioOrigin("http://studio.veryfront.com"), null);
    assertEquals(resolveTrustedStudioOrigin("https://studio.veryfront.com:8443"), null);
  });

  it("preserves localhost web origins for local Studio development", () => {
    assertEquals(resolveTrustedStudioOrigin("http://localhost:3000"), "http://localhost:3000");
    assertEquals(resolveTrustedStudioOrigin("https://localhost:3443"), "https://localhost:3443");
    assertEquals(resolveTrustedStudioOrigin("ftp://localhost:3000"), null);
    assertEquals(resolveTrustedStudioOrigin("http://127.0.0.1:3000"), null);
    assertEquals(
      resolveTrustedStudioOrigin("https://localhost.attacker.com"),
      null,
      "a hostname that merely starts with localhost must not be trusted",
    );
    assertEquals(
      resolveTrustedStudioOrigin("https://evil-localhost.com"),
      null,
      "a hostname that merely contains localhost must not be trusted",
    );
    assertEquals(
      resolveTrustedStudioOrigin("https://attacker.localhost"),
      null,
      "localhost subdomains are not trusted Studio origins",
    );
  });

  it("generates a helper from the exact hosted-origin policy", () => {
    const source = studioTargetOriginHelperSource();
    assertEquals(source.includes('"https://veryfront.com"'), true);
    assertEquals(source.includes('"https://studio.veryfront.com"'), false);
    assertEquals(source.includes("endsWith"), false);

    const resolveTarget = new Function(
      "document",
      "window",
      `${source}\nreturn vfStudioTargetOrigin();`,
    ) as (document: { referrer: string }, window: { location: { origin: string } }) => string;
    const window = { location: { origin: "https://project.preview.veryfront.org" } };

    assertEquals(
      resolveTarget({ referrer: "https://veryfront.com/project" }, window),
      "https://veryfront.com",
    );
    assertEquals(
      resolveTarget({ referrer: "https://attacker.preview.veryfront.org/project" }, window),
      window.location.origin,
    );
    assertEquals(
      resolveTarget({ referrer: "https://localhost.attacker.com/project" }, window),
      window.location.origin,
      "the generated helper must match the localhost hostname exactly, never by prefix",
    );
  });

  it("generates an error-overlay target helper with one exact operator origin", () => {
    const origin = "https://verified-0924.127.0.0.1.sslip.io:58443";
    const source = studioTargetOriginHelperSource(origin);
    const resolveTarget = new Function(
      "document",
      "window",
      `${source}\nreturn vfStudioTargetOrigin();`,
    ) as (document: { referrer: string }, window: { location: { origin: string } }) => string;
    const window = { location: { origin: "https://app.preview.example.test" } };
    assertEquals(resolveTarget({ referrer: `${origin}/project` }, window), origin);
    assertEquals(
      resolveTarget({ referrer: "https://other.127.0.0.1.sslip.io:58443/project" }, window),
      window.location.origin,
    );
  });
});
