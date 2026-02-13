/**
 * Generates a JSON manifest of all CLI templates.
 *
 * This allows templates to be embedded in compiled binaries without
 * deno compile trying to analyze them as TypeScript modules.
 *
 * Usage:
 *   deno run -A scripts/generate-templates-manifest.ts
 */

import { walk } from "jsr:@std/fs/walk";
import { relative } from "jsr:@std/path";

interface TemplateManifest {
	version: number;
	templates: Record<string, TemplateEntry>;
}

interface TemplateEntry {
	files: Record<string, string>; // path -> content
}

/**
 * File name mappings for npm publishing compatibility.
 * npm strips dotfiles during publish, so we use underscore prefixes in source.
 */
const FILE_NAME_MAPPINGS: Record<string, string> = {
	_gitignore: ".gitignore",
	_env: ".env",
	"_env.example": ".env.example",
	_npmrc: ".npmrc",
	"_eslintrc.json": ".eslintrc.json",
	_prettierrc: ".prettierrc",
};

function mapFileName(path: string): string {
	const parts = path.split("/");
	const fileName = parts[parts.length - 1] ?? "";
	const mapped = FILE_NAME_MAPPINGS[fileName];
	if (mapped) {
		parts[parts.length - 1] = mapped;
		return parts.join("/");
	}
	return path;
}

async function generateManifest(): Promise<TemplateManifest> {
	const templatesDir = "./cli/templates/files";
	const integrationsDir = "./cli/templates/integrations";
	const manifest: TemplateManifest = {
		version: 1,
		templates: {},
	};

	// Process main templates (minimal, app, blog, etc.)
	for await (const entry of Deno.readDir(templatesDir)) {
		if (!entry.isDirectory) continue;

		const templateName = entry.name;
		const templatePath = `${templatesDir}/${templateName}`;
		const files: Record<string, string> = {};

		for await (const file of walk(templatePath, { includeDirs: false, skip: [/[\/\\](?:\.cache|node_modules)[\/\\]?/] })) {
			const relativePath = relative(templatePath, file.path);
			const mappedPath = mapFileName(relativePath);
			const content = await Deno.readTextFile(file.path);
			files[mappedPath] = content;
		}

		manifest.templates[templateName] = { files };
	}

	// Process integration templates
	for await (const entry of Deno.readDir(integrationsDir)) {
		if (!entry.isDirectory) continue;

		const integrationName = entry.name;
		const integrationPath = `${integrationsDir}/${integrationName}/files`;

		try {
			const stat = await Deno.stat(integrationPath);
			if (!stat.isDirectory) continue;
		} catch {
			continue; // No files directory
		}

		const files: Record<string, string> = {};

		for await (const file of walk(integrationPath, { includeDirs: false, skip: [/[\/\\](?:\.cache|node_modules)[\/\\]?/] })) {
			const relativePath = relative(integrationPath, file.path);
			const mappedPath = mapFileName(relativePath);
			const content = await Deno.readTextFile(file.path);
			files[mappedPath] = content;
		}

		manifest.templates[`integration:${integrationName}`] = { files };
	}

	return manifest;
}

const manifest = await generateManifest();
const outputPath = "./cli/templates/manifest.json";
await Deno.writeTextFile(outputPath, JSON.stringify(manifest, null, 2));

const templateCount = Object.keys(manifest.templates).length;
const fileCount = Object.values(manifest.templates).reduce(
	(sum, t) => sum + Object.keys(t.files).length,
	0,
);

console.log(`✅ Generated ${outputPath}`);
console.log(`   ${templateCount} templates, ${fileCount} files`);
