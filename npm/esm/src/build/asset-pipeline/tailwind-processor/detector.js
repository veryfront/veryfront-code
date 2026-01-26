/**
 * Tailwind CSS v4 detection utilities.
 * Uses secure filesystem wrapper to prevent path traversal attacks.
 */
import { join } from "../../../platform/compat/path/index.js";
import { logger } from "../../../utils/index.js";
import { createSecureFs } from "../../../security/index.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
const tailwindV4ImportPattern = /@import\s+["']tailwindcss(?:\/[^"']*)?["']/;
/** Detect if a CSS file uses Tailwind v4 (@import "tailwindcss" syntax) */
export function isTailwindV4File(filePath, projectDir, adapter) {
    return withSpan("build.asset.isTailwindV4File", async () => {
        const secureFs = createSecureFs({
            baseDir: projectDir,
            adapter,
            context: "build",
            throwOnError: false,
        });
        try {
            const content = await secureFs.readFile(filePath);
            return tailwindV4ImportPattern.test(content);
        }
        catch (error) {
            logger.debug(`Failed to check file for Tailwind CSS: ${filePath}`, error);
            return false;
        }
    }, { "tailwind.filePath": filePath });
}
/** Auto-detect content paths for Tailwind class scanning */
export function autoDetectContentPaths(projectDir) {
    return [
        join(projectDir, "app/**/*.{js,ts,jsx,tsx,mdx}"),
        join(projectDir, "pages/**/*.{js,ts,jsx,tsx,mdx}"),
        join(projectDir, "components/**/*.{js,ts,jsx,tsx,mdx}"),
        join(projectDir, "src/**/*.{js,ts,jsx,tsx,mdx}"),
    ];
}
