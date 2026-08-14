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
