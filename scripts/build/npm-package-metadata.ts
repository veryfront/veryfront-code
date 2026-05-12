type PackageJson = {
	name?: string;
	version?: string;
	private?: boolean;
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
	overrides?: Record<string, string>;
};

const OPTIONAL_NATIVE_PEERS = {
	"better-sqlite3": ">=9.0.0",
} as const;

const REQUIRED_NPM_OVERRIDES = {
	protobufjs: "8.2.0",
} as const;

export function normalizeNpmPackageMetadata(pkg: PackageJson): PackageJson {
	for (const [name, range] of Object.entries(OPTIONAL_NATIVE_PEERS)) {
		delete pkg.dependencies?.[name];

		pkg.peerDependencies ??= {};
		pkg.peerDependencies[name] = range;

		pkg.peerDependenciesMeta ??= {};
		pkg.peerDependenciesMeta[name] = { optional: true };
	}

	pkg.overrides ??= {};
	for (const [name, version] of Object.entries(REQUIRED_NPM_OVERRIDES)) {
		pkg.overrides[name] = version;
	}

	return pkg;
}
