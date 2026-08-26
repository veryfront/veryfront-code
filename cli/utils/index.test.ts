import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { deleteEnv, getEnv, setEnv } from "../../src/platform/compat/process.ts";
import { refreshLoggerConfig, serverLogger } from "veryfront/utils";
import { resetInteractiveMode, setNonInteractive } from "../shared/interactive.ts";
import { setJsonMode } from "../shared/json-output.ts";
import {
  cliLogger,
  confirmPrompt,
  ensureConfirmPromptAvailable,
  formatBytes,
  isTTY,
  isVerbose,
  logError,
  logInfo,
  logSuccess,
  logWarning,
  promptUser,
  setQuietMode,
  setVerboseMode,
  showHeader,
  showLogo,
  VERSION,
} from "./index.ts";

function stripAnsi(str: string): string {
  // deno-lint-ignore no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}

function captureOutput(fn: () => void): { stdout: string; stderr: string } {
  const originalLog = console.log;
  const originalDebug = console.debug;
  const originalError = console.error;
  const originalWarn = console.warn;

  let stdout = "";
  let stderr = "";

  console.log = (...args: unknown[]) => {
    stdout += `${args.join(" ")}\n`;
  };
  console.debug = (...args: unknown[]) => {
    stdout += `${args.join(" ")}\n`;
  };
  console.error = (...args: unknown[]) => {
    stderr += `${args.join(" ")}\n`;
  };
  console.warn = (...args: unknown[]) => {
    stderr += `${args.join(" ")}\n`;
  };

  try {
    fn();
  } finally {
    console.log = originalLog;
    console.debug = originalDebug;
    console.error = originalError;
    console.warn = originalWarn;
  }

  return { stdout, stderr };
}

async function withMockPrompt<T>(
  mock: (message?: string) => string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const originalPrompt = globalThis.prompt;
  globalThis.prompt = mock;

  try {
    return await fn();
  } finally {
    globalThis.prompt = originalPrompt;
  }
}

function withDebugEnv(value: string, fn: () => void): void {
  const originalDebug = getEnv("VERYFRONT_DEBUG");
  // LOG_LEVEL wins over the debug flag in getDefaultLevel(), so an ambient
  // level left behind by another test would filter the record out and make
  // these assertions about VERYFRONT_DEBUG fail for an unrelated reason.
  const originalLevel = getEnv("LOG_LEVEL");
  const originalVerbose = isVerbose();
  setVerboseMode(false);
  deleteEnv("LOG_LEVEL");
  setEnv("VERYFRONT_DEBUG", value);
  refreshLoggerConfig();

  try {
    fn();
  } finally {
    if (originalDebug === undefined) {
      deleteEnv("VERYFRONT_DEBUG");
    } else {
      setEnv("VERYFRONT_DEBUG", originalDebug);
    }
    // setVerboseMode re-syncs the canonical log level, so restore LOG_LEVEL
    // after it or the restored value gets overwritten.
    setVerboseMode(originalVerbose);
    if (originalLevel === undefined) {
      deleteEnv("LOG_LEVEL");
    } else {
      setEnv("LOG_LEVEL", originalLevel);
    }
    refreshLoggerConfig();
  }
}

describe("cliLogger", () => {
  it("uses the shared truthy semantics for VERYFRONT_DEBUG", () => {
    withDebugEnv(" Yes ", () => {
      assertStringIncludes(captureOutput(() => cliLogger.debug("details")).stdout, "details");
    });
  });

  it("does not write debug output in JSON mode", () => {
    withDebugEnv("true", () => {
      setJsonMode(true);
      try {
        assertEquals(captureOutput(() => cliLogger.debug("details")).stdout, "");
      } finally {
        setJsonMode(false);
      }
    });
  });
});

describe("temporary log levels", () => {
  it("restores the environment log level after verbose mode", () => {
    const originalLevel = getEnv("LOG_LEVEL");

    try {
      setEnv("LOG_LEVEL", "ERROR");
      refreshLoggerConfig();
      setVerboseMode(true);
      assertStringIncludes(captureOutput(() => serverLogger.debug("visible")).stdout, "visible");

      setVerboseMode(false);
      assertEquals(captureOutput(() => serverLogger.info("hidden")).stdout, "");
    } finally {
      setVerboseMode(false);
      if (originalLevel === undefined) deleteEnv("LOG_LEVEL");
      else setEnv("LOG_LEVEL", originalLevel);
      refreshLoggerConfig();
    }
  });

  it("restores the environment log level after quiet mode", () => {
    const originalLevel = getEnv("LOG_LEVEL");

    try {
      setEnv("LOG_LEVEL", "DEBUG");
      refreshLoggerConfig();
      setQuietMode(true);
      assertEquals(captureOutput(() => serverLogger.info("hidden")).stdout, "");

      setQuietMode(false);
      assertStringIncludes(captureOutput(() => serverLogger.debug("visible")).stdout, "visible");
    } finally {
      setQuietMode(false);
      if (originalLevel === undefined) deleteEnv("LOG_LEVEL");
      else setEnv("LOG_LEVEL", originalLevel);
      refreshLoggerConfig();
    }
  });
});

describe("showHeader", () => {
  it("renders a compact one-line command header", () => {
    const { stdout } = captureOutput(showHeader);
    assertEquals(stripAnsi(stdout).trim(), `Veryfront (v${VERSION})`);
  });

  it("does not write human output in JSON mode", () => {
    setJsonMode(true);
    try {
      assertEquals(captureOutput(showHeader).stdout, "");
    } finally {
      setJsonMode(false);
    }
  });
});

describe("logSuccess", () => {
  it("adds checkmark", () => {
    const { stdout } = captureOutput(() => logSuccess("Operation completed"));
    assertStringIncludes(stripAnsi(stdout), "✓ Operation completed");
  });
});

describe("logError", () => {
  it("adds X and uses stderr", () => {
    const { stderr } = captureOutput(() => logError("Something went wrong"));
    assertStringIncludes(stripAnsi(stderr), "✗ Something went wrong");
  });
});

describe("logWarning", () => {
  it("adds warning symbol and uses stderr", () => {
    const { stderr } = captureOutput(() => logWarning("This is a warning"));
    assertStringIncludes(stripAnsi(stderr), "! This is a warning");
  });
});

describe("logInfo", () => {
  it("adds info symbol", () => {
    const { stdout } = captureOutput(() => logInfo("Information message"));
    assertStringIncludes(stripAnsi(stdout), "› Information message");
  });
});

describe("formatBytes", () => {
  it("formats zero bytes", () => {
    assertEquals(formatBytes(0), "0 Bytes");
  });

  it("formats bytes correctly", () => {
    assertEquals(formatBytes(1), "1 Bytes");
    assertEquals(formatBytes(10), "10 Bytes");
    assertEquals(formatBytes(1023), "1023 Bytes");
  });

  it("formats kilobytes", () => {
    assertEquals(formatBytes(1024), "1 KB");
    assertEquals(formatBytes(2048), "2 KB");
    assertEquals(formatBytes(1536), "1.5 KB");
    assertEquals(formatBytes(1048575), "1024 KB");
  });

  it("formats megabytes", () => {
    assertEquals(formatBytes(1048576), "1 MB");
    assertEquals(formatBytes(1572864), "1.5 MB");
    assertEquals(formatBytes(10485760), "10 MB");
    assertEquals(formatBytes(1073741823), "1024 MB");
  });

  it("formats gigabytes", () => {
    assertEquals(formatBytes(1073741824), "1 GB");
    assertEquals(formatBytes(2147483648), "2 GB");
    assertEquals(formatBytes(1610612736), "1.5 GB");
  });

  it("formats terabytes", () => {
    assertEquals(formatBytes(1099511627776), "1 TB");
    assertEquals(formatBytes(2199023255552), "2 TB");
  });

  it("handles edge cases", () => {
    assertEquals(formatBytes(0.1), "0.1 Bytes");
    assertEquals(formatBytes(0.5), "0.5 Bytes");
    assertEquals(formatBytes(0.99), "0.99 Bytes");

    assertEquals(formatBytes(-1024), "1 KB");
    assertEquals(formatBytes(-2048), "2 KB");

    assertEquals(formatBytes(1536), "1.5 KB");
    assertEquals(formatBytes(1792), "1.75 KB");

    const veryLarge = 1024 ** 6; // Would be EB
    assertStringIncludes(formatBytes(veryLarge), "TB");
  });
});

const promptTestIt = typeof globalThis.prompt === "function" ? it : it.skip;

describe("promptUser", () => {
  promptTestIt("reads from stdin", async () => {
    const result = await withMockPrompt(() => "test input", () => promptUser("Enter something:"));
    assertEquals(result, "test input");
  });

  promptTestIt("handles empty input", async () => {
    const result = await withMockPrompt(() => null, () => promptUser("Enter something:"));
    assertEquals(result, "");
  });

  promptTestIt("trims whitespace", async () => {
    const result = await withMockPrompt(
      () => "  test with spaces  ",
      () => promptUser("Enter something:"),
    );
    assertEquals(result, "test with spaces");
  });

  it("fails before prompting when interactive input is disabled", async () => {
    setNonInteractive(true);
    try {
      await assertRejects(
        () => promptUser("Enter something:"),
        VeryfrontError,
        "Interactive input is disabled",
      );
    } finally {
      resetInteractiveMode();
    }
  });
});

describe("confirmPrompt", () => {
  it("throws when interactive confirmation cannot prompt", () => {
    assertThrows(
      () => ensureConfirmPromptAvailable({ interactive: true, stdoutTTY: false }),
      VeryfrontError,
      "no interactive prompt is available",
    );
  });

  it("allows explicit non-interactive confirmation without a TTY", () => {
    ensureConfirmPromptAvailable({ interactive: false, stdoutTTY: false });
  });

  it("allows interactive confirmation when stdout is a TTY", () => {
    ensureConfirmPromptAvailable({ interactive: true, stdoutTTY: true });
  });

  it("does not consume the default answer when interactive confirmation cannot prompt", async () => {
    if (isTTY()) return;

    resetInteractiveMode();
    await assertRejects(
      () => confirmPrompt("Delete everything?", false),
      VeryfrontError,
      "no interactive prompt is available",
    );
  });

  it("fails closed in non-interactive mode without explicit confirmation", async () => {
    setNonInteractive(true);
    try {
      await assertRejects(
        () => confirmPrompt("Delete everything?", true),
        VeryfrontError,
        "requires explicit confirmation",
      );
    } finally {
      resetInteractiveMode();
    }
  });
});

describe("exports", () => {
  it("all exports are available", () => {
    assertExists(showLogo);
    assertExists(showHeader);
    assertExists(promptUser);
    assertExists(logSuccess);
    assertExists(logError);
    assertExists(logWarning);
    assertExists(logInfo);
    assertExists(formatBytes);

    assertEquals(typeof showLogo, "function");
    assertEquals(typeof showHeader, "function");
    assertEquals(showLogo, showHeader);
    assertEquals(typeof promptUser, "function");
    assertEquals(typeof logSuccess, "function");
    assertEquals(typeof logError, "function");
    assertEquals(typeof logWarning, "function");
    assertEquals(typeof logInfo, "function");
    assertEquals(typeof formatBytes, "function");
  });
});
