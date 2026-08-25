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
] as const;

// Opaque imports (src/platform/compat/opaque-deps.ts) are invisible to dnt, so
// their packages never appear in the generated dependencies. Without this
// fallback the optional-peer move silently skips them and the published
// package.json omits the dependency entirely.
const ROOT_OPTIONAL_RUNTIME_PEER_FALLBACK_RANGES: Record<string, string> = {
	"@huggingface/transformers": `^${OPAQUE_DEPENDENCY_VERSIONS["@huggingface/transformers"]}`,
};

/**
 * CLI-only first-party extensions that must not land in a library consumer's
 * dependency tree.
 *
 * @veryfront/ext-content-mdx drags @mdx-js/mdx -> @types/mdx@2.0.14, and that
 * file references the *global* JSX namespace that @types/react@19 no longer
 * declares. Because tsc auto-includes everything under node_modules/@types,
 * `npm install veryfront` broke a previously-clean `tsc --noEmit` in any
 * consumer project without skipLibCheck, naming a package the developer never
 * imported. It is also roughly 45% of the installed tree.
 *
 * `optionalDependencies` is not the right home: npm installs optional
 * dependencies by default and only tolerates their *installation failure*, so
 * @types/mdx would still be there. An optional peer is the only declaration npm
 * leaves uninstalled, which is why this reuses movePackageToOptionalPeer.
 *
 * The compiled binary is unaffected — scripts/build/compile-binary.ts embeds
 * extensions/ext-content-mdx/src/index.ts as a compile-time include, with no
 * reference to npm dependency metadata. For `npx veryfront dev`, MDX becomes
 * opt-in: cli/shared/ensure-content-processor.ts tolerates the missing package
 * so the server still starts, and the ContentProcessor compile path reports the
 * actionable install message when an .mdx/.md file is actually rendered.
 */
export const ROOT_OPTIONAL_EXTENSION_PEERS = [
	"@veryfront/ext-content-mdx",
] as const;

export const EXTENSION_OWNED_DEPENDENCIES = [
	"@aws-sdk/client-s3",
	"@aws-sdk/lib-storage",
	"@babel/generator",
	"@babel/parser",
	"@babel/traverse",
	"@babel/types",
	"@swc/wasm",
	"@types/better-sqlite3",
	"@types/hast",
	"@types/mdast",
	"@types/unist",
	"@types/ws",
	"better-sqlite3",
	"brace-expansion",
	"@kreuzberg/node",
	"@kreuzberg/wasm",
	"@mdx-js/mdx",
	"@mdx-js/react",
	"@opentelemetry/api",
	"@opentelemetry/api-logs",
	"@opentelemetry/auto-instrumentations-node",
	"@opentelemetry/context-async-hooks",
	"@opentelemetry/core",
	"@opentelemetry/exporter-logs-otlp-http",
	"@opentelemetry/exporter-metrics-otlp-http",
	"@opentelemetry/exporter-trace-otlp-http",
	"@opentelemetry/resources",
	"@opentelemetry/sdk-logs",
	"@opentelemetry/sdk-metrics",
	"@opentelemetry/sdk-node",
	"@opentelemetry/sdk-trace-base",
	"@opentelemetry/semantic-conventions",
	"@redis/client",
	"redis",
	"reflect-metadata",
	"@sentry/deno",
	"@sentry/node",
	"@tailwindcss/forms",
	"@tailwindcss/typography",
	"ai",
	"bash-tool",
	"browserslist",
	"daisyui",
	"es-module-lexer",
	"jszip",
	"pdf-lib",
	"esbuild",
	"gaxios",
	"gcp-metadata",
	"github-slugger",
	"jose",
	"just-bash",
	"lightningcss",
	"mdast-util-to-string",
	"protobufjs",
	"purgecss",
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
	"sharp",
	"tailwind-scrollbar-hide",
	"tailwindcss",
	"tailwindcss-animate",
	"unified",
	"unist-util-visit",
	"vfile",
	"ws",
	"yaml",
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

	for (const name of [...ROOT_OPTIONAL_RUNTIME_PEERS, ...ROOT_OPTIONAL_EXTENSION_PEERS]) {
		movePackageToOptionalPeer(pkg, name);
	}

	for (const name of EXTENSION_OWNED_DEPENDENCIES) {
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
