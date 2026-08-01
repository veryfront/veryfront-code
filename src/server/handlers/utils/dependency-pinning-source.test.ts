import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { HandlerContext } from "../types.ts";
import {
  createHandlerDependencyPinningSource,
  getHandlerDependencyPinningIdentity,
} from "./dependency-pinning-source.ts";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/project",
    adapter: createMockAdapter(),
    securityConfig: null,
    cspUserHeader: null,
    ...overrides,
  };
}

describe("server/handlers/utils/dependency-pinning-source", () => {
  it("prefers enriched project and content identity", () => {
    const identity = getHandlerDependencyPinningIdentity(
      makeCtx({
        projectId: "context-id",
        projectSlug: "context-slug",
        releaseId: "context-release",
        requestContext: {
          token: "",
          slug: "request-slug",
          branch: "request-branch",
          mode: "preview",
        },
        parsedDomain: { branch: "domain-branch" } as HandlerContext["parsedDomain"],
        enriched: {
          projectId: "enriched-id",
          projectSlug: "enriched-slug",
          contentSourceId: "enriched-content",
          releaseId: "enriched-release",
          branch: "enriched-branch",
        } as HandlerContext["enriched"],
      }),
    );

    assertEquals(identity, {
      projectId: "enriched-id",
      projectSlug: "enriched-slug",
      contentSourceId: "enriched-content",
      releaseId: "enriched-release",
      branch: "enriched-branch",
    });
  });

  it("keeps release and branch separate when enriched content identity is absent", () => {
    const identity = getHandlerDependencyPinningIdentity(
      makeCtx({
        projectId: "context-id",
        releaseId: "context-release",
        requestContext: {
          token: "",
          slug: "request-slug",
          branch: "request-branch",
          mode: "preview",
        },
        parsedDomain: { branch: "domain-branch" } as HandlerContext["parsedDomain"],
      }),
    );

    assertEquals(identity, {
      projectId: "context-id",
      projectSlug: "request-slug",
      contentSourceId: undefined,
      releaseId: "context-release",
      branch: "request-branch",
    });
  });

  it("falls back to the parsed-domain branch", () => {
    const identity = getHandlerDependencyPinningIdentity(
      makeCtx({
        parsedDomain: { branch: "domain-branch" } as HandlerContext["parsedDomain"],
      }),
    );

    assertEquals(identity.branch, "domain-branch");
  });

  it("allows an enriched preview-main content source to write back", () => {
    const source = createHandlerDependencyPinningSource(
      makeCtx({
        isLocalProject: false,
        proxyToken: "request-scoped-token",
        requestContext: {
          token: "",
          slug: "project",
          branch: "main",
          mode: "preview",
        },
        enriched: {
          projectId: "project-id",
          contentSourceId: "preview-main-source",
          branch: "main",
        } as HandlerContext["enriched"],
      }),
    );

    assertEquals(source.contentSourceId, "preview-main-source");
    assertEquals(source.dependencyWritebackTarget, { kind: "main" });
    assertEquals(source.dependencyWritebackToken, "request-scoped-token");
  });

  it("targets preview branches and denies release, production, or unproven sources", () => {
    const feature = createHandlerDependencyPinningSource(
      makeCtx({
        isLocalProject: false,
        requestContext: {
          token: "",
          slug: "project",
          branch: "feature",
          mode: "preview",
        },
      }),
    );
    const release = createHandlerDependencyPinningSource(
      makeCtx({
        isLocalProject: true,
        releaseId: "release-a",
        requestContext: {
          token: "",
          slug: "project",
          branch: "main",
          mode: "preview",
        },
      }),
    );
    const localProduction = createHandlerDependencyPinningSource(
      makeCtx({
        isLocalProject: true,
        requestContext: {
          token: "",
          slug: "project",
          branch: "main",
          mode: "production",
        },
      }),
    );
    const localPreview = createHandlerDependencyPinningSource(
      makeCtx({
        isLocalProject: true,
        requestContext: {
          token: "",
          slug: "project",
          branch: "main",
          mode: "preview",
        },
      }),
    );
    const nonCanonicalBranch = createHandlerDependencyPinningSource(
      makeCtx({
        isLocalProject: false,
        requestContext: {
          token: "",
          slug: "project",
          branch: "main ",
          mode: "preview",
        },
      }),
    );
    const unproven = createHandlerDependencyPinningSource(makeCtx());

    assertEquals(feature.dependencyWritebackTarget, {
      kind: "branch",
      branch: "feature",
    });
    assertEquals(release.dependencyWritebackTarget, undefined);
    assertEquals(localProduction.dependencyWritebackTarget, undefined);
    assertEquals(localPreview.dependencyWritebackTarget, undefined);
    assertEquals(nonCanonicalBranch.dependencyWritebackTarget, undefined);
    assertEquals(unproven.dependencyWritebackTarget, undefined);
  });
});
