import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing";
import { createExecutorHttpApplicationRuntime } from "./application-runtime.ts";
import type { ExecutorHttpInstall } from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";

const installation: ExecutorHttpInstall = {
  version: 1,
  mode: "http",
  root: "project",
  owner: { scopeKind: "project", projectId: "project-one" },
  source: { type: "release", releaseId: "release-one" },
  binding: { allocationId: "allocation-one", invocationId: "invocation-one", generation: 1 },
  environmentId: "environment-one",
  configurationId: "configuration-one",
};
const configuration = {
  projectId: "project-one",
  projectSlug: "project-one",
  releaseId: "release-one",
  environmentId: "environment-one",
  environmentName: "staging",
  configurationId: "configuration-one",
  variables: {},
};

describe("installed HTTP application admission", () => {
  for (const key of ["projectId", "releaseId", "environmentId", "configurationId"] as const) {
    it(`refuses mismatched ${key} before inspecting the project root`, async () => {
      let rootAccesses = 0;
      await assertRejects(
        () =>
          createExecutorHttpApplicationRuntime({
            installation,
            configuration: { ...configuration, [key]: "foreign" },
            signal: new AbortController().signal,
            get projectDir(): string {
              rootAccesses++;
              throw new Error("Must not inspect unbound source");
            },
          }),
        TypeError,
        "Application configuration does not match its installation",
      );
      assertEquals(rootAccesses, 0);
    });
  }

  it("refuses an environment-source name that differs from the configuration", async () => {
    await assertRejects(
      () =>
        createExecutorHttpApplicationRuntime({
          installation: {
            ...installation,
            source: { type: "environment", releaseId: "release-one", environmentName: "other" },
          },
          configuration,
          signal: new AbortController().signal,
          projectDir: "/synthetic/project",
        }),
      TypeError,
      "Application configuration does not match its installation",
    );
  });

  it("rejects configuration accessors without invoking them", async () => {
    let calls = 0;
    const input = { ...configuration };
    Object.defineProperty(input, "projectId", {
      enumerable: true,
      get() {
        calls++;
        return "project-one";
      },
    });
    await assertRejects(
      () =>
        createExecutorHttpApplicationRuntime({
          installation,
          configuration: input,
          signal: new AbortController().signal,
          projectDir: "/synthetic/project",
        }),
      TypeError,
      "Invalid application configuration",
    );
    assertEquals(calls, 0);
  });

  it("refuses collector settings before application loading", async () => {
    await assertRejects(
      () =>
        createExecutorHttpApplicationRuntime({
          installation,
          configuration: {
            ...configuration,
            variables: { OTEL_EXPORTER_OTLP_HEADERS: "synthetic-private-value" },
          },
          signal: new AbortController().signal,
          projectDir: "/synthetic/project",
        }),
      TypeError,
      "Application environment contains host-managed telemetry settings",
    );
  });

  it("rejects oversized environments before application loading", async () => {
    await assertRejects(() =>
      createExecutorHttpApplicationRuntime({
        installation,
        configuration: {
          ...configuration,
          variables: Object.fromEntries(
            Array.from({ length: 129 }, (_, i) => [`APP_${i}`, "value"]),
          ),
        },
        signal: new AbortController().signal,
        projectDir: "/synthetic/project",
      })
    );
  });

  it("refuses shared proxy hosts even when their execution override is enabled", async () => {
    await withEnv({ PROXY_MODE: "1", VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION: "1" }, async () => {
      await assertRejects(
        () =>
          createExecutorHttpApplicationRuntime({
            installation,
            configuration,
            signal: new AbortController().signal,
            projectDir: "/synthetic/project",
          }),
        TypeError,
        "Installed application factories cannot run in proxy hosts",
      );
    });
  });

  it("rejects an aborted installation before application loading", async () => {
    const lifetime = new AbortController();
    lifetime.abort(new Error("Synthetic installation shutdown"));
    await assertRejects(
      () =>
        createExecutorHttpApplicationRuntime({
          installation,
          configuration,
          signal: lifetime.signal,
          projectDir: "/synthetic/project",
        }),
      Error,
      "Synthetic installation shutdown",
    );
  });
});
