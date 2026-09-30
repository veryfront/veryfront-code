import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ExecutorHttpInstall } from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import {
  createExecutorHttpConfigurationOperation,
  readExecutorHttpApplicationConfiguration,
  snapshotExecutorHttpApplicationConfiguration,
} from "./application-configuration.ts";

const binding = { allocationId: "allocation", invocationId: "invocation", generation: 2 };
const installation: ExecutorHttpInstall = {
  version: 1,
  mode: "http",
  root: "project",
  binding,
  owner: { scopeKind: "project", projectId: "project-one" },
  source: { type: "release", releaseId: "release-one" },
  environmentId: "environment-one",
  configurationId: "config-one",
};
const configuration = {
  projectId: "project-one",
  projectSlug: "project-one",
  releaseId: "release-one",
  environmentId: "environment-one",
  environmentName: "staging",
  configurationId: "config-one",
  variables: { APP_VALUE: "original" },
};
const context = () => ({
  binding,
  signal: new AbortController().signal,
  deadline: Date.now() + 10_000,
});

describe("allocation-bound application configuration", () => {
  it("streams a bounded large snapshot without putting the entire environment in one frame", async () => {
    const value = "streamed-😀\n".repeat(12_000);
    const snapshot = snapshotExecutorHttpApplicationConfiguration({
      ...configuration,
      variables: { APP_VALUE: value },
    }, installation);
    const operation = createExecutorHttpConfigurationOperation(binding, snapshot);
    assert(operation.mode === "stream");
    let chunks = 0;
    const result = await readExecutorHttpApplicationConfiguration(
      {
        async *stream(name, request) {
          assertEquals(name, "http.configuration");
          for await (const chunk of operation.handle(request, context())) {
            chunks++;
            assert(JSON.stringify(chunk).length < 256 * 1024);
            yield chunk;
          }
        },
      },
      installation,
      new AbortController().signal,
      10_000,
    );
    assert(chunks > 1);
    assertEquals(result.variables.APP_VALUE, value);
  });

  it("does not retain mutable caller configuration or binding objects", async () => {
    const source = { ...configuration, variables: { ...configuration.variables } };
    const generation = { ...binding };
    const operation = createExecutorHttpConfigurationOperation(
      generation,
      snapshotExecutorHttpApplicationConfiguration(source, installation),
    );
    assert(operation.mode === "stream");
    source.variables.APP_VALUE = "changed";
    generation.generation = 99;
    const result = await readExecutorHttpApplicationConfiguration(
      {
        async *stream(_name, request) {
          yield* operation.handle(request, context());
        },
      },
      installation,
      new AbortController().signal,
      10_000,
    );
    assertEquals(result.variables.APP_VALUE, "original");
  });

  it("refuses other configuration IDs, generations and expired requests", async () => {
    const operation = createExecutorHttpConfigurationOperation(binding, configuration);
    assert(operation.mode === "stream");
    for (
      const [request, invocation] of [
        [{ configurationId: "other" }, context()],
        [{ configurationId: "config-one" }, {
          ...context(),
          binding: { ...binding, generation: 3 },
        }],
        [{ configurationId: "config-one" }, {
          ...context(),
          binding: { ...binding, allocationId: "foreign" },
        }],
        [{ configurationId: "config-one" }, {
          ...context(),
          binding: { ...binding, invocationId: "foreign" },
        }],
        [{ configurationId: "config-one" }, { ...context(), deadline: 0 }],
      ] as const
    ) {
      await assertRejects(() => Array.fromAsync(operation.handle(request, invocation)));
    }
  });

  it("refuses malformed, reordered and oversized streams without exposing input in errors", async () => {
    const invalid: JsonValue[][] = [
      [],
      [{ index: 1, text: "{}" }],
      [{ index: 0, text: "synthetic-private-text" }],
      [{ index: 0, text: "x".repeat(32 * 1024 + 1) }],
      Array.from({ length: 129 }, (_, index) => ({ index, text: "x".repeat(32 * 1024) })),
    ];
    for (const values of invalid) {
      const error = await assertRejects(() =>
        readExecutorHttpApplicationConfiguration(
          {
            async *stream() {
              yield* values;
            },
          },
          installation,
          new AbortController().signal,
          10_000,
        )
      );
      assert(error instanceof Error);
      assert(!error.message.includes("synthetic-private-text"));
    }
  });
});
