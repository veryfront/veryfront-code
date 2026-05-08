type PackageJson = {
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

const OPTIONAL_NATIVE_PEERS = {
	"better-sqlite3": ">=9.0.0",
} as const;

export function normalizeNpmPackageMetadata(pkg: PackageJson): PackageJson {
	for (const [name, range] of Object.entries(OPTIONAL_NATIVE_PEERS)) {
		delete pkg.dependencies?.[name];

		pkg.peerDependencies ??= {};
		pkg.peerDependencies[name] = range;

		pkg.peerDependenciesMeta ??= {};
		pkg.peerDependenciesMeta[name] = { optional: true };
	}

	return pkg;
}
