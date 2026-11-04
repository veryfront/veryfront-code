import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isIntegrationToolAllowedBySourcePolicy } from "#veryfront/integrations/source-policy.ts";
import { resolveStudioOrigin } from "#veryfront/integrations/studio-origin.ts";
import { formatUnconnectedIntegrationMessage } from "#veryfront/integrations/unconnected.ts";

describe("integrations/connection diagnostics", () => {
  it("does not infer a Studio from a project-replaced URL parser", () => {
    const OriginalURL = globalThis.URL;
    const hostname = Object.getOwnPropertyDescriptor(OriginalURL.prototype, "hostname")!;
    let unknown: string | undefined;
    let known: string | undefined;
    try {
      Object.defineProperty(OriginalURL.prototype, "hostname", {
        configurable: true,
        get: () => "api.veryfront.org",
      });
      globalThis.URL = class extends OriginalURL {
        constructor(_input: string | URL, _base?: string | URL) {
          super("https://api.veryfront.org");
        }
      };
      unknown = resolveStudioOrigin("https://custom-api.example");
      known = resolveStudioOrigin("https://api.veryfront.com");
    } finally {
      globalThis.URL = OriginalURL;
      Object.defineProperty(OriginalURL.prototype, "hostname", hostname);
    }
    assertEquals(unknown, undefined);
    assertEquals(known, "https://veryfront.com");
  });

  it("does not dispatch through built-ins that project code replaced", () => {
    const arrayIncludes = Array.prototype.includes;
    const stringIncludes = String.prototype.includes;
    const stringReplace = String.prototype.replace;
    const fail = () => {
      throw new Error("project replacement");
    };
    let studioOrigin: string | undefined;
    let message: string | undefined;
    let allowed: boolean[] = [];
    try {
      Array.prototype.includes = fail;
      String.prototype.includes = fail;
      String.prototype.replace = fail;
      studioOrigin = resolveStudioOrigin("http://localhost:3001");
      message = formatUnconnectedIntegrationMessage("salesforce", {
        projectSlug: "case-demo",
        studioOrigin: "https://veryfront.org/",
      });
      const policy = {
        schemaVersion: 1,
        mode: "allowlist",
        integrations: { github: { allowedToolIds: ["list_repos"] } },
      } as const;
      allowed = [
        isIntegrationToolAllowedBySourcePolicy("github__list_repos", policy),
        isIntegrationToolAllowedBySourcePolicy("github__delete_repo", policy),
        isIntegrationToolAllowedBySourcePolicy("plain_tool", policy),
        isIntegrationToolAllowedBySourcePolicy("not__canonical__name", policy),
      ];
    } finally {
      Array.prototype.includes = arrayIncludes;
      String.prototype.includes = stringIncludes;
      String.prototype.replace = stringReplace;
    }

    assertEquals(studioOrigin, "http://localhost:3000");
    assertEquals(
      message,
      [
        "Salesforce isn't connected to project case-demo.",
        "Connect it: npx veryfront integration connect salesforce --project case-demo",
        "Or in Studio: https://veryfront.org/projects/case-demo/integrations",
      ].join("\n"),
    );
    assertEquals(allowed, [true, false, true, false]);
  });
});
