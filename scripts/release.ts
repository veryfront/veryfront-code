/**
 * Release script for Veryfront
 *
 * Usage:
 *   deno task release [version] [flags]
 *
 * Examples:
 *   deno task release patch
 *   deno task release minor
 *   deno task release 1.2.3
 *   deno task release patch --dry-run
 */

/**
 * Release script for Veryfront
 *
 * Usage:
 *   deno task release [version] [flags]
 *
 * Examples:
 *   deno task release patch
 *   deno task release minor
 *   deno task release 1.2.3
 *   deno task release patch --dry-run
 */

import { createFileSystem, FileSystem } from "../src/platform/compat/fs.ts";
import { getArgs, exit } from "../src/platform/compat/process.ts";

// @ts-ignore - Deno global
const isDeno = typeof Deno !== 'undefined';
import { promptUser } from "../src/cli/utils/index.ts";

// Conditional imports for path module
let pathMod: typeof import('node:path') | undefined;
let childProcess: typeof import('node:child_process') | undefined;
let util: typeof import('node:util') | undefined;
let parseArgs: typeof import("mri");

// @ts-ignore - Deno global
if (typeof Deno === 'undefined') {
  pathMod = require('node:path');
  childProcess = require('node:child_process');
  util = require('node:util');
  parseArgs = require("mri");
} else {
  // @ts-ignore - Deno global
  pathMod = await import("jsr:@std/path");
  // @ts-ignore - Deno global
  ({ parseArgs } = await import("jsr:@std/cli/parse-args"));
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

const args = parseArgs(getArgs(), {
	boolean: ["dry-run", "no-test", "no-build", "no-publish", "yes"],
	alias: { d: "dry-run", y: "yes" },
});

const versionArg = args._[0]?.toString();

if (!versionArg) {
	console.error(
		"Error: Please provide a version argument (patch, minor, major, or specific version)",
	);
	exit(1);
}

const DRY_RUN = args["dry-run"];

async function runCommand(cmd: string[], cwd?: string) {
	console.log(`$ ${cmd.join(" ")}`);
	if (DRY_RUN) return;

	if (!cmd[0]) {
		throw new Error("Command cannot be empty");
	}

  if (isDeno) {
    // @ts-ignore - Deno global
    const command = new Deno.Command(cmd[0], {
      args: cmd.slice(1),
      cwd,
      stdout: "inherit",
      stderr: "inherit",
      env: Deno.env.toObject(), // Pass current environment variables
    });
    const status = await command.output();
    if (!status.success) {
      console.error(`Command failed: ${cmd.join(" ")}`);
      exit(1);
    }
  } else if (childProcess && util) {
    // Node.js
    const execFile = util.promisify(childProcess.execFile);
    try {
      await execFile(cmd[0], cmd.slice(1), { cwd, stdio: 'inherit' });
    } catch (error: any) {
      console.error(`Command failed: ${cmd.join(" ")}\n`, error.stderr || error.message);
      exit(1);
    }
  } else {
    throw new Error("Unsupported runtime for command execution.");
  }
}

async function getNewVersion(
	currentVersion: string,
	type: string,
): Promise<string> {
	const parts = currentVersion.split(".").map(Number);
	if (parts.length !== 3 || parts.some(isNaN)) {
		throw new Error(`Invalid current version format: ${currentVersion}`);
	}
	const [major, minor, patch] = parts as [number, number, number];

	if (type === "major") return `${major + 1}.0.0`;
	if (type === "minor") return `${major}.${minor + 1}.0`;
	if (type === "patch") return `${major}.${minor}.${patch + 1}`;

	// Validate specific version
	if (/^\d+\.\d+\.\d+$/.test(type)) {
		return type;
	}

	console.error(`Invalid version argument: ${type}`);
	exit(1);
}

async function updateExampleVersions(newVersion: string) {
	console.log("\n📝 Updating examples versions...");
	const examplesDir = getPath().resolve("examples");

	if (await fs.exists(examplesDir)) {
		for await (const entry of fs.readDir(examplesDir)) {
			if (entry.isDirectory) {
				const packageJsonPath = getPath().join(examplesDir, entry.name, "package.json");
				if (await fs.exists(packageJsonPath)) {
					try {
						const content = await fs.readTextFile(packageJsonPath);
						const json = JSON.parse(content);
						let changed = false;

						if (json.dependencies && json.dependencies.veryfront) {
							json.dependencies.veryfront = `^${newVersion}`;
							changed = true;
						}

						if (json.devDependencies && json.devDependencies.veryfront) {
							json.devDependencies.veryfront = `^${newVersion}`;
							changed = true;
						}

						if (changed) {
							if (DRY_RUN) {
								console.log(`  [DRY RUN] Would update ${entry.name} to ${newVersion}`);
							} else {
								await fs.writeTextFile(
									packageJsonPath,
									JSON.stringify(json, null, 2) + "\n",
								);
								console.log(`  ✓ Updated ${entry.name}`);
							}
						}
					} catch (e) {
						console.warn(`  ⚠ Failed to update ${entry.name}:`, e);
					}
				}
			}
		}
	}
}

async function updateTemplates(newVersion: string) {
	console.log("\n📝 Updating template versions...");
	const filesToUpdate = [
		"src/cli/commands/init/config-generator.ts",
		"src/cli/npm-cli.ts",
	];

	for (const filePath of filesToUpdate) {
		const fullPath = getPath().resolve(filePath);
		if (await fs.exists(fullPath)) {
			try {
				let content = await fs.readTextFile(fullPath);
				const regex1 = /veryfront:\s*"[\^~]?[\d\.]+",/g;
				const regex2 = /"veryfront":\s*"npm:veryfront@[\^~]?[\d\.]+"/g;
				const regex3 = /"veryfront\/":\s*"npm:veryfront@[\^~]?[\d\.]+\/"/g;
				const regex4 = /const VERSION = "[\d\.]+";/;

				let newContent = content;
				if (regex1.test(newContent)) {
					newContent = newContent.replace(regex1, `veryfront: "^${newVersion}",`);
				}
				if (regex2.test(newContent)) {
					newContent = newContent.replace(
						regex2,
						`"veryfront": "npm:veryfront@^${newVersion}"`,
					);
				}
				if (regex3.test(newContent)) {
					newContent = newContent.replace(
						regex3,
						`"veryfront/": "npm:veryfront@^${newVersion}/"`,
					);
				}
				if (regex4.test(newContent)) {
					newContent = newContent.replace(
						regex4,
						`const VERSION = "${newVersion}";`,
					);
				}

				if (newContent !== content) {
					if (DRY_RUN) {
						console.log(`  [DRY RUN] Would update ${filePath}`);
					} else {
						await fs.writeTextFile(fullPath, newContent);
						console.log(`  ✓ Updated ${filePath}`);
					}
				}
			} catch (e) {
				console.warn(`  ⚠ Failed to update ${filePath}:`, e);
			}
		}
	}
}

async function main() {
	const denoJsonPath = getPath().resolve("deno.json");
	const denoJson = JSON.parse(await fs.readTextFile(denoJsonPath));
	const currentVersion = denoJson.version;

	console.log(`Current version: ${currentVersion}`);
	const newVersion = await getNewVersion(currentVersion, versionArg!);
	console.log(`Target version:  ${newVersion}`);

	if (DRY_RUN) {
		console.log("DRY RUN: No changes will be made.");
	} else if (!args.yes) {
		const confirm = await promptUser("Continue? [y/N]");
		if (confirm?.toLowerCase() !== "y") {
			console.log("Aborted.");
			exit(0);
		}
	}

	// 1. Run tests
	if (!args["no-test"]) {
		console.log("\n🧪 Running tests...");
		await runCommand(["deno", "task", "test"]);
	}

	// 2. Update deno.json
	console.log("\n📝 Updating version in deno.json...");
	if (!DRY_RUN) {
		denoJson.version = newVersion;
		await fs.writeTextFile(
			denoJsonPath,
			JSON.stringify(denoJson, null, 2) + "\n",
		);
	}

	// 2.5 Update examples
	await updateExampleVersions(newVersion);

	// 2.6 Update templates
	await updateTemplates(newVersion);

	// 3. Build npm package
	if (!args["no-build"]) {
		console.log("\n📦 Building npm package...");
		// @ts-ignore - Deno global
		if (isDeno) Deno.env.set("VERYFRONT_VERSION", newVersion);
		await runCommand(["deno", "task", "build:npm"]);
	}

	// 4. Publish to npm
	if (!args["no-publish"]) {
		if (DRY_RUN) {
			console.log("\n🚀 [DRY RUN] Would publish to npm");
		} else {
			const response = await promptUser("\n🚀 Publish to npm? [y/N]");
			const shouldPublish = args.yes || response?.toLowerCase() === "y";
			if (shouldPublish) {
				await runCommand(["npm", "publish"], getPath().resolve("npm"));
				console.log(`\n✅ Successfully published veryfront@${newVersion}`);
			} else {
				console.log("\nSkipping publish.");
			}
		}
	}

	console.log("\n✨ Release complete!");
}

main();
