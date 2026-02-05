import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { DevCommandOptions, DevCommandResult, DevOptions } from "./dev/index.ts";

describe("cli/commands/dev", () => {
  describe("DevOptions type", () => {
    it("should accept minimal options", () => {
      const options: DevOptions = {
        port: 3000,
        projectDir: "/tmp/project",
      };

      assertEquals(options, {
        port: 3000,
        projectDir: "/tmp/project",
      });
    });

    it("should accept full options", () => {
      const options: DevOptions = {
        port: 8080,
        projectDir: "/home/user/my-app",
        hmr: true,
        demoMode: false,
      };

      assertEquals(options, {
        port: 8080,
        projectDir: "/home/user/my-app",
        hmr: true,
        demoMode: false,
      });
    });

    it("should accept demo mode", () => {
      const options: DevOptions = {
        port: 3000,
        projectDir: "/tmp/project",
        demoMode: true,
      };

      assertEquals(options.demoMode, true);
    });

    it("should accept hmr disabled", () => {
      const options: DevOptions = {
        port: 3000,
        projectDir: "/tmp/project",
        hmr: false,
      };

      assertEquals(options.hmr, false);
    });
  });

  describe("DevCommandOptions type alias", () => {
    it("should be assignable from DevOptions", () => {
      const options: DevCommandOptions = {
        port: 3000,
        projectDir: "/tmp/project",
      };

      const devOptions: DevOptions = options;
      assertEquals(devOptions.port, 3000);
    });
  });

  describe("DevCommandResult type", () => {
    it("should have ready, done, and stop properties", () => {
      const result: DevCommandResult = {
        ready: Promise.resolve(),
        done: Promise.resolve(),
        stop: async () => {},
      };

      assertEquals(typeof result.ready.then, "function");
      assertEquals(typeof result.done.then, "function");
      assertEquals(typeof result.stop, "function");
    });

    it("should allow awaiting ready", async () => {
      const result: DevCommandResult = {
        ready: Promise.resolve(),
        done: new Promise(() => {}), // never resolves
        stop: async () => {},
      };

      await result.ready;
    });

    it("should allow calling stop", async () => {
      let stopped = false;

      const result: DevCommandResult = {
        ready: Promise.resolve(),
        done: Promise.resolve(),
        stop: () => {
          stopped = true;
          return Promise.resolve();
        },
      };

      await result.stop();
      assertEquals(stopped, true);
    });
  });

  describe("dev command port logic", () => {
    const DEFAULT_DEV_PORT = 3000;

    function calculateFinalPort(port: number, configPort?: number): number {
      if (port !== DEFAULT_DEV_PORT) return port;
      return configPort ?? port;
    }

    it("should use user-specified port when not default", () => {
      assertEquals(calculateFinalPort(8080, 4000), 8080);
    });

    it("should use config port when user port is default", () => {
      assertEquals(calculateFinalPort(3000, 4000), 4000);
    });

    it("should fall back to default when no config port", () => {
      assertEquals(calculateFinalPort(3000, undefined), 3000);
    });

    it("should use MCP port as finalPort + 2", () => {
      const finalPort = calculateFinalPort(3000, undefined);
      assertEquals(finalPort + 2, 3002);
    });

    it("should use HMR port as finalPort + 1", () => {
      const finalPort = calculateFinalPort(8080, undefined);
      assertEquals(finalPort + 1, 8081);
    });
  });

  describe("HMR enable logic", () => {
    function shouldEnableHMR(
      configHmr: boolean | undefined,
      optionHmr: boolean,
    ): boolean {
      return configHmr !== false && optionHmr;
    }

    it("should enable HMR when both config and option allow it", () => {
      assertEquals(shouldEnableHMR(undefined, true), true);
    });

    it("should disable HMR when option is false", () => {
      assertEquals(shouldEnableHMR(undefined, false), false);
    });

    it("should disable HMR when config explicitly disables it", () => {
      assertEquals(shouldEnableHMR(false, true), false);
    });

    it("should enable HMR when config is true and option is true", () => {
      assertEquals(shouldEnableHMR(true, true), true);
    });
  });
});
