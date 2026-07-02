type PackageJson = {
	name?: string;
	version?: string;
	private?: boolean;
	files?: string[];
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
	devDependencies?: Record<string, string>;
	overrides?: Record<string, string>;
};

import { OPAQUE_DEPENDENCY_VERSIONS } from "../../src/platform/compat/opaque-dependency-versions.ts";

export const ROOT_OPTIONAL_RUNTIME_PEERS = [
	"@huggingface/transformers",
	"redis",
] as const;

// Opaque imports (src/platform/compat/opaque-deps.ts) are invisible to dnt, so
// their packages never appear in the generated dependencies. Without this
// fallback the optional-peer move silently skips them and the published
// package.json omits the dependency entirely.
const ROOT_OPTIONAL_RUNTIME_PEER_FALLBACK_RANGES: Record<string, string> = {
	"@huggingface/transformers": `^${OPAQUE_DEPENDENCY_VERSIONS["@huggingface/transformers"]}`,
};

export const EXTENSION_OWNED_DEPENDENCIES = [
	"@babel/generator",
	"@babel/parser",
	"@babel/traverse",
	"@babel/types",
	"@types/better-sqlite3",
	"@types/hast",
	"@types/mdast",
	"@types/unist",
	"better-sqlite3",
	"@kreuzberg/node",
	"@kreuzberg/wasm",
	"@mdx-js/mdx",
	"@mdx-js/react",
	"@opentelemetry/api",
	"@opentelemetry/auto-instrumentations-node",
	"@opentelemetry/context-async-hooks",
	"@opentelemetry/core",
	"@opentelemetry/exporter-metrics-otlp-http",
	"@opentelemetry/exporter-trace-otlp-http",
	"@opentelemetry/resources",
	"@opentelemetry/sdk-metrics",
	"@opentelemetry/sdk-node",
	"@opentelemetry/sdk-trace-base",
	"@opentelemetry/semantic-conventions",
	"bash-tool",
	"es-module-lexer",
	"esbuild",
	"github-slugger",
	"jose",
	"just-bash",
	"mdast-util-to-string",
	"rehype-highlight",
	"rehype-raw",
	"rehype-sanitize",
	"rehype-slug",
	"rehype-starry-night",
	"rehype-stringify",
	"remark-frontmatter",
	"remark-gfm",
	"remark-parse",
	"remark-rehype",
	"tailwindcss",
	"unified",
	"unist-util-visit",
	"vfile",
] as const;

const STALE_DIRECT_DEPENDENCIES = [
	"ai",
] as const;

const STALE_DEV_DEPENDENCIES = [
	"@types/better-sqlite3",
	"@types/mime-types",
	"@types/ws",
] as const;

const REQUIRED_NPM_OVERRIDES = {
	protobufjs: "8.6.5",
} as const;

export function normalizeNpmPackageMetadata(pkg: PackageJson): PackageJson {
	if (pkg.files) {
		pkg.files = pkg.files.filter((entry) => entry !== "src" && entry !== "/src");
	}

	for (const name of ROOT_OPTIONAL_RUNTIME_PEERS) {
		movePackageToOptionalPeer(pkg, name);
	}

	for (const name of EXTENSION_OWNED_DEPENDENCIES) {
		delete pkg.dependencies?.[name];
		delete pkg.optionalDependencies?.[name];
	}

	for (const name of STALE_DIRECT_DEPENDENCIES) {
		delete pkg.dependencies?.[name];
		delete pkg.optionalDependencies?.[name];
	}

	for (const name of STALE_DEV_DEPENDENCIES) {
		delete pkg.devDependencies?.[name];
	}

	deleteIfEmpty(pkg, "dependencies");
	deleteIfEmpty(pkg, "optionalDependencies");

	pkg.overrides ??= {};
	for (const [name, version] of Object.entries(REQUIRED_NPM_OVERRIDES)) {
		pkg.overrides[name] = version;
	}

	pinAutomaticDependencyRanges(pkg);

	return pkg;
}

function pinAutomaticDependencyRanges(pkg: PackageJson): void {
	for (const key of ["dependencies", "optionalDependencies", "devDependencies"] as const) {
		const dependencies = pkg[key];
		if (!dependencies) continue;

		for (const [name, range] of Object.entries(dependencies)) {
			dependencies[name] = stripLeadingRangeOperator(range);
		}
	}
}

function stripLeadingRangeOperator(range: string): string {
	return range.replace(/^[\^~]/, "");
}

function movePackageToOptionalPeer(pkg: PackageJson, name: string): void {
	const range = pkg.dependencies?.[name] ?? pkg.optionalDependencies?.[name] ??
		ROOT_OPTIONAL_RUNTIME_PEER_FALLBACK_RANGES[name];
	if (!range) return;

	delete pkg.dependencies?.[name];
	delete pkg.optionalDependencies?.[name];

	pkg.peerDependencies ??= {};
	pkg.peerDependencies[name] = range;

	pkg.peerDependenciesMeta ??= {};
	pkg.peerDependenciesMeta[name] = { optional: true };
}

function deleteIfEmpty(
	pkg: PackageJson,
	key: "dependencies" | "optionalDependencies",
): void {
	if (pkg[key] && Object.keys(pkg[key]).length === 0) {
		delete pkg[key];
	}
}
