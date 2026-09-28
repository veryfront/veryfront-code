import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ProjectTraceRegistry } from "#veryfront/observability/tracing/project-trace-registry.ts";
import type { ProjectTraceConfig } from "#veryfront/server/project-env/telemetry-config.ts";

function config(projectId: string, revision = "one"): ProjectTraceConfig {
  return {
    projectId,
    environmentId: "production",
    revision,
    endpoint: "https://collector.example/v1/traces",
    headers: {},
    serviceName: projectId,
    serviceVersion: "",
    deploymentEnvironment: "production",
  };
}

describe("project trace registry collection ownership", () => {
  it("keeps registry entries private when shared Map and Set methods are replaced", async () => {
    const registry = new ProjectTraceRegistry(() =>
      Promise.resolve({
        shutdown: () => Promise.resolve(),
      })
    );
    const first = await registry.acquire(config("a"));
    first?.release();
    const get = Map.prototype.get;
    const add = Set.prototype.add;
    let exposed = 0;
    try {
      Map.prototype.get = function (key) {
        const value = Reflect.apply(get, this, [key]);
        if (value?.revision && value?.ready) exposed++;
        return value;
      };
      Set.prototype.add = function (value) {
        if (value?.revision && value?.ready) exposed++;
        return Reflect.apply(add, this, [value]);
      };
      registry.tryAcquire(config("a"))?.release();
      const second = await registry.acquire(config("b"));
      second?.release();
      await registry.disable("a", "production");
      await registry.flush(() => Promise.resolve());
      await registry.shutdown();
    } finally {
      Map.prototype.get = get;
      Set.prototype.add = add;
      await registry.shutdown();
    }
    assertEquals(exposed, 0);
  });
});
