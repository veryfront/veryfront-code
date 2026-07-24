import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  CLI_ENVIRONMENT_STARTUP_MESSAGE,
  formatCliEnvironmentStartupFailure,
  isCliStartupDebugEnabled,
} from "./startup-error.ts";
import { initializeCliEnvironment } from "./startup-env.ts";

const CLI_MAIN_URL = new URL("./main.ts", import.meta.url).href;

async function runCliWithMalformedEnvironment(
  args: string[],
  startupDebug = "0",
): Promise<{ code: number; stdout: string; stderr: string; projectDir: string }> {
  const projectDir = await Deno.makeTempDir({ prefix: "veryfront-cli-startup-" });
  const startupSecret = "startup-secret-must-not-leak";

  try {
    await Deno.writeTextFile(
      `${projectDir}/.env`,
      `SAFE=value\nPRIVATE_KEY="${startupSecret}`,
    );
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-all", CLI_MAIN_URL, ...args],
      cwd: projectDir,
      env: { VERYFRONT_DEBUG: startupDebug },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    return {
      code: output.code,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
      projectDir,
    };
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

describe("initializeCliEnvironment()", () => {
  it("propagates load failures without marking or initializing and permits retry", async () => {
    let loaded = false;
    let loadAttempts = 0;
    let markCalls = 0;
    let initializeCalls = 0;
    const dependencies = {
      hasEnvLoaded: () => loaded,
      supportsEnvFiles: () => true,
      loadEnv: () => {
        loadAttempts++;
        if (loadAttempts === 1) {
          return Promise.reject(new Error("malformed .env"));
        }
        loaded = true;
        return Promise.resolve();
      },
      markEnvLoaded: () => {
        markCalls++;
        loaded = true;
      },
      initializeEnvironmentConfig: () => {
        initializeCalls++;
      },
    };

    await assertRejects(
      () => initializeCliEnvironment(dependencies),
      Error,
      "malformed .env",
    );
    assertEquals(loaded, false);
    assertEquals(markCalls, 0);
    assertEquals(initializeCalls, 0);

    await initializeCliEnvironment(dependencies);
    assertEquals(loaded, true);
    assertEquals(loadAttempts, 2);
    assertEquals(markCalls, 0);
    assertEquals(initializeCalls, 1);
  });

  it("marks unsupported runtimes loaded before initializing configuration", async () => {
    let loaded = false;
    let loadCalls = 0;
    let initializeCalls = 0;

    await initializeCliEnvironment({
      hasEnvLoaded: () => loaded,
      supportsEnvFiles: () => false,
      loadEnv: () => {
        loadCalls++;
        return Promise.resolve();
      },
      markEnvLoaded: () => {
        loaded = true;
      },
      initializeEnvironmentConfig: () => {
        initializeCalls++;
      },
    });

    assertEquals(loaded, true);
    assertEquals(loadCalls, 0);
    assertEquals(initializeCalls, 1);
  });

  it("retries configuration initialization without reloading an environment that succeeded", async () => {
    let loaded = false;
    let loadCalls = 0;
    let initializeCalls = 0;
    const dependencies = {
      hasEnvLoaded: () => loaded,
      supportsEnvFiles: () => true,
      loadEnv: () => {
        loadCalls++;
        loaded = true;
        return Promise.resolve();
      },
      markEnvLoaded: () => {
        loaded = true;
      },
      initializeEnvironmentConfig: () => {
        initializeCalls++;
        if (initializeCalls === 1) {
          throw new Error("configuration initialization failed");
        }
      },
    };

    await assertRejects(
      () => initializeCliEnvironment(dependencies),
      Error,
      "configuration initialization failed",
    );
    await initializeCliEnvironment(dependencies);

    assertEquals(loadCalls, 1);
    assertEquals(initializeCalls, 2);
  });
});

describe("CLI environment startup boundary", () => {
  it("recognizes only active JSON flags before the argument terminator", () => {
    assertEquals(
      formatCliEnvironmentStartupFailure(["--json"]).destination,
      "stdout",
    );
    assertEquals(
      formatCliEnvironmentStartupFailure(["-j"]).destination,
      "stdout",
    );
    assertEquals(
      formatCliEnvironmentStartupFailure(["--json=false"]).destination,
      "stderr",
    );
    assertEquals(
      formatCliEnvironmentStartupFailure(["--", "--json"]).destination,
      "stderr",
    );
  });

  it("recognizes verbose and host debug modes without rendering the throwable", () => {
    for (const value of ["1", "true", "TRUE", "yes", " Yes "]) {
      assertEquals(isCliStartupDebugEnabled(value), true);
    }
    for (const value of [undefined, "", "0", "false", "on", "maybe"]) {
      assertEquals(isCliStartupDebugEnabled(value), false);
    }

    assertStringIncludes(
      formatCliEnvironmentStartupFailure(["--verbose"]).text,
      "details were suppressed",
    );
    assertEquals(
      formatCliEnvironmentStartupFailure(["--verbose=false"]).text.includes(
        "details were suppressed",
      ),
      false,
    );
    assertEquals(
      formatCliEnvironmentStartupFailure([
        "--verbose",
        "--verbose=false",
      ]).text.includes("details were suppressed"),
      false,
    );
    assertEquals(
      formatCliEnvironmentStartupFailure(["--", "--verbose"]).text.includes(
        "details were suppressed",
      ),
      false,
    );
    assertStringIncludes(
      formatCliEnvironmentStartupFailure([], { debug: true }).text,
      "details were suppressed",
    );
  });

  it("reports a stable text error without raw failures, secrets, paths, or stacks", async () => {
    const result = await runCliWithMalformedEnvironment(["--version"]);

    assertEquals(result.code, 1);
    assertEquals(result.stdout, "");
    assertStringIncludes(
      result.stderr,
      CLI_ENVIRONMENT_STARTUP_MESSAGE,
    );
    for (
      const forbidden of [
        "Uncaught",
        "PRIVATE_KEY",
        "startup-secret-must-not-leak",
        "file://",
        result.projectDir,
      ]
    ) {
      assertEquals(result.stderr.includes(forbidden), false);
    }
  });

  it("preserves the JSON envelope contract before command routing starts", async () => {
    const result = await runCliWithMalformedEnvironment([
      "--version",
      "--json",
    ]);

    assertEquals(result.code, 1);
    assertEquals(result.stderr, "");
    const envelope = JSON.parse(result.stdout);
    assertEquals(envelope, {
      success: false,
      command: "cli",
      error: {
        code: "CONFIG_ERROR",
        slug: "environment-load-failed",
        message: CLI_ENVIRONMENT_STARTUP_MESSAGE,
      },
    });
  });

  it("keeps malformed values, paths, and stacks hidden in verbose mode", async () => {
    const result = await runCliWithMalformedEnvironment([
      "--version",
      "--verbose",
    ]);

    assertEquals(result.code, 1);
    assertEquals(result.stdout, "");
    assertStringIncludes(result.stderr, CLI_ENVIRONMENT_STARTUP_MESSAGE);
    assertStringIncludes(result.stderr, "details were suppressed");
    for (
      const forbidden of [
        "Uncaught",
        "PRIVATE_KEY",
        "startup-secret-must-not-leak",
        "file://",
        result.projectDir,
      ]
    ) {
      assertEquals(result.stderr.includes(forbidden), false);
    }
  });

  it("honors the framework truthy debug contract without leaking diagnostics", async () => {
    const result = await runCliWithMalformedEnvironment(
      ["--version"],
      " Yes ",
    );

    assertEquals(result.code, 1);
    assertEquals(result.stdout, "");
    assertStringIncludes(result.stderr, CLI_ENVIRONMENT_STARTUP_MESSAGE);
    assertStringIncludes(result.stderr, "details were suppressed");
    assertEquals(result.stderr.includes("startup-secret-must-not-leak"), false);
    assertEquals(result.stderr.includes(result.projectDir), false);
    assertEquals(result.stderr.includes("file://"), false);
  });
});
