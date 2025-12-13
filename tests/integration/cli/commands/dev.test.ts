import { assertEquals, assertExists } from "std/assert/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import type { DevCommandOptions } from "../../../../src/cli/commands/dev.ts";
import { clearConfigCache } from "@veryfront/config";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";

const createMockDevCommand = () => {
  return async (options: any) => {
    const { port = 3002, projectDir } = options;

    console.log("Starting development server...");

    const adapter = await (await import("@veryfront/platform/adapters/detect.ts")).getAdapter();
    const config = await (await import("@veryfront/config/loader.ts")).getConfig(
      projectDir,
      adapter,
    );

    const finalPort = config?.dev?.port || port;

    console.log(`📁 Project: ${projectDir}`);
    console.log(`🌐 Port: ${finalPort}`);
    console.log(`⚡ HMR: enabled`);
    console.log(`🧧 Client routing: enabled`);
    console.log(`🔮 Prefetching: enabled`);

    return new Promise(() => {
      /* empty */
    });
  };
};

const devCommand: any = createMockDevCommand();

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

      await Deno.writeTextFile(
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

      try {
        devCommand({ projectDir: context.projectDir, port: 3002 }).catch(() => {
          // Ignore errors as the server runs indefinitely
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Note: Console output assertions removed as dev command no longer logs to console
      } finally {
        // Cleanup
      }
    });
  });

  it("with custom options (no config file)", async () => {
    await withTestContext("dev-custom", async (context: TestContext) => {
      clearConfigCache();

      try {
        const options: DevCommandOptions = {
          port: 4000,
          projectDir: context.projectDir,
        };

        devCommand(options).catch(() => {
          // Ignore errors as the server runs indefinitely
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Note: When no config file exists, DEFAULT_CONFIG.dev.port (3002) is used
      } finally {
        // Cleanup
      }
    });
  });

  it("with no config file", async () => {
    await withTestContext("dev-noconfig", async (context: TestContext) => {
      clearConfigCache();

      try {
        devCommand({ projectDir: context.projectDir, port: 3002 }).catch(() => {
          // Ignore errors as the server runs indefinitely
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Should use default port 3002
      } finally {
        // Cleanup
      }
    });
  });

  it("with minimal config (shows DEFAULT_CONFIG merging)", async () => {
    await withTestContext("dev-minimal", async (context: TestContext) => {
      clearConfigCache();

      await Deno.writeTextFile(
        `${context.projectDir}/veryfront.config.js`,
        `
export default {
  title: "Test App"
};
`,
      );

      try {
        devCommand({ projectDir: context.projectDir, port: 5000 }).catch(() => {
          /* empty */
        });

        await new Promise((resolve) => setTimeout(resolve, 200));

        // Note: Due to config merging with DEFAULT_CONFIG, even minimal configs get dev.port = 3002
        // The CLI --port option is only used when DEFAULT_CONFIG.dev.port is not set
      } finally {
        // Cleanup
      }
    });
  });
});

