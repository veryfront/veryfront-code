/**
 * Generates a JSON manifest of all dev-ui files.
 *
 * This allows dev-ui to be embedded in compiled binaries without
 * needing to read from the filesystem at runtime.
 *
 * Usage:
 *   deno run -A scripts/generate-dev-ui-manifest.ts
 */

import { walk } from "jsr:@std/fs/walk";
import { relative } from "jsr:@std/path";

interface DevUiManifest {
	version: number;
	files: Record<string, string>; // relativePath -> content
}

async function generateManifest(): Promise<DevUiManifest> {
	const devUiDir = "./src/server/dev-ui";
	const manifest: DevUiManifest = {
		version: 1,
		files: {},
	};

	for await (const file of walk(devUiDir, {
		includeDirs: false,
		exts: [".tsx", ".ts"],
	})) {
		const relativePath = relative(devUiDir, file.path);
		const content = await Deno.readTextFile(file.path);
		manifest.files[relativePath] = content;
	}

	return manifest;
}

const manifest = await generateManifest();
const outputPath = "./src/server/dev-ui/manifest.json";
await Deno.writeTextFile(outputPath, JSON.stringify(manifest, null, 2));

const fileCount = Object.keys(manifest.files).length;

console.log(`✅ Generated ${outputPath}`);
console.log(`   ${fileCount} dev-ui files embedded`);
