import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ResolvedConfig } from "#cli/shared/config";
import type { ParsedArgs } from "#cli/shared/types";
import { mintEnvironmentAccessToken, parseEnvironmentTokenArgs } from "./command.ts";

const config: ResolvedConfig = {
  apiUrl: "https://control.example.test/api",
  apiToken: "test-api-key",
  projectSlug: "configured-project",
};

describe("veryfront env token", () => {
  it("requires an environment name", () => {
    const result = parseEnvironmentTokenArgs({ _: ["env", "token"] } as ParsedArgs);

    assertEquals(result.success, false);
  });

  it("resolves the selected project before exchanging for its environment", async () => {
    const calls: unknown[] = [];

    const credential = await mintEnvironmentAccessToken(
      { environment: "staging", projectReference: "selected-project" },
      {
        resolveConfig: () => Promise.resolve(config),
        createControlPlane: (resolvedConfig) => {
          calls.push({
            kind: "config",
            projectSlug: resolvedConfig.projectSlug,
            projectId: resolvedConfig.projectId,
          });
          return {
            getProject(reference) {
              calls.push({ kind: "project", reference });
              return Promise.resolve({ id: "project-id", slug: "selected-project" });
            },
            createEnvironmentAccessToken(target) {
              calls.push({ kind: "token", target });
              return Promise.resolve({ accessToken: "bound-token", expiresIn: 300 });
            },
          };
        },
      },
    );

    assertEquals(credential, { accessToken: "bound-token", expiresIn: 300 });
    assertEquals(calls, [
      { kind: "config", projectSlug: "selected-project", projectId: undefined },
      { kind: "project", reference: "selected-project" },
      {
        kind: "token",
        target: { projectId: "project-id", environmentName: "staging" },
      },
    ]);
  });

  it("prefers the linked project id when --project is omitted", async () => {
    const projectReferences: string[] = [];

    await mintEnvironmentAccessToken(
      { environment: "production" },
      {
        resolveConfig: () =>
          Promise.resolve({
            ...config,
            projectId: "linked-project-id",
          }),
        createControlPlane: () => ({
          getProject(reference) {
            projectReferences.push(reference);
            return Promise.resolve({ id: "configured-id", slug: reference });
          },
          createEnvironmentAccessToken: () =>
            Promise.resolve({ accessToken: "bound-token", expiresIn: 300 }),
        }),
      },
    );

    assertEquals(projectReferences, ["linked-project-id"]);
  });
});
