import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { clearImportMapCache } from "#veryfront/modules/import-map/index.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { HandlerContext } from "../../types.ts";
import { resolveRequestModuleImportMapIdentity } from "./import-map-identity.ts";

function createContext(
  config: VeryfrontConfig | undefined,
  adapter = createMockAdapter(),
): HandlerContext {
  return {
    projectDir: "/project",
    adapter,
    securityConfig: null,
    cspUserHeader: null,
    config,
    projectSlug: "project",
    projectId: "project-id",
    releaseId: undefined,
    resolvedEnvironment: "preview",
    requestContext: {
      token: "request-token",
      tokenSource: "request-header",
      tokenProvenance: "project-bound",
      slug: "project",
      branch: "main",
      mode: "preview",
    },
    isLocalProject: false,
  };
}

describe("module request import-map identity", () => {
  it("derives distinct identities from the exact validated request configs", async () => {
    clearImportMapCache("project-id");
    const adapter = createMockAdapter();
    let ambientConfigProbes = 0;
    const isAmbientConfigPath = (path: string) => /veryfront\.config/.test(path);
    const originalReadFile = adapter.fs.readFile.bind(adapter.fs);
    const originalExists = adapter.fs.exists.bind(adapter.fs);
    const originalStat = adapter.fs.stat.bind(adapter.fs);
    adapter.fs.readFile = (path) => {
      if (isAmbientConfigPath(path)) ambientConfigProbes++;
      return originalReadFile(path);
    };
    adapter.fs.exists = (path) => {
      if (isAmbientConfigPath(path)) ambientConfigProbes++;
      return originalExists(path);
    };
    adapter.fs.stat = (path) => {
      if (isAmbientConfigPath(path)) ambientConfigProbes++;
      return originalStat(path);
    };
    const config = (target: string) =>
      ({
        resolve: {
          importMap: {
            imports: { package: target },
            scopes: {},
          },
        },
      }) as VeryfrontConfig;

    const mapA = await resolveRequestModuleImportMapIdentity(
      createContext(config("node:fs"), adapter),
    );
    const mapB = await resolveRequestModuleImportMapIdentity(
      createContext(config("node:path"), adapter),
    );

    assertEquals(mapA?.importMap.imports?.package, "node:fs");
    assertEquals(mapB?.importMap.imports?.package, "node:path");
    assertEquals(mapA?.fingerprint === mapB?.fingerprint, false);
    assertEquals(ambientConfigProbes, 0);
  });

  it("fails closed when a hosted request has no validated config", async () => {
    await assertRejects(
      () => resolveRequestModuleImportMapIdentity(createContext(undefined)),
      Error,
      "missing validated request configuration",
    );
  });

  it("preserves the standalone local ambient fallback", async () => {
    const context = createContext(undefined);
    context.isLocalProject = true;
    assertEquals(await resolveRequestModuleImportMapIdentity(context), undefined);
  });
});
