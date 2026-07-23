import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ProjectConfigModule } from "./project-config-module.ts";
import { evaluateProjectConfigModuleInWorker } from "./project-config-worker-runtime.ts";

type WorkerResult = {
  agent: {
    agentDirs: string[];
    toolDirs: string[];
    skillDirs: string[];
  };
  styles: {
    stylesheetPath?: string;
    styleProfile: {
      protectedRoots: string[];
      protectedPaths: string[];
    };
  };
  evaluated: boolean;
};

function evaluateInDedicatedWorker(module: ProjectConfigModule): Promise<WorkerResult> {
  const runtimeUrl = import.meta.resolve("./project-config-worker-runtime.ts");
  const workerSource = `
    import {
      createAgentProjectConfigProjection,
      createStyleProjectConfigProjection,
      evaluateProjectConfigModuleInWorker,
    } from ${JSON.stringify(runtimeUrl)};
    self.onmessage = async (event) => {
      const config = await evaluateProjectConfigModuleInWorker(event.data);
      self.postMessage({
        agent: createAgentProjectConfigProjection(config),
        styles: createStyleProjectConfigProjection(config),
        evaluated: globalThis.__projectConfigWasEvaluated === true,
      });
    };
  `;
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  const worker = new Worker(workerUrl, { type: "module" });

  return new Promise<WorkerResult>((resolve, reject) => {
    worker.onmessage = (event) => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      resolve(event.data as WorkerResult);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      reject(event.error ?? new Error(event.message));
    };
    worker.postMessage(module);
  });
}

describe("security/sandbox/project-config-worker-runtime", () => {
  it("reveals custom discovery roots and style fields only after Worker-side evaluation", async () => {
    delete (globalThis as Record<string, unknown>).__projectConfigWasEvaluated;
    const module: ProjectConfigModule = {
      sourcePath: "veryfront.config.js",
      sourceHash: "1".repeat(64),
      moduleCode: [
        "globalThis.__projectConfigWasEvaluated = true;",
        "export default {",
        "  app: 'shell/app.tsx',",
        "  layout: 'shell/layout.tsx',",
        "  directories: { app: 'ui/app', pages: 'ui/pages', components: ['ui/components'] },",
        "  tailwind: { stylesheet: 'styles/project.css' },",
        "  ai: {",
        "    agents: { discovery: { paths: ['custom-agents'] } },",
        "    tools: { discovery: { paths: ['custom-tools'] } },",
        "    skills: { discovery: { paths: ['custom-skills'] } },",
        "  },",
        "};",
      ].join("\n"),
    };

    const result = await evaluateInDedicatedWorker(module);
    assertEquals(result.evaluated, true);
    assertEquals(result.agent.agentDirs, ["custom-agents"]);
    assertEquals(result.agent.toolDirs, ["custom-tools"]);
    assertEquals(result.agent.skillDirs, ["custom-skills"]);
    assertEquals(result.styles.stylesheetPath, "styles/project.css");
    assertEquals(result.styles.styleProfile.protectedRoots.includes("ui/components"), true);
    assertEquals(result.styles.styleProfile.protectedPaths.includes("shell/layout.tsx"), true);
    assertEquals((globalThis as Record<string, unknown>).__projectConfigWasEvaluated, undefined);
  });

  it("refuses to evaluate project config in the host realm", async () => {
    await assertRejects(
      () =>
        evaluateProjectConfigModuleInWorker({
          sourcePath: "veryfront.config.js",
          sourceHash: "1".repeat(64),
          moduleCode: "export default {};",
        }),
      TypeError,
      "dedicated Worker",
    );
  });
});
