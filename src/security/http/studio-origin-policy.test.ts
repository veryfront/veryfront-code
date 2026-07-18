import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  resolveTrustedStudioOrigin,
  studioTargetOriginHelperSource,
} from "./studio-origin-policy.ts";

describe("security/http/studio-origin-policy", () => {
  it("accepts only the exact HTTPS hosted Studio origins", () => {
    assertEquals(resolveTrustedStudioOrigin("https://veryfront.com"), "https://veryfront.com");
    assertEquals(
      resolveTrustedStudioOrigin("https://studio.veryfront.com"),
      "https://studio.veryfront.com",
    );
    assertEquals(resolveTrustedStudioOrigin("https://veryfront.org"), "https://veryfront.org");
    assertEquals(
      resolveTrustedStudioOrigin("https://studio.veryfront.org"),
      "https://studio.veryfront.org",
    );
  });

  it("rejects tenant, insecure, and non-default-port hosted origins", () => {
    assertEquals(resolveTrustedStudioOrigin("https://project.preview.veryfront.com"), null);
    assertEquals(resolveTrustedStudioOrigin("https://project.production.veryfront.org"), null);
    assertEquals(resolveTrustedStudioOrigin("https://studio.veryfront.dev"), null);
    assertEquals(resolveTrustedStudioOrigin("http://studio.veryfront.com"), null);
    assertEquals(resolveTrustedStudioOrigin("https://studio.veryfront.com:8443"), null);
  });

  it("preserves localhost web origins for local Studio development", () => {
    assertEquals(resolveTrustedStudioOrigin("http://localhost:3000"), "http://localhost:3000");
    assertEquals(resolveTrustedStudioOrigin("https://localhost:3443"), "https://localhost:3443");
    assertEquals(resolveTrustedStudioOrigin("ftp://localhost:3000"), null);
    assertEquals(resolveTrustedStudioOrigin("http://127.0.0.1:3000"), null);
  });

  it("generates a helper from the exact hosted-origin policy", () => {
    const source = studioTargetOriginHelperSource();
    assertEquals(source.includes('"https://studio.veryfront.com"'), true);
    assertEquals(source.includes("endsWith"), false);
    assertEquals(source.includes(".veryfront.dev"), false);

    const resolveTarget = new Function(
      "document",
      "window",
      `${source}\nreturn vfStudioTargetOrigin();`,
    ) as (document: { referrer: string }, window: { location: { origin: string } }) => string;
    const window = { location: { origin: "https://project.preview.veryfront.org" } };

    assertEquals(
      resolveTarget({ referrer: "https://studio.veryfront.com/project" }, window),
      "https://studio.veryfront.com",
    );
    assertEquals(
      resolveTarget({ referrer: "https://attacker.preview.veryfront.org/project" }, window),
      window.location.origin,
    );
  });
});
