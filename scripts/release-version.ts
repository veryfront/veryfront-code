/**
 * Version rewriting for the release task.
 *
 * Kept apart from release.ts so it can be tested without pulling in that
 * module's runtime dependencies.
 */

/**
 * Replace the version in deno.json source text, leaving everything else byte for
 * byte as it was.
 *
 * Re-serialising the parsed object instead reflows the whole file -- it expands
 * inline arrays such as `"dependencies": ["build:npm"]` across several lines --
 * burying the one meaningful line under churn a human then has to revert.
 */
export function bumpDenoJsonVersion(source: string, newVersion: string): string {
	const versionField = /("version"\s*:\s*")[^"]*(")/;
	if (!versionField.test(source)) {
		throw new Error('Could not find a "version" field in deno.json');
	}
	return source.replace(versionField, `$1${newVersion}$2`);
}

/** Resolve a stable release version from either a stable or prerelease source. */
export function getNewVersion(currentVersion: string, type: string): string {
	if (/^\d+\.\d+\.\d+$/.test(type)) {
		return type;
	}

	const currentMatch = currentVersion.match(
		/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
	);
	if (!currentMatch) {
		throw new Error(`Invalid current version format: ${currentVersion}`);
	}

	const major = Number(currentMatch[1]);
	const minor = Number(currentMatch[2]);
	const patch = Number(currentMatch[3]);
	const isPrerelease = currentVersion.includes("-");

	switch (type) {
		case "major":
			return `${major + 1}.0.0`;
		case "minor":
			return `${major}.${minor + 1}.0`;
		case "patch":
			return isPrerelease
				? `${major}.${minor}.${patch}`
				: `${major}.${minor}.${patch + 1}`;
		default:
			throw new Error(`Invalid version argument: ${type}`);
	}
}
