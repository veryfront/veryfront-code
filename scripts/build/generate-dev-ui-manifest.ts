/**
 * Generates a JSON manifest of all dev-ui files.
 *
 * This allows dev-ui to be embedded in compiled binaries without
 * needing to read from the filesystem at runtime.
 *
 * Usage:
 *   deno run -A scripts/build/generate-dev-ui-manifest.ts
 *   deno run -A scripts/build/generate-dev-ui-manifest.ts --check
 */

import { walk } from "#std/fs/walk";
import { relative } from "#std/path";

interface DevUiManifest {
	version: number;
	files: Record<string, string>; // relativePath -> content
}

async function collectSortedFiles(root: string): Promise<Array<{ path: string }>> {
	const files: Array<{ path: string }> = [];
	for await (
		const file of walk(root, {
			includeDirs: false,
			exts: [".tsx", ".ts"],
		})
	) {
		files.push(file);
	}
	return files.sort((a, b) => relative(root, a.path).localeCompare(relative(root, b.path)));
}

async function generateManifest(): Promise<DevUiManifest> {
	const devUiDir = "./src/server/dev-ui";
	const manifest: DevUiManifest = {
		version: 1,
		files: {},
	};

	for (const file of await collectSortedFiles(devUiDir)) {
		const relativePath = relative(devUiDir, file.path);
		const content = await Deno.readTextFile(file.path);
		manifest.files[relativePath] = content;
	}

	return manifest;
}

const manifest = await generateManifest();
const outputPath = "./src/server/dev-ui/manifest.json";
const output = JSON.stringify(manifest, null, 2);

const fileCount = Object.keys(manifest.files).length;

if (Deno.args.includes("--check")) {
	const existing = await Deno.readTextFile(outputPath).catch(() => null);
	if (existing !== output) {
		console.error(`${outputPath} is stale. Run deno task generate.`);
		Deno.exit(1);
	}

	console.log(`${outputPath} is current.`);
	console.log(`   ${fileCount} dev-ui files embedded`);
} else {
	await Deno.writeTextFile(outputPath, output);
	console.log(`✅ Generated ${outputPath}`);
	console.log(`   ${fileCount} dev-ui files embedded`);
}
