import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgentRunDiscoveryModuleImporter } from "./agent-run-discovery-module-loader.ts";

interface WorkerResult {
  allowed: string[];
  missingError: string;
  workerCanary: boolean;
}

describe("security/sandbox/agent-run-discovery-module-loader", () => {
  it("refuses to create a project module importer in the host realm", () => {
    assertThrows(
      () => createAgentRunDiscoveryModuleImporter([]),
      TypeError,
      "dedicated Worker",
    );
  });

  it("loads only exact compiled-map modules inside a Worker", async () => {
    delete (globalThis as Record<string, unknown>).__agent_module_worker_canary__;
    const loaderUrl = import.meta.resolve("./agent-run-discovery-module-loader.ts");
    const workerSource = `
      import { createAgentRunDiscoveryModuleImporter } from ${JSON.stringify(loaderUrl)};
      self.onmessage = async (event) => {
        const importer = createAgentRunDiscoveryModuleImporter(event.data);
        const context = { baseDir: "", fsAdapter: {} };
        const allowed = await importer("file://agents/allowed.ts", context);
        let missingError = "";
        try {
          await importer("file://agents/missing.ts", context);
        } catch (error) {
          missingError = error.message;
        }
        self.postMessage({
          allowed: Object.keys(allowed),
          missingError,
          workerCanary: globalThis.__agent_module_worker_canary__ === true,
        });
      };
    `;
    const workerUrl = URL.createObjectURL(
      new Blob([workerSource], { type: "text/javascript" }),
    );
    const worker = new Worker(workerUrl, { type: "module" });
    try {
      const result = await new Promise<WorkerResult>((resolve, reject) => {
        worker.onmessage = (event) => resolve(event.data as WorkerResult);
        worker.onerror = (event) => {
          event.preventDefault();
          reject(event.error ?? new Error(event.message));
        };
        worker.postMessage([{
          concepts: ["agent"],
          sourcePath: "agents/allowed.ts",
          moduleCode:
            "globalThis.__agent_module_worker_canary__ = true; export const allowed = true;",
        }]);
      });

      assertEquals(result.allowed, ["allowed"]);
      assertEquals(result.workerCanary, true);
      assertEquals(result.missingError.includes("immutable compiled map"), true);
      assertEquals(
        (globalThis as Record<string, unknown>).__agent_module_worker_canary__,
        undefined,
      );
    } finally {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    }
  });
});
