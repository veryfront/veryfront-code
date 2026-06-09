/**
 * Generates a JSON manifest of all CLI templates.
 *
 * This allows templates to be embedded in compiled binaries without
 * deno compile trying to analyze them as TypeScript modules.
 *
 * Usage:
 *   deno run -A scripts/build/generate-templates-manifest.ts
 *   deno run -A scripts/build/generate-templates-manifest.ts --check
 */

import { walk } from "#std/fs/walk";
import { relative } from "#std/path";

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

async function collectSortedDirectoryEntries(path: string): Promise<Deno.DirEntry[]> {
	const entries: Deno.DirEntry[] = [];
	for await (const entry of Deno.readDir(path)) {
		entries.push(entry);
	}
	return entries.sort((a, b) => a.name.localeCompare(b.name));
}

async function collectSortedFiles(root: string): Promise<Array<{ path: string }>> {
	const files: Array<{ path: string }> = [];
	for await (
		const file of walk(root, {
			includeDirs: false,
			skip: [/[\/\\](?:\.cache|node_modules)[\/\\]?/, /CLAUDE\.md$/],
		})
	) {
		files.push(file);
	}
	return files.sort((a, b) => relative(root, a.path).localeCompare(relative(root, b.path)));
}

async function generateManifest(): Promise<TemplateManifest> {
	const templatesDir = "./cli/templates/files";
	const integrationsDir = "./cli/templates/integrations";
	const manifest: TemplateManifest = {
		version: 1,
		templates: {},
	};

	// Process main templates (minimal, app, blog, etc.)
	for (const entry of await collectSortedDirectoryEntries(templatesDir)) {
		if (!entry.isDirectory) continue;

		const templateName = entry.name;
		const templatePath = `${templatesDir}/${templateName}`;
		const files: Record<string, string> = {};

		for (const file of await collectSortedFiles(templatePath)) {
			const relativePath = relative(templatePath, file.path);
			const mappedPath = mapFileName(relativePath);
			const content = await Deno.readTextFile(file.path);
			files[mappedPath] = content;
		}

		manifest.templates[templateName] = { files };
	}

	// Process integration templates
	for (const entry of await collectSortedDirectoryEntries(integrationsDir)) {
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

		for (const file of await collectSortedFiles(integrationPath)) {
			const relativePath = relative(integrationPath, file.path);
			const mappedPath = mapFileName(relativePath);
			const content = await Deno.readTextFile(file.path);
			files[mappedPath] = content;
		}

		if (Object.keys(files).length === 0) continue;

		manifest.templates[`integration:${integrationName}`] = { files };
	}

	// Process ai-rules templates (used by `veryfront install`)
	const aiRulesDir = "./cli/templates/ai-rules";
	for (const entry of await collectSortedDirectoryEntries(aiRulesDir)) {
		if (!entry.isFile || !entry.name.endsWith(".md")) continue;
		const content = await Deno.readTextFile(`${aiRulesDir}/${entry.name}`);
		manifest.templates[`ai-rules:${entry.name}`] = { files: { [entry.name]: content } };
	}

	return manifest;
}

const manifest = await generateManifest();
const outputPath = "./cli/templates/manifest.json";
const output = JSON.stringify(manifest, null, 2) + "\n";

const templateCount = Object.keys(manifest.templates).length;
const fileCount = Object.values(manifest.templates).reduce(
	(sum, t) => sum + Object.keys(t.files).length,
	0,
);

if (Deno.args.includes("--check")) {
	const existing = await Deno.readTextFile(outputPath).catch(() => null);
	if (existing !== output) {
		console.error(`${outputPath} is stale. Run deno task generate.`);
		Deno.exit(1);
	}

	console.log(`${outputPath} is current.`);
	console.log(`   ${templateCount} templates, ${fileCount} files`);
} else {
	await Deno.writeTextFile(outputPath, output);
	console.log(`✅ Generated ${outputPath}`);
	console.log(`   ${templateCount} templates, ${fileCount} files`);
}
