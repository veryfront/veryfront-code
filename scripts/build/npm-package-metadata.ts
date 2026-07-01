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

const OPTIONAL_NATIVE_PEERS = {
	"better-sqlite3": ">=9.0.0",
} as const;

const OPTIONAL_FEATURE_PEERS = [
	"@kreuzberg/node",
	"@kreuzberg/wasm",
	"@huggingface/transformers",
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
	"just-bash",
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

const REQUIRED_NPM_DEPENDENCY_VERSIONS = {
	"@deno/shim-deno": "0.19.2",
} as const;

export function normalizeNpmPackageMetadata(pkg: PackageJson): PackageJson {
	if (pkg.files) {
		pkg.files = pkg.files.filter((entry) => entry !== "src" && entry !== "/src");
	}

	for (const [name, range] of Object.entries(OPTIONAL_NATIVE_PEERS)) {
		delete pkg.dependencies?.[name];

		pkg.peerDependencies ??= {};
		pkg.peerDependencies[name] = range;

		pkg.peerDependenciesMeta ??= {};
		pkg.peerDependenciesMeta[name] = { optional: true };
	}

	for (const name of OPTIONAL_FEATURE_PEERS) {
		movePackageToOptionalPeer(pkg, name);
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
	pinRequiredDependencyVersions(pkg);

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

function pinRequiredDependencyVersions(pkg: PackageJson): void {
	if (!pkg.dependencies) return;

	for (const [name, version] of Object.entries(REQUIRED_NPM_DEPENDENCY_VERSIONS)) {
		if (name in pkg.dependencies) {
			pkg.dependencies[name] = version;
		}
	}
}

function movePackageToOptionalPeer(pkg: PackageJson, name: string): void {
	const range = pkg.dependencies?.[name] ?? pkg.optionalDependencies?.[name];
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
