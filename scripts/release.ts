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

import { createFileSystem } from "../src/platform/compat/fs.ts";
import { exit, getArgs } from "../src/platform/compat/process.ts";
import { promptUser } from "../src/cli/utils/index.ts";

type PathModule = {
  resolve: (...paths: string[]) => string;
  join: (...paths: string[]) => string;
};

type ParseArgsFn = (
  args: string[],
  options?: Record<string, unknown>,
) => { _: Array<string | number>; [key: string]: unknown };

type ChildProcessModule = {
  spawn: (
    command: string,
    args?: string[],
    options?: Record<string, unknown>,
  ) => { on: (event: string, listener: (...args: unknown[]) => void) => void };
};

const isDenoRuntime = typeof Deno !== "undefined";

let pathMod: PathModule | null = null;
let childProcess: ChildProcessModule | null = null;
let parseArgsFn: ParseArgsFn | null = null;
let args: ReturnType<ParseArgsFn>;
let versionArg: string | null = null;
let DRY_RUN = false;

async function loadDeps(): Promise<void> {
  if (isDenoRuntime) {
    const pathModule = await import("jsr:@std/path");
    const { parseArgs } = await import("jsr:@std/cli/parse-args");
    pathMod = pathModule;
    parseArgsFn = parseArgs as ParseArgsFn;
    return;
  }

  const [pathModule, childProcessModule, mriModule] = await Promise.all([
    import("node:path"),
    import("node:child_process"),
    import("mri"),
  ]);

  pathMod = pathModule;
  childProcess = childProcessModule as ChildProcessModule;
  parseArgsFn = (mriModule as { default?: ParseArgsFn }).default ?? (mriModule as ParseArgsFn);
}

function getPath(): PathModule {
  if (!pathMod) {
    throw new Error("Path module not initialized");
  }
  return pathMod;
}

const fs = createFileSystem();

async function runCommand(cmd: string[], cwd?: string) {
	console.log(`$ ${cmd.join(" ")}`);
	if (DRY_RUN) return;

	if (!cmd[0]) {
		throw new Error("Command cannot be empty");
	}

  if (isDenoRuntime) {
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
  } else if (childProcess) {
    // Node.js
    await new Promise<void>((resolve, reject) => {
      const child = childProcess.spawn(cmd[0], cmd.slice(1), {
        cwd,
        stdio: "inherit",
      });
      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });
    }).catch((error) => {
      console.error(`Command failed: ${cmd.join(" ")}\n`, error.message ?? error);
      exit(1);
    });
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
		"src/core/utils/constants/cdn.ts",
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
				const regex5 = /VERYFRONT_VERSION = "[\d\.]+";/;

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
				if (regex5.test(newContent)) {
					newContent = newContent.replace(
						regex5,
						`VERYFRONT_VERSION = "${newVersion}";`,
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

async function runRelease() {
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
		if (isDenoRuntime) Deno.env.set("VERYFRONT_VERSION", newVersion);
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

async function main() {
	await loadDeps();

	if (!parseArgsFn) {
		throw new Error("Argument parser not initialized");
	}

	args = parseArgsFn(getArgs(), {
		boolean: ["dry-run", "no-test", "no-build", "no-publish", "yes"],
		alias: { d: "dry-run", y: "yes" },
	});

	versionArg = args._[0]?.toString() ?? null;

	if (!versionArg) {
		console.error(
			"Error: Please provide a version argument (patch, minor, major, or specific version)",
		);
		exit(1);
	}

	DRY_RUN = Boolean(args["dry-run"]);

	await runRelease();
}

if (import.meta.main) {
	main().catch((error) => {
		console.error("Release script failed:", error);
		exit(1);
	});
}
