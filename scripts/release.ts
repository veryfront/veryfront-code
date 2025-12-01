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

import { parseArgs } from "jsr:@std/cli/parse-args";
import { resolve } from "jsr:@std/path";

const args = parseArgs(Deno.args, {
	boolean: ["dry-run", "no-test", "no-build", "no-publish", "yes"],
	alias: { d: "dry-run", y: "yes" },
});

const versionArg = args._[0]?.toString();

if (!versionArg) {
	console.error(
		"Error: Please provide a version argument (patch, minor, major, or specific version)",
	);
	Deno.exit(1);
}

const DRY_RUN = args["dry-run"];

async function runCommand(cmd: string[], cwd?: string) {
	console.log(`$ ${cmd.join(" ")}`);
	if (DRY_RUN) return;

	if (!cmd[0]) {
		throw new Error("Command cannot be empty");
	}

	const command = new Deno.Command(cmd[0], {
		args: cmd.slice(1),
		cwd,
		stdout: "inherit",
		stderr: "inherit",
	});

	const status = await command.output();
	if (!status.success) {
		console.error(`Command failed: ${cmd.join(" ")}`);
		Deno.exit(1);
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
	Deno.exit(1);
}

async function main() {
	const denoJsonPath = resolve("deno.json");
	const denoJson = JSON.parse(await Deno.readTextFile(denoJsonPath));
	const currentVersion = denoJson.version;

	console.log(`Current version: ${currentVersion}`);
	const newVersion = await getNewVersion(currentVersion, versionArg!);
	console.log(`Target version:  ${newVersion}`);

	if (DRY_RUN) {
		console.log("DRY RUN: No changes will be made.");
	} else if (!args.yes) {
		const confirm = prompt("Continue? [y/N]");
		if (confirm?.toLowerCase() !== "y") {
			console.log("Aborted.");
			Deno.exit(0);
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
		await Deno.writeTextFile(
			denoJsonPath,
			JSON.stringify(denoJson, null, 2) + "\n",
		);
	}

	// 3. Build npm package
	if (!args["no-build"]) {
		console.log("\n📦 Building npm package...");
		await runCommand(["deno", "task", "build:npm"]);
	}

	// 4. Publish to npm
	if (!args["no-publish"]) {
		if (DRY_RUN) {
			console.log("\n🚀 [DRY RUN] Would publish to npm");
		} else {
			const shouldPublish =
				args.yes || prompt("\n🚀 Publish to npm? [y/N]")?.toLowerCase() === "y";
			if (shouldPublish) {
				await runCommand(["npm", "publish"], resolve("npm"));
				console.log(`\n✅ Successfully published veryfront@${newVersion}`);
			} else {
				console.log("\nSkipping publish.");
			}
		}
	}

	console.log("\n✨ Release complete!");
}

main();
