/**
 * Ignore patterns for sync - similar to .gitignore
 */
export interface IgnoreChecker {
    /** Check if a path should be ignored */
    isIgnored(relativePath: string): boolean;
    /** Check if a file extension is supported */
    isSupportedExtension(filename: string): boolean;
}
/**
 * Load ignore patterns from .vfignore file
 */
export declare function loadIgnorePatterns(projectPath: string): Promise<string[]>;
/**
 * Create an ignore checker with loaded patterns
 */
export declare function createIgnoreChecker(patterns: string[]): IgnoreChecker;
/**
 * Create default ignore checker (without loading .vfignore)
 */
export declare function createDefaultIgnoreChecker(): IgnoreChecker;
//# sourceMappingURL=ignore.d.ts.map