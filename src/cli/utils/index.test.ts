import { VERSION } from "@veryfront/utils";
import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert@1";
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

// Helper for async capture
async function captureAsyncOutput(
  fn: () => Promise<void>,
): Promise<{ stdout: string; stderr: string }> {
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
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  return { stdout, stderr };
}

Deno.test("showLogo outputs Veryfront in cyan", () => {
  const { stdout } = captureOutput(() => showLogo());
  // The cyan color code is ANSI escape sequences
  assertStringIncludes(stdout, "Veryfront");
});

Deno.test("showHelp displays complete help information", () => {
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

Deno.test("showVersion displays version", () => {
  const { stdout } = captureOutput(() => showVersion());
  assertStringIncludes(stripAnsi(stdout), `veryfront v${VERSION}`);
});

Deno.test("logSuccess adds checkmark", () => {
  const { stdout } = captureOutput(() => logSuccess("Operation completed"));
  assertStringIncludes(stripAnsi(stdout), "✓ Operation completed");
});

Deno.test("logError adds X and uses stderr", () => {
  const { stderr } = captureOutput(() => logError("Something went wrong"));
  assertStringIncludes(stripAnsi(stderr), "✗ Something went wrong");
});

Deno.test("logWarning adds warning symbol and uses stderr", () => {
  const { stderr } = captureOutput(() => logWarning("This is a warning"));
  assertStringIncludes(stripAnsi(stderr), "! This is a warning");
});

Deno.test("logInfo adds info symbol", () => {
  const { stdout } = captureOutput(() => logInfo("Information message"));
  assertStringIncludes(stripAnsi(stdout), "› Information message");
});

Deno.test("formatBytes formats zero bytes", () => {
  assertEquals(formatBytes(0), "0 Bytes");
});

Deno.test("formatBytes formats bytes correctly", () => {
  assertEquals(formatBytes(1), "1 Bytes");
  assertEquals(formatBytes(10), "10 Bytes");
  assertEquals(formatBytes(1023), "1023 Bytes");
});

Deno.test("formatBytes formats kilobytes", () => {
  assertEquals(formatBytes(1024), "1 KB");
  assertEquals(formatBytes(2048), "2 KB");
  assertEquals(formatBytes(1536), "1.5 KB");
  assertEquals(formatBytes(1048575), "1024 KB");
});

Deno.test("formatBytes formats megabytes", () => {
  assertEquals(formatBytes(1048576), "1 MB");
  assertEquals(formatBytes(1572864), "1.5 MB");
  assertEquals(formatBytes(10485760), "10 MB");
  assertEquals(formatBytes(1073741823), "1024 MB");
});

Deno.test("formatBytes formats gigabytes", () => {
  assertEquals(formatBytes(1073741824), "1 GB");
  assertEquals(formatBytes(2147483648), "2 GB");
  assertEquals(formatBytes(1610612736), "1.5 GB");
});

Deno.test("formatBytes formats terabytes", () => {
  assertEquals(formatBytes(1099511627776), "1 TB");
  assertEquals(formatBytes(2199023255552), "2 TB");
});

Deno.test("formatBytes handles edge cases", () => {
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

Deno.test("promptUser reads from stdin", async () => {
  // Mock stdin
  const originalStdin = Deno.stdin;
  const mockStdin = {
    read: (buf: Uint8Array) => {
      const input = "test input\n";
      const encoded = new TextEncoder().encode(input);
      buf.set(encoded);
      return encoded.length;
    },
    rid: 0,
    readable: Deno.stdin.readable,
    close: () => {},
  };

  // Replace stdin temporarily
  Object.defineProperty(Deno, "stdin", {
    value: mockStdin,
    configurable: true,
  });

  try {
    const { stdout } = await captureAsyncOutput(async () => {
      const result = await promptUser("Enter something:");
      assertEquals(result, "test input");
    });

    assertStringIncludes(stdout, "Enter something:");
  } finally {
    // Restore original stdin
    Object.defineProperty(Deno, "stdin", {
      value: originalStdin,
      configurable: true,
    });
  }
});

Deno.test("promptUser handles empty input", async () => {
  // Mock stdin with null read
  const originalStdin = Deno.stdin;
  const mockStdin = {
    read: (_buf: Uint8Array) => {
      return null;
    },
    rid: 0,
    readable: Deno.stdin.readable,
    close: () => {},
  };

  Object.defineProperty(Deno, "stdin", {
    value: mockStdin,
    configurable: true,
  });

  try {
    const result = await promptUser("Enter something:");
    assertEquals(result, "");
  } finally {
    Object.defineProperty(Deno, "stdin", {
      value: originalStdin,
      configurable: true,
    });
  }
});

Deno.test("promptUser trims whitespace", async () => {
  // Mock stdin with whitespace
  const originalStdin = Deno.stdin;
  const mockStdin = {
    read: (buf: Uint8Array) => {
      const input = "  test with spaces  \n";
      const encoded = new TextEncoder().encode(input);
      buf.set(encoded);
      return encoded.length;
    },
    rid: 0,
    readable: Deno.stdin.readable,
    close: () => {},
  };

  Object.defineProperty(Deno, "stdin", {
    value: mockStdin,
    configurable: true,
  });

  try {
    const result = await promptUser("Enter something:");
    assertEquals(result, "test with spaces");
  } finally {
    Object.defineProperty(Deno, "stdin", {
      value: originalStdin,
      configurable: true,
    });
  }
});

Deno.test("all exports are available", () => {
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
