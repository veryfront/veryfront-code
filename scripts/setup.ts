#!/usr/bin/env -S deno run --allow-all

/**
 * Veryfront Setup Script
 *
 * This script validates your environment and sets up the project for development.
 * Run: deno task setup
 */

import { parse } from "std/flags/mod.ts";

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

// Check Deno version
async function checkDenoVersion() {
  header("Checking Deno Version");

  const denoVersion = Deno.version.deno;
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
    const command = new Deno.Command("node", {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    });

    const result = await command.output();
    const output = new TextDecoder().decode(result.stdout);
    const version = output.trim();

    success(`Node.js ${version} is installed (optional)`);
    return true;
  } catch {
    info("Node.js not found (optional for Deno projects)");
    return false;
  }
}

// Check if deno.json exists
function checkDenoJson() {
  header("Checking Project Files");

  const denoJsonPath = "deno.json";

  try {
    Deno.statSync(denoJsonPath);
    success("deno.json found");
    return true;
  } catch {
    error("deno.json not found");
    info("Make sure you're in the veryfront root directory");
    return false;
  }
}

// Check if .env file exists
function checkEnvFile() {
  header("Checking Environment Configuration");

  const envPath = ".env";
  const envExamplePath = ".env.example";

  try {
    Deno.statSync(envPath);
    success(".env file found");
    return true;
  } catch {
    warning(".env file not found");

    try {
      Deno.statSync(envExamplePath);
      info(`Run: cp ${envExamplePath} ${envPath}`);
      info("Then edit .env with your configuration");
      return true; // Not critical
    } catch {
      warning(".env.example also not found");
      return true; // Not critical
    }
  }
}

// Cache dependencies
async function cacheDependencies() {
  header("Caching Dependencies");

  try {
    info("Caching imports (this may take a moment)...");

    const command = new Deno.Command("deno", {
      args: ["cache", "--reload", "src/index.ts"],
      stdout: "inherit",
      stderr: "inherit",
    });

    const result = await command.output();

    if (result.success) {
      success("Dependencies cached successfully");
      return true;
    } else {
      error("Failed to cache dependencies");
      return false;
    }
  } catch (err) {
    error(`Failed to cache dependencies: ${err.message}`);
    return false;
  }
}

// Validate project structure
function validateProjectStructure() {
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
      const stat = Deno.statSync(dir);
      if (stat.isDirectory) {
        success(`${dir}/ directory found`);
      } else {
        error(`${dir} exists but is not a directory`);
        allValid = false;
      }
    } catch {
      warning(`${dir}/ directory not found`);
    }
  }

  for (const file of requiredFiles) {
    try {
      Deno.statSync(file);
      success(`${file} found`);
    } catch {
      warning(`${file} not found`);
    }
  }

  return allValid;
}

// Quick type check
async function quickTypeCheck() {
  header("Running Quick Type Check");

  try {
    info("Checking TypeScript compilation...");

    const command = new Deno.Command("deno", {
      args: ["check", "src/index.ts"],
      stdout: "inherit",
      stderr: "inherit",
    });

    const result = await command.output();

    if (result.success) {
      success("Type check passed");
      return true;
    } else {
      error("Type check failed");
      info("Run: deno task typecheck");
      return false;
    }
  } catch (err) {
    error(`Type check failed: ${err.message}`);
    return false;
  }
}

// Print next steps
function printNextSteps() {
  header("Next Steps");

  log("1. Start the development server:");
  log("   deno task dev", colors.blue);

  log("\n2. Visit http://localhost:3000 in your browser");

  log("\n3. Make changes to src/ files");
  log("   Changes will hot-reload automatically");

  log("\n4. Run tests:");
  log("   deno task test", colors.blue);

  log("\n5. Before committing:");
  log("   deno task fmt     # Format code", colors.blue);
  log("   deno task lint    # Check linting", colors.blue);
  log("   deno task typecheck # Check types", colors.blue);

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
    Deno.exit(1);
  }

  // Optional steps
  const args = parse(Deno.args, { boolean: ["skip-cache", "skip-check"] });

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
