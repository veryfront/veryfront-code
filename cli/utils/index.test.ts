import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  formatBytes,
  logError,
  logInfo,
  logSuccess,
  logWarning,
  promptUser,
  showLogo,
} from "./index.ts";

function stripAnsi(str: string): string {
  // deno-lint-ignore no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}

function captureOutput(fn: () => void): { stdout: string; stderr: string } {
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
    fn();
  } finally {
    console.log = originalLog;
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

describe("showLogo", () => {
  it("outputs Veryfront in cyan", () => {
    const { stdout } = captureOutput(showLogo);
    assertStringIncludes(stdout, "Veryfront");
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
});

describe("exports", () => {
  it("all exports are available", () => {
    assertExists(showLogo);
    assertExists(promptUser);
    assertExists(logSuccess);
    assertExists(logError);
    assertExists(logWarning);
    assertExists(logInfo);
    assertExists(formatBytes);

    assertEquals(typeof showLogo, "function");
    assertEquals(typeof promptUser, "function");
    assertEquals(typeof logSuccess, "function");
    assertEquals(typeof logError, "function");
    assertEquals(typeof logWarning, "function");
    assertEquals(typeof logInfo, "function");
    assertEquals(typeof formatBytes, "function");
  });
});
