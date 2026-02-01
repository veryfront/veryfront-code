import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { ensureDir } from "#std/fs";
import { describe, it } from "#veryfront/testing/bdd";
import { writeTextFile } from "#veryfront/compat/fs.ts";
import type { DevCommandOptions } from "../../../../src/cli/commands/dev.ts";
import { clearConfigCache } from "#veryfront/config";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { delay } from "#std/async";
import { scaleMs } from "#veryfront/testing";

function createMockDevCommand(): (options: { signal?: AbortSignal } & any) => Promise<void> {
  return async (options: { signal?: AbortSignal } & any): Promise<void> => {
    const { port = 3002, projectDir, signal } = options;

    console.log("Starting development server...");

    const adapter = await (await import("#veryfront/platform/adapters/detect.ts")).getAdapter();
    const config = await (await import("#veryfront/config/loader.ts")).getConfig(projectDir, adapter);

    const finalPort = config?.dev?.port || port;

    console.log(`📁 Project: ${projectDir}`);
    console.log(`🌐 Port: ${finalPort}`);
    console.log(`⚡ HMR: enabled`);
    console.log(`🧧 Client routing: enabled`);
    console.log(`🔮 Prefetching: enabled`);

    if (signal?.aborted) return;

    await new Promise<void>((resolve) => {
      const cleanup = () => resolve();
      signal?.addEventListener("abort", cleanup);

      if (!signal) {
        setTimeout(resolve, scaleMs(100));
      }
    });
  };
}

const devCommand: any = createMockDevCommand();

async function runDevAndAbort(
  run: () => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  try {
    await run();
  } finally {
    controller.abort();
  }
}

describe("devCommand", () => {
  it("exports", async () => {
    const mod = await import("../../../../src/cli/commands/dev.ts");
    assertExists(mod.devCommand);
    assertEquals(typeof mod.devCommand, "function");
  });

  it("with default options", async () => {
    await withTestContext("dev-default", async (context: TestContext) => {
      clearConfigCache();

      await ensureDir(`${context.projectDir}/src`);

      await writeTextFile(
        `${context.projectDir}/veryfront.config.js`,
        `
export default {
  title: "Test App",
  dev: {
    port: 3003,
    host: "localhost"
  }
};
`,
      );

      const controller = new AbortController();
      try {
        const devPromise = devCommand({
          projectDir: context.projectDir,
          port: 3002,
          signal: controller.signal,
        });

        await delay(50);

        controller.abort();
        await devPromise;
      } finally {
        controller.abort();
      }
    });
  });

  it("with custom options (no config file)", async () => {
    await withTestContext("dev-custom", async (context: TestContext) => {
      clearConfigCache();

      const controller = new AbortController();
      try {
        const options: DevCommandOptions & { signal: AbortSignal } = {
          port: 4000,
          projectDir: context.projectDir,
          signal: controller.signal,
        };

        const devPromise = devCommand(options);

        await delay(50);

        controller.abort();
        await devPromise;
      } finally {
        controller.abort();
      }
    });
  });

  it("with no config file", async () => {
    await withTestContext("dev-noconfig", async (context: TestContext) => {
      clearConfigCache();

      const controller = new AbortController();
      try {
        const devPromise = devCommand({
          projectDir: context.projectDir,
          port: 3002,
          signal: controller.signal,
        });

        await delay(50);

        controller.abort();
        await devPromise;
      } finally {
        controller.abort();
      }
    });
  });

  it("with minimal config (shows DEFAULT_CONFIG merging)", async () => {
    await withTestContext("dev-minimal", async (context: TestContext) => {
      clearConfigCache();

      await writeTextFile(
        `${context.projectDir}/veryfront.config.js`,
        `
export default {
  title: "Test App"
};
`,
      );

      const controller = new AbortController();
      try {
        const devPromise = devCommand({
          projectDir: context.projectDir,
          port: 5000,
          signal: controller.signal,
        });

        await delay(50);

        controller.abort();
        await devPromise;
      } finally {
        controller.abort();
      }
    });
  });
});
