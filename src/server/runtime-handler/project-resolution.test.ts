import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __injectDepsForTests,
  extractRequestHeaders,
  resolveProject,
} from "./project-resolution.ts";
import type { DomainLookupResult } from "../utils/domain-lookup.ts";
import type { ParsedDomain } from "#veryfront/types";
import type { VeryfrontConfig } from "#veryfront/config";

const defaultParsedDomain: ParsedDomain = {
  slug: null,
  branch: null,
  environment: null,
  isVeryfrontDomain: false,
  isDraft: false,
  allowIframeEmbed: false,
};

describe("server/runtime-handler/project-resolution", () => {
  describe("extractRequestHeaders", () => {
    it("extracts project slug from header", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-project-slug": "my-project" },
      });
      const headers = extractRequestHeaders(req, new URL(req.url));
      assertEquals(headers.projectSlug, "my-project");
    });

    it("extracts project id from header", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-project-id": "proj-123" },
      });
      const headers = extractRequestHeaders(req, new URL(req.url));
      assertEquals(headers.projectId, "proj-123");
    });

    it("extracts release id from header", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-release-id": "rel-456" },
      });
      const headers = extractRequestHeaders(req, new URL(req.url));
      assertEquals(headers.releaseId, "rel-456");
    });

    it("extracts branch id from header", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-branch-id": "branch-1" },
      });
      const headers = extractRequestHeaders(req, new URL(req.url));
      assertEquals(headers.branchId, "branch-1");
    });

    it("extracts branch name from header", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-branch-name": "feature-x" },
      });
      const headers = extractRequestHeaders(req, new URL(req.url));
      assertEquals(headers.branchName, "feature-x");
    });

    it("extracts environment from header", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-environment": "production" },
      });
      const headers = extractRequestHeaders(req, new URL(req.url));
      assertEquals(headers.environment, "production");
    });

    it("extracts environment from query parameter when header not present", () => {
      const req = new Request("http://localhost/?x-environment=staging");
      const headers = extractRequestHeaders(req, new URL(req.url));
      assertEquals(headers.environment, "staging");
    });

    it("extracts environment-id from header", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-environment-id": "env-1" },
      });
      const headers = extractRequestHeaders(req, new URL(req.url));
      assertEquals(headers.environmentId, "env-1");
    });

    it("extracts content-source-id from header", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-content-source-id": "cs-1" },
      });
      const headers = extractRequestHeaders(req, new URL(req.url));
      assertEquals(headers.contentSourceId, "cs-1");
    });

    it("extracts project-path from header", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-project-path": "/projects/my-proj" },
      });
      const headers = extractRequestHeaders(req, new URL(req.url));
      assertEquals(headers.projectPath, "/projects/my-proj");
    });

    it("returns undefined for missing headers", () => {
      const req = new Request("http://localhost/");
      const headers = extractRequestHeaders(req, new URL(req.url));
      assertEquals(headers.projectSlug, undefined);
      assertEquals(headers.projectId, undefined);
      assertEquals(headers.releaseId, undefined);
      assertEquals(headers.branchId, undefined);
      assertEquals(headers.branchName, undefined);
      assertEquals(headers.environment, undefined);
      assertEquals(headers.environmentId, undefined);
      assertEquals(headers.token, undefined);
      assertEquals(headers.contentSourceId, undefined);
      assertEquals(headers.projectPath, undefined);
    });
  });

  describe("resolveProject", () => {
    it("uses reqCtx.slug as projectSlug when available", async () => {
      __injectDepsForTests({
        parseProjectDomain: () => defaultParsedDomain,
        lookupProjectByDomain: () => Promise.resolve(null),
        getEnvironmentType: () => undefined,
      });

      const req = new Request("http://localhost/");
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);
      const result = await resolveProject(req, url, headers, {
        config: undefined,
        reqCtx: { slug: "from-ctx", mode: undefined, branch: null, token: undefined },
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        wsSlugOverride: undefined,
      });

      assertEquals(result.projectSlug, "from-ctx");
    });

    it("uses wsSlugOverride when reqCtx.slug is empty", async () => {
      __injectDepsForTests({
        parseProjectDomain: () => defaultParsedDomain,
        lookupProjectByDomain: () => Promise.resolve(null),
        getEnvironmentType: () => undefined,
      });

      const req = new Request("http://localhost/");
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);
      const result = await resolveProject(req, url, headers, {
        config: undefined,
        reqCtx: { slug: undefined, mode: undefined, branch: null, token: undefined },
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        wsSlugOverride: "ws-slug",
      });

      assertEquals(result.projectSlug, "ws-slug");
    });

    it("uses defaultProjectSlug when no other slug source", async () => {
      __injectDepsForTests({
        parseProjectDomain: () => defaultParsedDomain,
        lookupProjectByDomain: () => Promise.resolve(null),
        getEnvironmentType: () => undefined,
      });

      const req = new Request("http://localhost/");
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);
      const result = await resolveProject(req, url, headers, {
        config: undefined,
        reqCtx: { slug: undefined, mode: undefined, branch: null, token: undefined },
        defaultProjectSlug: "default-slug",
        defaultProjectId: "default-id",
        wsSlugOverride: undefined,
      });

      assertEquals(result.projectSlug, "default-slug");
      assertEquals(result.projectId, "default-id");
    });

    it("uses configured slug from config", async () => {
      __injectDepsForTests({
        parseProjectDomain: () => defaultParsedDomain,
        lookupProjectByDomain: () => Promise.resolve(null),
        getEnvironmentType: () => undefined,
      });

      const config = {
        fs: { veryfront: { projectSlug: "config-slug" } },
      } as unknown as VeryfrontConfig;

      const req = new Request("http://localhost/");
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);
      const result = await resolveProject(req, url, headers, {
        config,
        reqCtx: { slug: undefined, mode: undefined, branch: null, token: undefined },
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        wsSlugOverride: undefined,
      });

      assertEquals(result.projectSlug, "config-slug");
    });

    it("extracts releaseId from headers", async () => {
      __injectDepsForTests({
        parseProjectDomain: () => defaultParsedDomain,
        lookupProjectByDomain: () => Promise.resolve(null),
        getEnvironmentType: () => undefined,
      });

      const req = new Request("http://localhost/", {
        headers: { "x-release-id": "rel-1" },
      });
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);
      const result = await resolveProject(req, url, headers, {
        config: undefined,
        reqCtx: { slug: "test", mode: undefined, branch: null, token: undefined },
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        wsSlugOverride: undefined,
      });

      assertEquals(result.releaseId, "rel-1");
    });

    it("performs custom domain lookup when conditions are met", async () => {
      const lookupResult: DomainLookupResult = {
        project_id: "proj-1",
        project_slug: "looked-up-slug",
        project_name: "Looked Up",
        environment: { id: "env-1", name: "Production" },
        release_id: "rel-99",
      };

      __injectDepsForTests({
        parseProjectDomain: () => defaultParsedDomain,
        lookupProjectByDomain: () => Promise.resolve(lookupResult),
        getEnvironmentType: () => "production" as const,
      });

      const config = {
        fs: { veryfront: { apiToken: "test-token", apiBaseUrl: "https://api.test.com" } },
      } as unknown as VeryfrontConfig;

      const req = new Request("http://custom-domain.example.com/");
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);
      const result = await resolveProject(req, url, headers, {
        config,
        reqCtx: { slug: undefined, mode: undefined, branch: null, token: undefined },
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        wsSlugOverride: undefined,
      });

      assertEquals(result.projectSlug, "looked-up-slug");
      assertEquals(result.projectId, "proj-1");
      assertEquals(result.releaseId, "rel-99");
      assertEquals(result.proxyEnv, "production");
    });

    it("uses x-forwarded-host for domain resolution", async () => {
      let capturedHost = "";
      __injectDepsForTests({
        parseProjectDomain: (host: string) => {
          capturedHost = host;
          return defaultParsedDomain;
        },
        lookupProjectByDomain: () => Promise.resolve(null),
        getEnvironmentType: () => undefined,
      });

      const req = new Request("http://localhost/", {
        headers: { "x-forwarded-host": "forwarded.example.com" },
      });
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);
      await resolveProject(req, url, headers, {
        config: undefined,
        reqCtx: { slug: "s", mode: undefined, branch: null, token: undefined },
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        wsSlugOverride: undefined,
      });

      assertEquals(capturedHost, "forwarded.example.com");
    });

    it("returns parsedDomain in result", async () => {
      __injectDepsForTests({
        parseProjectDomain: () => ({
          ...defaultParsedDomain,
          slug: "my-project",
          isVeryfrontDomain: true,
        }),
        lookupProjectByDomain: () => Promise.resolve(null),
        getEnvironmentType: () => undefined,
      });

      const req = new Request("http://my-project.preview.veryfront.dev/");
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url);
      const result = await resolveProject(req, url, headers, {
        config: undefined,
        reqCtx: { slug: "my-project", mode: undefined, branch: null, token: undefined },
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        wsSlugOverride: undefined,
      });

      assertEquals(result.parsedDomain.isVeryfrontDomain, true);
      assertEquals(result.parsedDomain.slug, "my-project");
    });
  });
});
