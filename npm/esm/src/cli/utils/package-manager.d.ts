/**
 * Package manager detection and installation utilities
 * Uses cross-runtime platform abstractions.
 * @module cli/utils/package-manager
 */
export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";
/**
 * Detect the package manager to use based on lockfiles or user preference
 *
 * Priority:
 * 1. Explicit preference (if provided)
 * 2. Existing lockfile in project directory
 * 3. Parent directory lockfile (for monorepos)
 * 4. Default to npm
 */
export declare function detectPackageManager(projectDir: string, preference?: PackageManager): Promise<PackageManager>;
/**
 * Get the install command for a package manager
 */
export declare function getInstallCommand(pm: PackageManager): string;
/**
 * Install dependencies using the detected package manager
 *
 * @param projectDir - Directory to install dependencies in
 * @param options - Installation options
 * @returns true if installation succeeded, false otherwise
 */
export declare function installDependencies(projectDir: string, options?: {
    packageManager?: PackageManager;
    silent?: boolean;
}): Promise<boolean>;
//# sourceMappingURL=package-manager.d.ts.map