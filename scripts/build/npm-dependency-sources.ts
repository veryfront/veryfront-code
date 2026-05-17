type DenoConfig = {
	imports?: Record<string, string>;
	workspace?: string[];
};

type NpmImport = {
	name: string;
	version: string;
};

export async function readDenoConfigSet(
	rootDir: string,
	rootConfig: DenoConfig,
): Promise<DenoConfig[]> {
	const configs = [rootConfig];
	for (const workspaceEntry of rootConfig.workspace ?? []) {
		const configPath = `${rootDir}/${workspaceEntry.replace(/^\.\//, "")}/deno.json`;
		try {
			configs.push(JSON.parse(await Deno.readTextFile(configPath)));
		} catch (error) {
			if (!(error instanceof Deno.errors.NotFound)) {
				throw error;
			}
		}
	}
	return configs;
}

export function npmDependencyRange(
	configs: DenoConfig[],
	specifier: string,
	rangePrefix: "" | "^" = "^",
): string {
	const target = configs
		.map((config) => config.imports?.[specifier])
		.find((value): value is string => typeof value === "string");
	if (!target) {
		throw new Error(`Missing npm dependency source for "${specifier}" in deno.json imports`);
	}

	const parsed = parseNpmImport(target);
	if (!parsed) {
		throw new Error(`Import "${specifier}" does not resolve to a versioned npm package: ${target}`);
	}

	return `${rangePrefix}${parsed.version}`;
}

export function parseNpmImport(target: string): NpmImport | null {
	if (target.startsWith("npm:")) {
		return parsePackageAndVersion(target.slice("npm:".length));
	}

	if (target.startsWith("https://esm.sh/")) {
		const pathPart = target.replace("https://esm.sh/", "").split("?")[0]!;
		return parsePackageAndVersion(pathPart);
	}

	return null;
}

function parsePackageAndVersion(specifier: string): NpmImport | null {
	const match = specifier.match(/^(@[^/]+\/[^@/]+|[^@/]+)@([^/]+)(?:\/.*)?$/);
	if (!match) return null;

	return {
		name: match[1]!,
		version: match[2]!,
	};
}
