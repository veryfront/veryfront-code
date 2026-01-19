import { VERSION } from "#veryfront/utils";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  formatBytes,
  logError,
  logInfo,
  logSuccess,
  logWarning,
  promptUser,
  showHelp,
  showLogo,
  showVersion,
} from "./index.ts";

// Strip ANSI escape codes from string
function stripAnsi(str: string): string {
  const ESC = String.fromCharCode(27);
  const ansiPattern = new RegExp(ESC + "\\[[0-9;]*m", "g");
  return str.replace(ansiPattern, "");
}

// Helper to capture console output
function captureOutput(fn: () => void | Promise<void>): { stdout: string; stderr: string } {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  let stdout = "";
  let stderr = "";

  console.log = (...args: any[]) => {
    stdout += `${args.join(" ")}\n`;
  };

  console.error = (...args: any[]) => {
    stderr += `${args.join(" ")}\n`;
  };

  console.warn = (...args: any[]) => {
    stderr += `${args.join(" ")}\n`;
  };

  try {
    const result = fn();
    if (result instanceof Promise) {
      throw new Error("Async functions not supported in captureOutput");
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  return { stdout, stderr };
}

// Helper for async capture (available for future tests)
async function _captureAsyncOutput(
  fn: () => Promise<void>,
): Promise<{ stdout: string; stderr: string }> {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  let stdout = "";
  let stderr = "";

  console.log = (...args: unknown[]) => {
    stdout += `${args.join(" ")}\n`;
  };

  console.error = (...args: unknown[]) => {
    stderr += `${args.join(" ")}\n`;
  };

  console.warn = (...args: unknown[]) => {
    stderr += `${args.join(" ")}\n`;
  };

  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  return { stdout, stderr };
}
void _captureAsyncOutput; // Prevent unused warning

describe("showLogo", () => {
  it("outputs Veryfront in cyan", () => {
    const { stdout } = captureOutput(() => showLogo());
    // The cyan color code is ANSI escape sequences
    assertStringIncludes(stdout, "Veryfront");
  });
});

describe("showHelp", () => {
  it("displays complete help information", () => {
    const { stdout } = captureOutput(() => showHelp());

    // Check for logo
    assertStringIncludes(stdout, "Veryfront");

    // Check for usage
    assertStringIncludes(stdout, "Usage:");
    assertStringIncludes(stdout, "veryfront <command> [options]");

    // Check for commands
    assertStringIncludes(stdout, "Commands:");
    assertStringIncludes(stdout, "init");
    assertStringIncludes(stdout, "dev");
    assertStringIncludes(stdout, "build");
    assertStringIncludes(stdout, "serve");
    assertStringIncludes(stdout, "doctor");
    assertStringIncludes(stdout, "clean");
    assertStringIncludes(stdout, "routes");
    assertStringIncludes(stdout, "generate");

    // Check for options
    assertStringIncludes(stdout, "Options:");
    assertStringIncludes(stdout, "--version");
    assertStringIncludes(stdout, "--help");

    // Check for examples
    assertStringIncludes(stdout, "Examples:");
    assertStringIncludes(stdout, "veryfront init my-app");
    assertStringIncludes(stdout, "veryfront dev --port 3000");

    // Check for config tips
    assertStringIncludes(stdout, "Config tips:");
    assertStringIncludes(stdout, "veryfront.config.js");

    // Check for docs
    assertStringIncludes(stdout, "Docs:");
    assertStringIncludes(stdout, "RSC Security");

    // Check version is included
    assertStringIncludes(stdout, `Version: ${VERSION}`);
  });
});

describe("showVersion", () => {
  it("displays version", () => {
    const { stdout } = captureOutput(() => showVersion());
    assertStringIncludes(stripAnsi(stdout), `veryfront v${VERSION}`);
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
    // Very small decimal - should return as-is with "Bytes"
    assertEquals(formatBytes(0.1), "0.1 Bytes");
    assertEquals(formatBytes(0.5), "0.5 Bytes");
    assertEquals(formatBytes(0.99), "0.99 Bytes");

    // Negative numbers - uses absolute value
    assertEquals(formatBytes(-1024), "1 KB");
    assertEquals(formatBytes(-2048), "2 KB");

    // Large numbers with decimals
    assertEquals(formatBytes(1536), "1.5 KB");
    assertEquals(formatBytes(1792), "1.75 KB");

    // Very large numbers - clamped to TB
    const veryLarge = 1024 ** 6; // Would be EB
    assertStringIncludes(formatBytes(veryLarge), "TB");
  });
});

// These tests mock globalThis.prompt which only works in Deno
// Node.js takes a different code path using fs to read from stdin
const hasPrompt = typeof globalThis.prompt === "function";
const promptTestIt = hasPrompt ? it : it.skip;

describe("promptUser", () => {
  promptTestIt("reads from stdin", async () => {
    // Mock the global prompt function (used by promptSync in Deno)
    const originalPrompt = globalThis.prompt;
    globalThis.prompt = (_message?: string) => "test input";

    try {
      const result = await promptUser("Enter something:");
      assertEquals(result, "test input");
    } finally {
      globalThis.prompt = originalPrompt;
    }
  });

  promptTestIt("handles empty input", async () => {
    // Mock the global prompt function to return null (user cancelled)
    const originalPrompt = globalThis.prompt;
    globalThis.prompt = (_message?: string) => null;

    try {
      const result = await promptUser("Enter something:");
      assertEquals(result, "");
    } finally {
      globalThis.prompt = originalPrompt;
    }
  });

  promptTestIt("trims whitespace", async () => {
    // Mock the global prompt function to return string with whitespace
    const originalPrompt = globalThis.prompt;
    globalThis.prompt = (_message?: string) => "  test with spaces  ";

    try {
      const result = await promptUser("Enter something:");
      assertEquals(result, "test with spaces");
    } finally {
      globalThis.prompt = originalPrompt;
    }
  });
});

describe("exports", () => {
  it("all exports are available", () => {
    assertExists(showLogo);
    assertExists(showHelp);
    assertExists(showVersion);
    assertExists(promptUser);
    assertExists(logSuccess);
    assertExists(logError);
    assertExists(logWarning);
    assertExists(logInfo);
    assertExists(formatBytes);

    // Verify they're functions
    assertEquals(typeof showLogo, "function");
    assertEquals(typeof showHelp, "function");
    assertEquals(typeof showVersion, "function");
    assertEquals(typeof promptUser, "function");
    assertEquals(typeof logSuccess, "function");
    assertEquals(typeof logError, "function");
    assertEquals(typeof logWarning, "function");
    assertEquals(typeof logInfo, "function");
    assertEquals(typeof formatBytes, "function");
  });
});
