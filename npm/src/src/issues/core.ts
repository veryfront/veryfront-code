/**
 * Core CRUD operations for file-based issue tracking
 *
 * Issues are stored as markdown files with YAML frontmatter in the `issues/` directory.
 *
 * @module issues/core
 */

import { join } from "../../deps/deno.land/std@0.220.0/path/mod.js";
import { createFileSystem, type FileSystem } from "../platform/compat/fs.js";
import type {
  CreateIssueOptions,
  Issue,
  IssueMetadata,
  ListIssuesOptions,
  ListIssuesResult,
  UpdateIssueOptions,
} from "./types.js";
import {
  createIssueSchema,
  generateIssueId,
  ISSUE_ID_PATTERN,
  type IssuePrefix,
  listIssuesSchema,
  updateIssueSchema,
  validateMetadata,
} from "./schema.js";

/**
 * Default directory for issues
 */
export const ISSUES_DIR = "issues";

/**
 * Parse YAML frontmatter from markdown content
 */
export function parseFrontmatter(content: string): { frontmatter: string; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match || !match[1] || match[2] === undefined) return null;

  return { frontmatter: match[1], body: match[2].trim() };
}

/**
 * Simple YAML parser for frontmatter (handles our limited schema)
 */
export function parseYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");

  let currentKey: string | null = null;
  let arrayValues: string[] = [];
  let inArray = false;

  const flushArray = (): void => {
    if (!inArray || !currentKey) return;
    result[currentKey] = arrayValues;
    arrayValues = [];
    inArray = false;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (/^\s+-\s+/.test(line)) {
      const itemValue = line.replace(/^\s+-\s+/, "").trim();
      const cleanValue = itemValue.replace(/^["']|["']$/g, "");
      arrayValues.push(cleanValue);
      continue;
    }

    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (!kvMatch) continue;

    flushArray();

    const key = kvMatch[1];
    const value = kvMatch[2];
    if (!key) continue;

    currentKey = key;

    if (!value || value === "[]") {
      inArray = true;
      arrayValues = [];
      continue;
    }

    if (value.startsWith("[") && value.endsWith("]")) {
      const items = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      result[key] = items;
      continue;
    }

    let cleanValue: unknown = value.replace(/^["']|["']$/g, "");
    if (cleanValue === "true") cleanValue = true;
    else if (cleanValue === "false") cleanValue = false;
    else if (cleanValue === "null" || cleanValue === "~") cleanValue = undefined;

    result[key] = cleanValue;
  }

  flushArray();
  return result;
}

/**
 * Serialize metadata to YAML frontmatter
 */
export function serializeYaml(metadata: IssueMetadata): string {
  const lines: string[] = [];

  lines.push(`id: ${metadata.id}`);
  lines.push(`title: "${metadata.title.replace(/"/g, '\\"')}"`);
  lines.push(`state: ${metadata.state}`);
  lines.push(
    metadata.labels.length > 0
      ? `labels: [${metadata.labels.map((l) => `"${l}"`).join(", ")}]`
      : "labels: []",
  );

  if (metadata.milestone) lines.push(`milestone: ${metadata.milestone}`);

  lines.push(
    metadata.assignees.length > 0
      ? `assignees: [${metadata.assignees.map((a) => `"${a}"`).join(", ")}]`
      : "assignees: []",
  );

  lines.push(`created_at: ${metadata.created_at}`);
  lines.push(`updated_at: ${metadata.updated_at}`);

  return lines.join("\n");
}

/**
 * Serialize issue to markdown file content
 */
export function serializeIssue(issue: Issue): string {
  const yaml = serializeYaml(issue.metadata);
  return `---\n${yaml}\n---\n\n${issue.body}`;
}

/**
 * Parse issue from markdown file content
 */
export function parseIssue(content: string, path: string): Issue | null {
  const parsed = parseFrontmatter(content);
  if (!parsed) return null;

  const rawMetadata = parseYaml(parsed.frontmatter);

  try {
    const metadata = validateMetadata(rawMetadata);
    return { metadata, body: parsed.body, path };
  } catch {
    return null;
  }
}

/**
 * Issues manager for a project
 */
export class IssuesManager {
  private fs: FileSystem;
  private projectDir: string;
  private issuesDir: string;

  constructor(projectDir: string, fs?: FileSystem) {
    this.projectDir = projectDir;
    this.fs = fs ?? createFileSystem();
    this.issuesDir = join(projectDir, ISSUES_DIR);
  }

  /**
   * Ensure the issues directory exists
   */
  async ensureDir(): Promise<void> {
    try {
      await this.fs.mkdir(this.issuesDir, { recursive: true });
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
  }

  /**
   * Get all issue IDs in the project
   */
  async listIds(): Promise<string[]> {
    const ids: string[] = [];

    try {
      const entries = this.fs.readDir(this.issuesDir);
      for await (const entry of entries) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;

        const id = entry.name.replace(/\.md$/, "");
        if (ISSUE_ID_PATTERN.test(id)) ids.push(id);
      }
    } catch {
      // Directory doesn't exist yet
    }

    return ids;
  }

  /**
   * Create a new issue
   */
  async create(options: CreateIssueOptions): Promise<Issue> {
    const validated = createIssueSchema.parse(options);
    await this.ensureDir();

    const existingIds = await this.listIds();
    const id = generateIssueId(validated.prefix as IssuePrefix, existingIds);
    const now = new Date().toISOString();

    const metadata: IssueMetadata = {
      id,
      title: validated.title,
      state: "open",
      labels: validated.labels ?? [],
      milestone: validated.milestone,
      assignees: validated.assignees ?? [],
      created_at: now,
      updated_at: now,
    };

    const path = `${ISSUES_DIR}/${id}.md`;
    const issue: Issue = { metadata, body: validated.body ?? "", path };

    await this.fs.writeTextFile(join(this.projectDir, path), serializeIssue(issue));
    return issue;
  }

  /**
   * Get an issue by ID
   */
  async get(id: string): Promise<Issue | null> {
    const path = `${ISSUES_DIR}/${id}.md`;

    try {
      const content = await this.fs.readTextFile(join(this.projectDir, path));
      return parseIssue(content, path);
    } catch {
      return null;
    }
  }

  /**
   * Update an existing issue
   */
  async update(id: string, options: UpdateIssueOptions): Promise<Issue | null> {
    const validated = updateIssueSchema.parse(options);
    const existing = await this.get(id);
    if (!existing) return null;

    const metadata: IssueMetadata = {
      ...existing.metadata,
      title: validated.title ?? existing.metadata.title,
      state: validated.state ?? existing.metadata.state,
      labels: validated.labels ?? existing.metadata.labels,
      assignees: validated.assignees ?? existing.metadata.assignees,
      updated_at: new Date().toISOString(),
    };

    if (validated.milestone !== undefined) {
      metadata.milestone = validated.milestone ?? undefined;
    }

    const issue: Issue = {
      metadata,
      body: validated.body ?? existing.body,
      path: existing.path,
    };

    await this.fs.writeTextFile(join(this.projectDir, existing.path), serializeIssue(issue));
    return issue;
  }

  /**
   * Delete an issue
   */
  async delete(id: string): Promise<boolean> {
    const path = `${ISSUES_DIR}/${id}.md`;

    try {
      await this.fs.remove(join(this.projectDir, path));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List issues with filtering and sorting
   */
  async list(options: ListIssuesOptions = {}): Promise<ListIssuesResult> {
    const validated = listIssuesSchema.parse(options);
    const ids = await this.listIds();
    const issues: Issue[] = [];

    for (const id of ids) {
      if (validated.prefix && !id.startsWith(`${validated.prefix}-`)) continue;

      const issue = await this.get(id);
      if (!issue) continue;

      if (validated.state && issue.metadata.state !== validated.state) continue;

      if (validated.labels?.length) {
        const hasAllLabels = validated.labels.every((label) =>
          issue.metadata.labels.includes(label)
        );
        if (!hasAllLabels) continue;
      }

      if (validated.milestone && issue.metadata.milestone !== validated.milestone) continue;

      if (validated.assignee && !issue.metadata.assignees.includes(validated.assignee)) continue;

      issues.push(issue);
    }

    const sortKey = validated.sortBy ?? "created_at";
    const sortDir = validated.sortDirection ?? "desc";

    issues.sort((a, b) => {
      const cmp = sortKey === "id"
        ? a.metadata.id.localeCompare(b.metadata.id)
        : String(a.metadata[sortKey]).localeCompare(String(b.metadata[sortKey]));
      return sortDir === "desc" ? -cmp : cmp;
    });

    const total = issues.length;
    const limited = validated.limit ? issues.slice(0, validated.limit) : issues;

    return { issues: limited, total };
  }

  /**
   * Close an issue
   */
  close(id: string): Promise<Issue | null> {
    return this.update(id, { state: "closed" });
  }

  /**
   * Reopen an issue
   */
  reopen(id: string): Promise<Issue | null> {
    return this.update(id, { state: "open" });
  }

  /**
   * Add labels to an issue
   */
  async addLabels(id: string, labels: string[]): Promise<Issue | null> {
    const issue = await this.get(id);
    if (!issue) return null;

    const newLabels = [...new Set([...issue.metadata.labels, ...labels])];
    return this.update(id, { labels: newLabels });
  }

  /**
   * Remove labels from an issue
   */
  async removeLabels(id: string, labels: string[]): Promise<Issue | null> {
    const issue = await this.get(id);
    if (!issue) return null;

    const newLabels = issue.metadata.labels.filter((l) => !labels.includes(l));
    return this.update(id, { labels: newLabels });
  }
}

/**
 * Create an issues manager for a project directory
 */
export function createIssuesManager(projectDir: string, fs?: FileSystem): IssuesManager {
  return new IssuesManager(projectDir, fs);
}
