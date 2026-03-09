import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it, afterEach } from "#veryfront/testing/bdd.ts";
import {
  extractRequestHeaders,
  resolveProject,
  __injectDepsForTests,
} from "./project-resolution.ts";
import type { ParsedDomain } from "../utils/domain-parser.ts";

const defaultParsedDomain: ParsedDomain = {
  slug: null,
  branch: null,
  environment: null,
  isVeryfrontDomain: false,
  isDraft: false,
  allowIframeEmbed: false,
};

afterEach(() => {
  __injectDepsForTests(null);
});

describe("server/runtime-handler/project-resolution", () => {
  describe("extractRequestHeaders", () => {
    it("should extract all project headers", () => {
      const req = new Request("http://localhost/test", {
        headers: {
          "x-project-slug": "my-project",
          "x-project-id": "proj-123",
          "x-release-id": "rel-456",
          "x-branch-id": "br-789",
          "x-branch-name": "main",
          "x-environment": "preview",
          "x-environment-id": "env-001",
          "x-content-source-id": "cs-001",
          "x-project-path": "/custom/path",
        },
      });
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);

      assertEquals(headers.projectSlug, "my-project");
      assertEquals(headers.projectId, "proj-123");
      assertEquals(headers.releaseId, "rel-456");
      assertEquals(headers.branchId, "br-789");
      assertEquals(headers.branchName, "main");
      assertEquals(headers.environment, "preview");
      assertEquals(headers.environmentId, "env-001");
      assertEquals(headers.contentSourceId, "cs-001");
      assertEquals(headers.projectPath, "/custom/path");
    });

    it("should return undefined for missing headers", () => {
      const req = new Request("http://localhost/test");
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);

      assertEquals(headers.projectSlug, undefined);
      assertEquals(headers.projectId, undefined);
      assertEquals(headers.releaseId, undefined);
      assertEquals(headers.branchId, undefined);
      assertEquals(headers.branchName, undefined);
      assertEquals(headers.environment, undefined);
      assertEquals(headers.environmentId, undefined);
      assertEquals(headers.contentSourceId, undefined);
      assertEquals(headers.projectPath, undefined);
    });

    it("should fallback to x-environment query param", () => {
      const req = new Request("http://localhost/test?x-environment=staging");
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);
      assertEquals(headers.environment, "staging");
    });

    it("should prefer header over query param for x-environment", () => {
      const req = new Request("http://localhost/test?x-environment=staging", {
        headers: { "x-environment": "preview" },
      });
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);
      assertEquals(headers.environment, "preview");
    });

    it("should always set token to undefined", () => {
      const req = new Request("http://localhost/test", {
        headers: { authorization: "Bearer token123" },
      });
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);
      assertEquals(headers.token, undefined);
    });
  });

  describe("resolveProject", () => {
    it("should resolve from request context slug", async () => {
      __injectDepsForTests({
        parseProjectDomain: () => defaultParsedDomain,
        lookupProjectByDomain: async () => null,
        getEnvironmentType: () => undefined,
      });

      const req = new Request("http://localhost/test", {
        headers: { host: "localhost" },
      });
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);

      const result = await resolveProject(req, url, headers, {
        config: undefined,
        reqCtx: { slug: "ctx-slug", mode: "production", branch: null, token: "" },
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        wsSlugOverride: undefined,
      });

      assertEquals(result.projectSlug, "ctx-slug");
    });

    it("should fall back to default slug when no context slug", async () => {
      __injectDepsForTests({
        parseProjectDomain: () => defaultParsedDomain,
        lookupProjectByDomain: async () => null,
        getEnvironmentType: () => undefined,
      });

      const req = new Request("http://localhost/test", {
        headers: { host: "localhost" },
      });
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);

      const result = await resolveProject(req, url, headers, {
        config: undefined,
        reqCtx: { slug: "", mode: "production", branch: null, token: "" },
        defaultProjectSlug: "default-slug",
        defaultProjectId: "default-id",
        wsSlugOverride: undefined,
      });

      assertEquals(result.projectSlug, "default-slug");
      assertEquals(result.projectId, "default-id");
    });

    it("should prefer ws slug override over default", async () => {
      __injectDepsForTests({
        parseProjectDomain: () => defaultParsedDomain,
        lookupProjectByDomain: async () => null,
        getEnvironmentType: () => undefined,
      });

      const req = new Request("http://localhost/test", {
        headers: { host: "localhost" },
      });
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);

      const result = await resolveProject(req, url, headers, {
        config: undefined,
        reqCtx: { slug: "", mode: "production", branch: null, token: "" },
        defaultProjectSlug: "default-slug",
        defaultProjectId: undefined,
        wsSlugOverride: "ws-slug",
      });

      assertEquals(result.projectSlug, "ws-slug");
    });

    it("should use header projectId", async () => {
      __injectDepsForTests({
        parseProjectDomain: () => defaultParsedDomain,
        lookupProjectByDomain: async () => null,
        getEnvironmentType: () => undefined,
      });

      const req = new Request("http://localhost/test", {
        headers: { host: "localhost", "x-project-id": "proj-abc" },
      });
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);

      const result = await resolveProject(req, url, headers, {
        config: undefined,
        reqCtx: { slug: "slug", mode: "production", branch: null, token: "" },
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        wsSlugOverride: undefined,
      });

      assertEquals(result.projectId, "proj-abc");
    });

    it("should use header releaseId", async () => {
      __injectDepsForTests({
        parseProjectDomain: () => defaultParsedDomain,
        lookupProjectByDomain: async () => null,
        getEnvironmentType: () => undefined,
      });

      const req = new Request("http://localhost/test", {
        headers: { host: "localhost", "x-release-id": "rel-xyz" },
      });
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);

      const result = await resolveProject(req, url, headers, {
        config: undefined,
        reqCtx: { slug: "slug", mode: "production", branch: null, token: "" },
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        wsSlugOverride: undefined,
      });

      assertEquals(result.releaseId, "rel-xyz");
    });

    it("should parse proxy environment from x-environment header", async () => {
      __injectDepsForTests({
        parseProjectDomain: () => defaultParsedDomain,
        lookupProjectByDomain: async () => null,
        getEnvironmentType: () => undefined,
      });

      const req = new Request("http://localhost/test", {
        headers: { host: "localhost", "x-environment": "preview" },
      });
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);

      const result = await resolveProject(req, url, headers, {
        config: undefined,
        reqCtx: { slug: "slug", mode: "production", branch: null, token: "" },
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        wsSlugOverride: undefined,
      });

      assertEquals(result.proxyEnv, "preview");
    });

    it("should return parsedDomain in result", async () => {
      const customDomain: ParsedDomain = {
        ...defaultParsedDomain,
        slug: "parsed",
        isVeryfrontDomain: true,
      };

      __injectDepsForTests({
        parseProjectDomain: () => customDomain,
        lookupProjectByDomain: async () => null,
        getEnvironmentType: () => undefined,
      });

      const req = new Request("http://parsed.veryfront.com/test", {
        headers: { host: "parsed.veryfront.com" },
      });
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);

      const result = await resolveProject(req, url, headers, {
        config: undefined,
        reqCtx: { slug: "parsed", mode: "production", branch: null, token: "" },
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        wsSlugOverride: undefined,
      });

      assertEquals(result.parsedDomain, customDomain);
    });

    it("should skip domain lookup for internal hosts", async () => {
      let lookupCalled = false;

      __injectDepsForTests({
        parseProjectDomain: () => defaultParsedDomain,
        lookupProjectByDomain: async () => {
          lookupCalled = true;
          return null;
        },
        getEnvironmentType: () => undefined,
      });

      const req = new Request("http://127.0.0.1/test", {
        headers: { host: "127.0.0.1" },
      });
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);

      await resolveProject(req, url, headers, {
        config: { fs: { veryfront: { apiToken: "token" } } } as any,
        reqCtx: { slug: "", mode: "production", branch: null, token: "" },
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        wsSlugOverride: undefined,
      });

      assertEquals(lookupCalled, false);
    });
  });
});
