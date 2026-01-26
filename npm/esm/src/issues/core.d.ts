/**
 * Core CRUD operations for file-based issue tracking
 *
 * Issues are stored as markdown files with YAML frontmatter in the `issues/` directory.
 *
 * @module issues/core
 */
import { type FileSystem } from "../platform/compat/fs.js";
import type { CreateIssueOptions, Issue, IssueMetadata, ListIssuesOptions, ListIssuesResult, UpdateIssueOptions } from "./types.js";
/**
 * Default directory for issues
 */
export declare const ISSUES_DIR = "issues";
/**
 * Parse YAML frontmatter from markdown content
 */
export declare function parseFrontmatter(content: string): {
    frontmatter: string;
    body: string;
} | null;
/**
 * Simple YAML parser for frontmatter (handles our limited schema)
 */
export declare function parseYaml(yaml: string): Record<string, unknown>;
/**
 * Serialize metadata to YAML frontmatter
 */
export declare function serializeYaml(metadata: IssueMetadata): string;
/**
 * Serialize issue to markdown file content
 */
export declare function serializeIssue(issue: Issue): string;
/**
 * Parse issue from markdown file content
 */
export declare function parseIssue(content: string, path: string): Issue | null;
/**
 * Issues manager for a project
 */
export declare class IssuesManager {
    private fs;
    private projectDir;
    private issuesDir;
    constructor(projectDir: string, fs?: FileSystem);
    /**
     * Ensure the issues directory exists
     */
    ensureDir(): Promise<void>;
    /**
     * Get all issue IDs in the project
     */
    listIds(): Promise<string[]>;
    /**
     * Create a new issue
     */
    create(options: CreateIssueOptions): Promise<Issue>;
    /**
     * Get an issue by ID
     */
    get(id: string): Promise<Issue | null>;
    /**
     * Update an existing issue
     */
    update(id: string, options: UpdateIssueOptions): Promise<Issue | null>;
    /**
     * Delete an issue
     */
    delete(id: string): Promise<boolean>;
    /**
     * List issues with filtering and sorting
     */
    list(options?: ListIssuesOptions): Promise<ListIssuesResult>;
    /**
     * Close an issue
     */
    close(id: string): Promise<Issue | null>;
    /**
     * Reopen an issue
     */
    reopen(id: string): Promise<Issue | null>;
    /**
     * Add labels to an issue
     */
    addLabels(id: string, labels: string[]): Promise<Issue | null>;
    /**
     * Remove labels from an issue
     */
    removeLabels(id: string, labels: string[]): Promise<Issue | null>;
}
/**
 * Create an issues manager for a project directory
 */
export declare function createIssuesManager(projectDir: string, fs?: FileSystem): IssuesManager;
//# sourceMappingURL=core.d.ts.map