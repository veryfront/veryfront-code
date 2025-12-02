#!/usr/bin/env -S deno run --allow-all

/**
 * Veryfront Setup Script
 *
 * This script validates your environment and sets up the project for development.
 * Run: deno task setup
 */

import { createFileSystem, FileSystem } from "../src/platform/compat/fs.ts";
import { getArgs, exitProcess, isDeno, getRuntimeVersion } from "../src/platform/compat/process.ts";

// Conditional imports for path module and command parsing
let pathMod: typeof import('node:path') | undefined;
let childProcess: typeof import('node:child_process') | undefined;
let util: typeof import('node:util') | undefined;
let parseArgs: typeof import("mri");

// @ts-ignore - Deno global
if (typeof Deno === 'undefined') {
  pathMod = require('node:path');
  childProcess = require('node:child_process');
  util = require('node:util');
  parseArgs = require("mri');
} else {
  // @ts-ignore - Deno global
  pathMod = await import("jsr:@std/path");
  // @ts-ignore - Deno global
  ({ parseArgs } = await import("std/flags/mod.ts"));
}

// Helper to get path functions
const getPath = () => {
  if (pathMod) {
    return pathMod;
  } else {
    // Fallback for Deno, should already be globally available or imported via import maps
    // @ts-ignore - Deno global
    return require("std/path/mod.ts");
  }
};

const fs = createFileSystem();

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[36m",
  bold: "\x1b[1m",
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function success(message: string) {
  log(`✓ ${message}`, colors.green);
}

function error(message: string) {
  log(`✗ ${message}`, colors.red);
}

function warning(message: string) {
  log(`⚠ ${message}`, colors.yellow);
}

function info(message: string) {
  log(`ℹ ${message}`, colors.blue);
}

function header(message: string) {
  log(`\n${message}`, colors.bold);
  log("=".repeat(message.length), colors.bold);
}

// Cross-platform command execution helper
async function runCommand(cmd: string[], cwd?: string): Promise<{ success: boolean; stdout: string; stderr: string }> {
  // @ts-ignore - Deno global
  if (isDeno) {
    // @ts-ignore - Deno global
    const command = new Deno.Command(cmd[0], {
      args: cmd.slice(1),
      cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    const decoder = new TextDecoder();
    return {
      success: output.success,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  } else if (childProcess && util) {
    const execFile = util.promisify(childProcess.execFile);
    try {
      const { stdout, stderr } = await execFile(cmd[0], cmd.slice(1), { cwd });
      return { success: true, stdout: String(stdout), stderr: String(stderr) };
    } catch (error: any) {
      return {
        success: false,
        stdout: String(error.stdout || ''),
        stderr: String(error.stderr || ''),
      };
    }
  } else {
    return { success: false, stdout: '', stderr: 'Unsupported runtime for command execution.' };
  }
}

// Helper to get Deno version (if running in Deno)
function getDenoVersion(): string | null {
  if (isDeno) {
    // @ts-ignore - Deno global
    return Deno.version.deno;
  }
  return null;
}

// Check Deno version
async function checkDenoVersion() {
  header("Checking Deno Version");

  const denoVersion = getDenoVersion();

  if (!denoVersion) {
    info("Not running in Deno environment, skipping Deno version check.");
    return true; // Not critical for Node.js/Bun
  }

  const [major, minor] = denoVersion.split(".").map(Number);

  const requiredMajor = 1;
  const requiredMinor = 40;

  if (major > requiredMajor || (major === requiredMajor && minor >= requiredMinor)) {
    success(`Deno ${denoVersion} is installed`);
    return true;
  }

  error(`Deno ${requiredMajor}.${requiredMinor}+ is required`);
  info(
    "Install from: https://deno.land/ or run: brew install deno (macOS)",
  );
  return false;
}

// Check Node.js (optional, for compatibility)
async function checkNodeVersion() {
  header("Checking Node.js (Optional)");

  try {
    const { stdout } = await runCommand(["node", "--version"]);
    const version = stdout.trim();

    success(`Node.js ${version} is installed (optional)`);
    return true;
  } catch {
    info("Node.js not found (optional for Deno projects)");
    return false;
  }
}

// Check if deno.json exists
async function checkDenoJson() {
  header("Checking Project Files");

  const denoJsonPath = "deno.json";

  try {
    if (await fs.exists(denoJsonPath)) {
      success("deno.json found");
      return true;
    }
    error("deno.json not found");
    info("Make sure you\'re in the veryfront root directory");
    return false;
  } catch (e) {
    error(`Error checking deno.json: ${e.message}`);
    return false;
  }
}

// Check if .env file exists
async function checkEnvFile() {
  header("Checking Environment Configuration");

  const envPath = ".env";
  const envExamplePath = ".env.example";

  try {
    if (await fs.exists(envPath)) {
      success(".env file found");
      return true;
    }
    warning(".env file not found");

    if (await fs.exists(envExamplePath)) {
      info(`Run: cp ${envExamplePath} ${envPath}`);
      info("Then edit .env with your configuration");
      return true; // Not critical
    }
    warning(".env.example also not found");
    return true; // Not critical
  } catch (e) {
    error(`Error checking environment files: ${e.message}`);
    return false;
  }
}

// Cache dependencies
async function cacheDependencies() {
  header("Caching Dependencies");

  if (isDeno) {
    try {
      info("Caching imports (this may take a moment)...");

      const { success: cmdSuccess } = await runCommand(["deno", "cache", "--reload", "src/index.ts"], undefined);

      if (cmdSuccess) {
        success("Dependencies cached successfully");
        return true;
      } else {
        error("Failed to cache dependencies");
        return false;
      }
    } catch (err: any) {
      error(`Failed to cache dependencies: ${err.message}`);
      return false;
    }
  } else {
    info("Not running in Deno environment, skipping Deno cache. Run npm install if needed.");
    // For Node.js/Bun, assume dependencies are handled by package manager (npm/yarn/pnpm)
    return true;
  }
}

// Validate project structure
async function validateProjectStructure() {
  header("Validating Project Structure");

  const requiredDirs = ["src", "tests", "docs", "scripts", ".vscode"];
  const requiredFiles = [
    "deno.json",
    "ARCHITECTURE.md",
    "CONTRIBUTING.md",
    "README.md",
  ];

  let allValid = true;

  for (const dir of requiredDirs) {
    try {
      const exists = await fs.exists(dir);
      if (exists) {
        const stat = await fs.stat(dir);
        if (stat.isDirectory) {
          success(`${dir}/ directory found`);
        } else {
          error(`${dir} exists but is not a directory`);
          allValid = false;
        }
      } else {
        warning(`${dir}/ directory not found`);
      }
    } catch (e: any) {
      error(`Error checking directory ${dir}: ${e.message}`);
      allValid = false;
    }
  }

  for (const file of requiredFiles) {
    try {
      if (await fs.exists(file)) {
        success(`${file} found`);
      } else {
        warning(`${file} not found`);
        allValid = false;
      }
    } catch (e: any) {
      error(`Error checking file ${file}: ${e.message}`);
      allValid = false;
    }
  }

  return allValid;
}

// Quick type check
async function quickTypeCheck() {
  header("Running Quick Type Check");

  if (isDeno) {
    try {
      info("Checking TypeScript compilation (Deno)...");

      const { success: cmdSuccess, stderr } = await runCommand(["deno", "check", "src/index.ts"], undefined);

      if (cmdSuccess) {
        success("Type check passed");
        return true;
      } else {
        error("Type check failed");
        info("Run: deno task typecheck");
        console.error(stderr);
        return false;
      }
    } catch (err: any) {
      error(`Type check failed: ${err.message}`);
      return false;
    }
  } else {
    info("Not running in Deno environment, skipping Deno type check.");
    // For Node.js/Bun, assuming `tsc --noEmit` would be run separately or type checking happens in IDE
    return true; // Not critical for Node.js/Bun
  }
}

// Print next steps
function printNextSteps() {
  header("Next Steps");

  log("1. Start the development server:");
  if (isDeno) {
    log("   deno task dev", colors.blue);
  } else {
    log("   npm run dev", colors.blue);
  }

  log("\n2. Visit http://localhost:3000 in your browser");

  log("\n3. Make changes to src/ files");
  log("   Changes will hot-reload automatically");

  log("\n4. Run tests:");
  if (isDeno) {
    log("   deno task test", colors.blue);
  } else {
    log("   npm test", colors.blue);
  }

  log("\n5. Before committing:");
  if (isDeno) {
    log("   deno task fmt     # Format code", colors.blue);
    log("   deno task lint    # Check linting", colors.blue);
    log("   deno task typecheck # Check types", colors.blue);
  } else {
    log("   npm run format    # Format code", colors.blue);
    log("   npm run lint      # Check linting", colors.blue);
    log("   npm run typecheck # Check types", colors.blue);
  }

  log("\n6. Read the docs:");
  log("   CONTRIBUTING.md - Contribution guidelines", colors.blue);
  log("   ARCHITECTURE.md - Project structure", colors.blue);
  log("   docs/            - Full documentation", colors.blue);
}

// Main setup function
async function runSetup() {
  log("\n" + colors.bold + "Veryfront Development Setup" + colors.reset);
  log("============================\n");

  const checks = [
    { name: "Deno Version", fn: checkDenoVersion },
    { name: "Node.js", fn: checkNodeVersion },
    { name: "Project Files", fn: checkDenoJson },
    { name: "Environment", fn: checkEnvFile },
    { name: "Project Structure", fn: validateProjectStructure },
  ];

  let allPassed = true;

  for (const check of checks) {
    try {
      const passed = await check.fn();
      if (!passed && check.name === "Deno Version") {
        allPassed = false;
      }
    } catch (err) {
      error(`Failed to check ${check.name}: ${err.message}`);
      allPassed = false;
    }
  }

  if (!allPassed) {
    error("\nSetup validation failed!");
    log("\nPlease fix the issues above and run setup again.");
    exitProcess(1);
  }

  // Optional steps
  const args = parseArgs(getArgs(), { boolean: ["skip-cache", "skip-check"] });

  if (!args["skip-cache"]) {
    const cachePassed = await cacheDependencies();
    if (!cachePassed) {
      warning("Dependency caching failed but continuing...");
    }
  }

  if (!args["skip-check"]) {
    const checkPassed = await quickTypeCheck();
    if (!checkPassed) {
      warning("Type check failed - see errors above");
    }
  }

  log("\n" + colors.green + "Setup Complete!" + colors.reset);
  printNextSteps();
}

// Run setup
await runSetup();
