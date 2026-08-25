/**
 * Core CRUD operations for file-based issue tracking
 *
 * Issues are stored as markdown files with YAML frontmatter in the `issues/` directory.
 *
 * @module issues/core
 */

import { join } from "#veryfront/compat/path";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import type {
  CreateIssueOptions,
  Issue,
  IssueMetadata,
  ListIssuesOptions,
  ListIssuesResult,
  UpdateIssueOptions,
} from "./schemas/index.ts";
import {
  createIssueSchema,
  generateIssueId,
  ISSUE_ID_PATTERN,
  listIssuesSchema,
  updateIssueSchema,
  validateMetadata,
} from "./schemas/index.ts";

/**
 * Default directory for issues
 */
export const ISSUES_DIR = "issues";

/**
 * Parse YAML frontmatter from markdown content
 */
export function parseFrontmatter(content: string): { frontmatter: string; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  const body = match[2];

  if (!frontmatter || body === undefined) return null;
  return { frontmatter, body: body.trim() };
}

/**
 * Encodes a string as a double-quoted YAML scalar.
 *
 * Backslashes are escaped before quotes, or the backslash introduced by
 * escaping a quote would itself be re-escaped on the next save and the value
 * would drift a little further each time it is written.
 */
function quoteYamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Decodes a YAML scalar, undoing what `quoteYamlString` applies.
 *
 * The two are a matched pair: the serializer escaped quotes while the parser
 * only stripped the surrounding ones, so a quoted title came back carrying the
 * backslashes as literal characters and compounded on every write.
 *
 * Single-quoted values carry no escapes, and an unquoted value is returned as
 * it stands, so hand-edited frontmatter keeps working.
 */
function unquoteYamlString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;

  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || !trimmed.endsWith(quote)) return trimmed;

  const inner = trimmed.slice(1, -1);
  return quote === "'" ? inner : inner.replace(/\\(["\\])/g, "$1");
}

/**
 * Splits an inline YAML array body on the separators between items.
 *
 * Splitting the raw text on every comma tore apart any item that contained
 * one, so a label such as `needs: triage, urgent` came back as two labels.
 */
function splitInlineArray(body: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;

  for (const char of body) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (quote === '"' && char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    // Only an opening quote delimits. An apostrophe inside a plain scalar such
    // as `won't-fix` is an ordinary character, and treating it as a delimiter
    // swallowed the separator that followed it.
    if ((char === '"' || char === "'") && current.trim() === "") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      items.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  items.push(current);

  return items.map(unquoteYamlString).filter(Boolean);
}

/**
 * Minimal YAML parser for issue frontmatter. Handles ONLY the shapes this
 * module emits: flat `key: value` scalars, `[a, b]` inline arrays, and
 * block arrays (`-` items). Keys may contain letters, digits, `_` and `-`.
 * Values may contain colons (e.g. URLs) since only the first `:` splits the
 * line. Nested maps, multi-line/block scalars, anchors, and quoted keys are
 * NOT supported. Use a real YAML parser if the schema grows beyond this.
 */
export function parseYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");

  let currentKey: string | null = null;
  let arrayValues: string[] = [];
  let inArray = false;

  function flushArray(): void {
    if (!inArray || !currentKey) return;
    result[currentKey] = arrayValues;
    arrayValues = [];
    inArray = false;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (/^\s+-\s+/.test(line)) {
      const itemValue = line.replace(/^\s+-\s+/, "").trim();
      arrayValues.push(unquoteYamlString(itemValue));
      continue;
    }

    // Allow hyphens in keys (valid YAML, e.g. "created-at"); only the first
    // colon splits key from value, so colons inside the value are preserved.
    const kvMatch = line.match(/^([\w-]+):\s*(.*)$/);
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
      result[key] = splitInlineArray(value.slice(1, -1));
      continue;
    }

    let cleanValue: unknown = unquoteYamlString(value);
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
  lines.push(`title: ${quoteYamlString(metadata.title)}`);
  lines.push(`state: ${metadata.state}`);
  lines.push(serializeYamlStringArray("labels", metadata.labels));

  if (metadata.milestone) lines.push(`milestone: ${metadata.milestone}`);

  lines.push(serializeYamlStringArray("assignees", metadata.assignees));

  lines.push(`created_at: ${metadata.created_at}`);
  lines.push(`updated_at: ${metadata.updated_at}`);

  return lines.join("\n");
}

function serializeYamlStringArray(field: string, values: string[]): string {
  if (!values.length) return `${field}: []`;
  return `${field}: [${values.map(quoteYamlString).join(", ")}]`;
}

/**
 * Serialize issue to markdown file content
 */
export function serializeIssue(issue: Issue): string {
  return `---\n${serializeYaml(issue.metadata)}\n---\n\n${issue.body}`;
}

/**
 * Parse issue from markdown file content
 */
export function parseIssue(content: string, path: string): Issue | null {
  const parsed = parseFrontmatter(content);
  if (!parsed) return null;

  try {
    const metadata = validateMetadata(parseYaml(parsed.frontmatter));
    return { metadata, body: parsed.body, path };
  } catch {
    // expected: invalid or unparseable frontmatter metadata
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
      // expected: directory doesn't exist yet
    }

    return ids;
  }

  /**
   * Create a new issue
   */
  async create(options: CreateIssueOptions): Promise<Issue> {
    const validated = createIssueSchema.parse(options);
    await this.ensureDir();

    const id = generateIssueId(validated.prefix ?? "ISSUE", await this.listIds());
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

    const issuePath = `${ISSUES_DIR}/${id}.md`;
    const issue: Issue = { metadata, body: validated.body ?? "", path: issuePath };

    await this.fs.writeTextFile(join(this.projectDir, issuePath), serializeIssue(issue));
    return issue;
  }

  /**
   * Get an issue by ID
   */
  async get(id: string): Promise<Issue | null> {
    const issuePath = `${ISSUES_DIR}/${id}.md`;

    try {
      const content = await this.fs.readTextFile(join(this.projectDir, issuePath));
      return parseIssue(content, issuePath);
    } catch {
      // expected: issue file may not exist
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

    if (validated.milestone !== undefined) metadata.milestone = validated.milestone ?? undefined;

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
    const issuePath = `${ISSUES_DIR}/${id}.md`;

    try {
      await this.fs.remove(join(this.projectDir, issuePath));
      return true;
    } catch {
      // expected: issue file may not exist
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
    const sortDirection = validated.sortDirection ?? "desc";

    issues.sort((a, b) => {
      let comparison: number;
      if (sortKey === "id") {
        comparison = a.metadata.id.localeCompare(b.metadata.id);
      } else {
        comparison = String((a.metadata as Record<string, unknown>)[sortKey]).localeCompare(
          String((b.metadata as Record<string, unknown>)[sortKey]),
        );
      }
      return sortDirection === "desc" ? -comparison : comparison;
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

    return this.update(id, { labels: [...new Set([...issue.metadata.labels, ...labels])] });
  }

  /**
   * Remove labels from an issue
   */
  async removeLabels(id: string, labels: string[]): Promise<Issue | null> {
    const issue = await this.get(id);
    if (!issue) return null;

    return this.update(id, { labels: issue.metadata.labels.filter((l) => !labels.includes(l)) });
  }
}

/**
 * Create an issues manager for a project directory
 */
export function createIssuesManager(projectDir: string, fs?: FileSystem): IssuesManager {
  return new IssuesManager(projectDir, fs);
}
