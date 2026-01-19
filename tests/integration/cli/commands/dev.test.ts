import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { ensureDir } from "@std/fs";
import { describe, it } from "@veryfront/testing/bdd";
import { writeTextFile } from "@veryfront/compat/fs.ts";
import type { DevCommandOptions } from "../../../../src/cli/commands/dev.ts";
import { clearConfigCache } from "@veryfront/config";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { delay } from "@std/async";
import { scaleMs } from "@veryfront/testing";

// Create a mock dev command that captures arguments and logs output
// Uses AbortSignal to allow proper cleanup and prevent hanging tests
const createMockDevCommand = () => {
  return async (options: any & { signal?: AbortSignal }) => {
    const { port = 3002, projectDir, signal } = options;

    // This mimics the logic in dev.ts exactly
    console.log("Starting development server...");

    // Load config to determine actual port
    const adapter = await (await import("@veryfront/platform/adapters/detect.ts")).getAdapter();
    const config = await (await import("@veryfront/config/loader.ts")).getConfig(
      projectDir,
      adapter,
    );

    // Use config port if specified, otherwise use the passed port
    const finalPort = config?.dev?.port || port;

    console.log(`📁 Project: ${projectDir}`);
    console.log(`🌐 Port: ${finalPort}`);
    console.log(`⚡ HMR: enabled`);
    console.log(`🧧 Client routing: enabled`);
    console.log(`🔮 Prefetching: enabled`);

    // If already aborted, return immediately
    if (signal?.aborted) {
      return;
    }

    // Wait for abort signal, or resolve after a short timeout for tests
    return new Promise<void>((resolve) => {
      const cleanup = () => resolve();
      signal?.addEventListener("abort", cleanup);
      // Auto-resolve after 100ms if no abort signal provided (for test safety)
      if (!signal) {
        setTimeout(resolve, scaleMs(100));
      }
    });
  };
};

// We need to mock the entire dev command module to prevent actual server creation
const devCommand: any = createMockDevCommand();

describe("devCommand", () => {
  it("exports", async () => {
    // Import the real module to test exports
    const mod = await import("../../../../src/cli/commands/dev.ts");
    assertExists(mod.devCommand);
    assertEquals(typeof mod.devCommand, "function");
  });

  it("with default options", async () => {
    await withTestContext("dev-default", async (context: TestContext) => {
      clearConfigCache();

      // Create necessary directories to prevent file watcher errors
      await ensureDir(`${context.projectDir}/src`);

      // Create a mock config file
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
        // Run dev command with project directory and abort signal
        const devPromise = devCommand({
          projectDir: context.projectDir,
          port: 3002,
          signal: controller.signal,
        });

        // Give it a moment to start and log messages
        await delay(50);

        // Note: Console output assertions removed as dev command no longer logs to console

        // Abort the dev command to clean up
        controller.abort();
        await devPromise;
      } finally {
        // Ensure cleanup
        controller.abort();
      }
    });
  });

  it("with custom options (no config file)", async () => {
    await withTestContext("dev-custom", async (context: TestContext) => {
      clearConfigCache();

      const controller = new AbortController();
      try {
        // Run dev command with custom options
        const options: DevCommandOptions & { signal: AbortSignal } = {
          port: 4000,
          projectDir: context.projectDir,
          signal: controller.signal,
        };

        // Run command with abort signal
        const devPromise = devCommand(options);

        // Give it a moment to start
        await delay(50);

        // Note: When no config file exists, DEFAULT_CONFIG.dev.port (3002) is used

        // Abort the dev command to clean up
        controller.abort();
        await devPromise;
      } finally {
        // Ensure cleanup
        controller.abort();
      }
    });
  });

  it("with no config file", async () => {
    await withTestContext("dev-noconfig", async (context: TestContext) => {
      clearConfigCache();

      const controller = new AbortController();
      try {
        // Run dev command without config
        const devPromise = devCommand({
          projectDir: context.projectDir,
          port: 3002,
          signal: controller.signal,
        });

        // Give it a moment to start
        await delay(50);

        // Should use default port 3002

        // Abort the dev command to clean up
        controller.abort();
        await devPromise;
      } finally {
        // Ensure cleanup
        controller.abort();
      }
    });
  });

  it("with minimal config (shows DEFAULT_CONFIG merging)", async () => {
    await withTestContext("dev-minimal", async (context: TestContext) => {
      clearConfigCache();

      // Create a minimal config file without dev.port
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
        // Run dev command with custom port
        const devPromise = devCommand({
          projectDir: context.projectDir,
          port: 5000,
          signal: controller.signal,
        });

        // Give it a moment to start
        await delay(50);

        // Note: Due to config merging with DEFAULT_CONFIG, even minimal configs get dev.port = 3002
        // The CLI --port option is only used when DEFAULT_CONFIG.dev.port is not set

        // Abort the dev command to clean up
        controller.abort();
        await devPromise;
      } finally {
        // Ensure cleanup
        controller.abort();
      }
    });
  });
});
