/**
 * Core CRUD operations for file-based issue tracking
 *
 * Issues are stored as markdown files with YAML frontmatter in the `issues/` directory.
 *
 * @module issues/core
 */

import { join, resolve } from "#veryfront/compat/path";
import {
  createFileSystem,
  type FileSystem,
  isAlreadyExistsError,
  isNotFoundError,
} from "#veryfront/platform/compat/fs.ts";
import { INVALID_ARGUMENT, SECURITY_VIOLATION } from "#veryfront/errors";
import type {
  CreateIssueOptions,
  Issue,
  IssueMetadata,
  ListIssuesOptions,
  ListIssuesResult,
  UpdateIssueOptions,
} from "./schemas/index.ts";
import {
  compareIssueDateTimes,
  createIssueSchema,
  generateIssueId,
  getIssuePathSchema,
  ISSUE_PREFIXES,
  issueIdSchema,
  issueSchema,
  isValidIssueId,
  listIssuesSchema,
  MAX_ISSUE_BODY_LENGTH,
  MAX_ISSUE_PATH_LENGTH,
  parseIssueId,
  updateIssueSchema,
  validateMetadata,
} from "./schemas/index.ts";
import { ISSUE_FILE_INVALID, ISSUE_STORAGE_CONFLICT } from "./errors.ts";

/**
 * Default directory for issues
 */
export const ISSUES_DIR = "issues";
/** Maximum JavaScript string length accepted for issue frontmatter. */
export const MAX_ISSUE_FRONTMATTER_LENGTH = 64 * 1024;
/** Maximum UTF-8 byte size accepted for one persisted issue file. */
export const MAX_ISSUE_FILE_BYTES = MAX_ISSUE_BODY_LENGTH * 4 +
  MAX_ISSUE_FRONTMATTER_LENGTH;
const ISSUE_ID_RESERVATIONS_DIR = ".ids";
const ISSUE_ID_RESERVATION_MARKER = "reservation";
const ISSUE_MUTATION_LOCKS_DIR = ".locks";
const MAX_ID_ALLOCATION_ATTEMPTS = 10_000;
const MAX_CANONICAL_ISSUE_TIMESTAMP = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

interface StorageQueue {
  tail: Promise<void>;
  pending: number;
}

const storageQueues = new Map<string, StorageQueue>();

async function withStorageQueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  let queue = storageQueues.get(key);
  if (!queue) {
    queue = { tail: Promise.resolve(), pending: 0 };
    storageQueues.set(key, queue);
  }

  const previous = queue.tail;
  let release!: () => void;
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent;
  });
  queue.tail = previous.then(
    () => current,
    () => current,
  );
  queue.pending++;

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    queue.pending--;
    if (queue.pending === 0 && storageQueues.get(key) === queue) {
      storageQueues.delete(key);
    }
  }
}

/** Parse bounded issue Markdown into its raw frontmatter and exact body text. */
export function parseFrontmatter(content: string): { frontmatter: string; body: string } | null {
  if (content.length > MAX_ISSUE_FILE_BYTES) return null;
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  let body = match[2];

  if (
    !frontmatter ||
    frontmatter.length > MAX_ISSUE_FRONTMATTER_LENGTH ||
    body === undefined
  ) {
    return null;
  }
  if (body.startsWith("\r\n")) body = body.slice(2);
  else if (body.startsWith("\n")) body = body.slice(1);
  if (body.endsWith("\r\n")) body = body.slice(0, -2);
  else if (body.endsWith("\n")) body = body.slice(0, -1);
  return { frontmatter, body };
}

function parseYamlScalar(value: string, lineNumber: number): unknown {
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string") throw new TypeError("Expected a string");
      return parsed;
    } catch (error) {
      throw new SyntaxError(`Invalid double-quoted YAML scalar on line ${lineNumber}`, {
        cause: error,
      });
    }
  }

  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw new SyntaxError(`Unterminated single-quoted YAML scalar on line ${lineNumber}`);
    }
    const contents = value.slice(1, -1);
    let parsed = "";
    for (let index = 0; index < contents.length; index++) {
      const character = contents[index]!;
      if (character !== "'") {
        parsed += character;
        continue;
      }
      if (contents[index + 1] !== "'") {
        throw new SyntaxError(`Invalid single-quoted YAML scalar on line ${lineNumber}`);
      }
      parsed += "'";
      index++;
    }
    return parsed;
  }

  if (value.endsWith('"') || value.endsWith("'")) {
    throw new SyntaxError(`Unmatched YAML quote on line ${lineNumber}`);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return undefined;
  return value;
}

function splitInlineYamlArray(value: string, lineNumber: number): string[] {
  const contents = value.slice(1, -1);
  if (contents.trim() === "") return [];

  const tokens: string[] = [];
  let token = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < contents.length; index++) {
    const character = contents[index]!;
    if (quote === '"') {
      token += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quote = null;
      }
      continue;
    }

    if (quote === "'") {
      token += character;
      if (character === "'" && contents[index + 1] === "'") {
        token += contents[++index]!;
      } else if (character === "'") {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      token += character;
    } else if (character === ",") {
      tokens.push(token.trim());
      token = "";
    } else {
      token += character;
    }
  }

  if (quote !== null || escaped) {
    throw new SyntaxError(`Unterminated quoted array value on line ${lineNumber}`);
  }
  tokens.push(token.trim());
  if (tokens.some((entry) => entry === "")) {
    throw new SyntaxError(`Empty inline array value on line ${lineNumber}`);
  }
  return tokens;
}

/**
 * Parse the bounded YAML subset emitted by this module. Handles only the shapes this
 * module emits: flat `key: value` scalars, `[a, b]` inline arrays, and
 * block arrays (`-` items). Keys may contain letters, digits, `_` and `-`.
 * Values may contain colons (e.g. URLs) since only the first `:` splits the
 * line. Nested maps, multi-line/block scalars, anchors, and quoted keys are
 * NOT supported; use a real YAML parser if the schema grows beyond this.
 */
export function parseYaml(yaml: string): Record<string, unknown> {
  if (yaml.length > MAX_ISSUE_FRONTMATTER_LENGTH) {
    throw new RangeError("Issue frontmatter exceeds its length limit");
  }
  const result: Record<string, unknown> = Object.create(null);
  const lines = yaml.split(/\r?\n/u);

  let arrayKey: string | null = null;
  let arrayValues: string[] = [];

  function flushArray(): void {
    if (arrayKey === null) return;
    result[arrayKey] = arrayValues;
    arrayKey = null;
    arrayValues = [];
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const itemMatch = line.match(/^\s+-\s+(.+)$/u);
    if (itemMatch) {
      if (arrayKey === null) {
        throw new SyntaxError(`Unexpected block array item on line ${lineNumber}`);
      }
      const parsed = parseYamlScalar(itemMatch[1]!.trim(), lineNumber);
      if (typeof parsed !== "string") {
        throw new SyntaxError(
          `Issue frontmatter arrays must contain strings on line ${lineNumber}`,
        );
      }
      arrayValues.push(parsed);
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
    if (!kvMatch) {
      throw new SyntaxError(`Unsupported issue frontmatter syntax on line ${lineNumber}`);
    }

    flushArray();

    const key = kvMatch[1]!;
    const value = kvMatch[2]!;
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new SyntaxError(`Duplicate issue frontmatter key '${key}' on line ${lineNumber}`);
    }

    if (value === "") {
      arrayKey = key;
      arrayValues = [];
      continue;
    }

    if (value.startsWith("[")) {
      if (!value.endsWith("]")) {
        throw new SyntaxError(`Unterminated inline array on line ${lineNumber}`);
      }
      const parsedValues = splitInlineYamlArray(value, lineNumber).map((entry) =>
        parseYamlScalar(entry, lineNumber)
      );
      if (parsedValues.some((entry) => typeof entry !== "string")) {
        throw new SyntaxError(
          `Issue frontmatter arrays must contain strings on line ${lineNumber}`,
        );
      }
      result[key] = parsedValues;
      continue;
    }

    result[key] = parseYamlScalar(value, lineNumber);
  }

  flushArray();
  return result;
}

function serializeYamlString(value: string): string {
  return JSON.stringify(value);
}

/** Validate and serialize issue metadata to the canonical YAML subset. */
export function serializeYaml(metadata: IssueMetadata): string {
  const validated = validateMetadata(metadata);
  const lines: string[] = [];

  lines.push(`id: ${validated.id}`);
  lines.push(`title: ${serializeYamlString(validated.title)}`);
  lines.push(`state: ${validated.state}`);
  lines.push(serializeYamlStringArray("labels", validated.labels));

  if (validated.milestone !== undefined) {
    lines.push(`milestone: ${serializeYamlString(validated.milestone)}`);
  }

  lines.push(serializeYamlStringArray("assignees", validated.assignees));

  lines.push(`created_at: ${validated.created_at}`);
  lines.push(`updated_at: ${validated.updated_at}`);

  return lines.join("\n");
}

function serializeYamlStringArray(field: string, values: string[]): string {
  if (values.length === 0) return `${field}: []`;
  return `${field}: [${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

/** Validate and serialize one issue to canonical bounded Markdown. */
export function serializeIssue(issue: Issue): string {
  const validated = issueSchema.parse(issue);
  const serialized = `---\n${serializeYaml(validated.metadata)}\n---\n\n${validated.body}\n`;
  if (new TextEncoder().encode(serialized).byteLength > MAX_ISSUE_FILE_BYTES) {
    throw new RangeError("Serialized issue exceeds its byte limit");
  }
  return serialized;
}

/** Parse and validate one issue file, returning `null` for invalid content. */
export function parseIssue(content: string, path: string): Issue | null {
  const parsed = parseFrontmatter(content);
  if (!parsed) return null;

  try {
    const metadata = validateMetadata(parseYaml(parsed.frontmatter));
    return issueSchema.parse({ metadata, body: parsed.body, path });
  } catch {
    // expected: invalid or unparseable frontmatter metadata
    return null;
  }
}

function compareIssueIds(left: string, right: string): number {
  const leftId = parseIssueId(left);
  const rightId = parseIssueId(right);
  if (!leftId || !rightId) return left < right ? -1 : left > right ? 1 : 0;

  const prefixComparison = ISSUE_PREFIXES.indexOf(leftId.prefix) -
    ISSUE_PREFIXES.indexOf(rightId.prefix);
  return prefixComparison || leftId.number - rightId.number ||
    (left < right ? -1 : left > right ? 1 : 0);
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function nextUpdatedAt(previous: string): string {
  const previousTime = Date.parse(previous);
  const nextTime = Math.max(Date.now(), previousTime + 1);
  if (nextTime > MAX_CANONICAL_ISSUE_TIMESTAMP) {
    throw ISSUE_STORAGE_CONFLICT.create({
      detail: "Issue updated_at cannot advance beyond the supported four-digit year range",
    });
  }
  return new Date(nextTime).toISOString();
}

/**
 * File-backed issue manager scoped to one project directory.
 *
 * The default filesystem adapters provide atomic file replacement and symlink
 * checks. Successful IDs retain Git-trackable reservation markers. Mutations
 * of the same ID use an atomic directory lock and report a storage conflict
 * rather than silently overwriting a concurrent change.
 */
export class IssuesManager {
  private readonly fs: FileSystem;
  private readonly projectDir: string;
  private readonly issuesDir: string;
  private readonly reservationsDir: string;
  private readonly mutationLocksDir: string;

  constructor(projectDir: string, fs?: FileSystem) {
    const parsedProjectDir = getIssuePathSchema().safeParse(projectDir);
    if (!parsedProjectDir.success || parsedProjectDir.data.trim() === "") {
      throw INVALID_ARGUMENT.create({
        detail:
          "IssuesManager requires a non-empty, bounded project directory without control characters",
      });
    }

    const resolvedProjectDir = resolve(parsedProjectDir.data);
    if (resolvedProjectDir.length > MAX_ISSUE_PATH_LENGTH) {
      throw INVALID_ARGUMENT.create({
        detail: "Resolved issues project directory exceeds its length limit",
      });
    }

    this.projectDir = resolvedProjectDir;
    this.fs = fs ?? createFileSystem();
    this.issuesDir = join(this.projectDir, ISSUES_DIR);
    this.reservationsDir = join(this.issuesDir, ISSUE_ID_RESERVATIONS_DIR);
    this.mutationLocksDir = join(this.issuesDir, ISSUE_MUTATION_LOCKS_DIR);
  }

  private withStorageLock<T>(operation: () => Promise<T>): Promise<T> {
    return withStorageQueue(this.issuesDir, operation);
  }

  private async assertDirectory(path: string, name: string): Promise<void> {
    const info = this.fs.lstat ? await this.fs.lstat(path) : await this.fs.stat(path);
    if (info.isSymlink) {
      throw SECURITY_VIOLATION.create({
        detail: `${name} cannot be a symbolic link`,
      });
    }
    if (!info.isDirectory) {
      throw ISSUE_FILE_INVALID.create({
        detail: `${name} must be a directory`,
      });
    }
  }

  private async issuesDirectoryExists(): Promise<boolean> {
    try {
      await this.assertDirectory(this.issuesDir, "Issues storage");
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  private async ensureMutationLocksDirectoryUnlocked(): Promise<void> {
    try {
      await this.fs.mkdir(this.mutationLocksDir);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
    await this.assertDirectory(this.mutationLocksDir, "Issue mutation lock storage");
  }

  private async withIssueMutationLock<T>(
    id: string,
    missingValue: T,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!await this.issuesDirectoryExists()) return missingValue;
    await this.ensureMutationLocksDirectoryUnlocked();

    const lockPath = join(this.mutationLocksDir, id);
    try {
      await this.fs.mkdir(lockPath);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      throw ISSUE_STORAGE_CONFLICT.create({
        detail: `Issue ${id} is already being modified; retry the operation`,
      });
    }

    let outcome:
      | { readonly ok: true; readonly value: T }
      | { readonly ok: false; readonly error: unknown };
    try {
      outcome = { ok: true, value: await operation() };
    } catch (error) {
      outcome = { ok: false, error };
    }

    try {
      await this.fs.remove(lockPath, { recursive: true });
    } catch (cleanupError) {
      if (!outcome.ok) {
        throw new AggregateError(
          [outcome.error, cleanupError],
          `Issue mutation failed and lock cleanup also failed for ${id}`,
        );
      }
      throw cleanupError;
    }

    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  private async ensureDirUnlocked(): Promise<void> {
    try {
      await this.fs.mkdir(this.issuesDir, { recursive: true });
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
    await this.assertDirectory(this.issuesDir, "Issues storage");

    try {
      await this.fs.mkdir(this.reservationsDir, { recursive: true });
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
    await this.assertDirectory(this.reservationsDir, "Issue ID reservation storage");
  }

  /**
   * Ensure the issues directory exists
   */
  ensureDir(): Promise<void> {
    return this.withStorageLock(() => this.ensureDirUnlocked());
  }

  private async listIdsInDirectory(
    directory: string,
    entryType: "file" | "directory",
  ): Promise<string[]> {
    const ids: string[] = [];
    try {
      const entries = this.fs.readDir(directory);
      for await (const entry of entries) {
        if (entry.isSymlink) continue;

        let id: string;
        if (entryType === "file") {
          if (!entry.isFile || !entry.name.endsWith(".md")) continue;
          id = entry.name.slice(0, -3);
        } else {
          if (!entry.isDirectory) continue;
          id = entry.name;
        }

        if (isValidIssueId(id)) ids.push(id);
      }
    } catch (error) {
      if (isNotFoundError(error)) return [];
      throw error;
    }
    ids.sort(compareIssueIds);
    return ids;
  }

  private async listIdsUnlocked(storageValidated = false): Promise<string[]> {
    if (!storageValidated && !await this.issuesDirectoryExists()) return [];
    return await this.listIdsInDirectory(this.issuesDir, "file");
  }

  private listReservedIdsUnlocked(): Promise<string[]> {
    return this.listIdsInDirectory(this.reservationsDir, "directory");
  }

  /**
   * Get all issue IDs in the project
   */
  listIds(): Promise<string[]> {
    return this.withStorageLock(() => this.listIdsUnlocked());
  }

  private async reserveIssueId(prefix: CreateIssueOptions["prefix"]): Promise<string> {
    const resolvedPrefix = prefix ?? "ISSUE";
    const knownIds = [
      ...await this.listIdsUnlocked(true),
      ...await this.listReservedIdsUnlocked(),
    ];
    let candidate = generateIssueId(resolvedPrefix, knownIds);

    for (let attempt = 0; attempt < MAX_ID_ALLOCATION_ATTEMPTS; attempt++) {
      try {
        await this.fs.mkdir(join(this.reservationsDir, candidate));
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
        candidate = generateIssueId(resolvedPrefix, [candidate]);
        continue;
      }

      try {
        await this.fs.writeTextFile(
          join(this.reservationsDir, candidate, ISSUE_ID_RESERVATION_MARKER),
          `${candidate}\n`,
        );
      } catch (error) {
        return await this.rollbackReservation(candidate, error);
      }

      let targetExists: boolean;
      try {
        targetExists = await this.fs.exists(join(this.issuesDir, `${candidate}.md`));
      } catch (error) {
        return await this.rollbackReservation(candidate, error);
      }
      if (!targetExists) return candidate;
      candidate = generateIssueId(resolvedPrefix, [candidate]);
    }

    throw ISSUE_STORAGE_CONFLICT.create({
      detail: `Could not allocate an issue ID after ${MAX_ID_ALLOCATION_ATTEMPTS} attempts`,
    });
  }

  private async rollbackReservation(id: string, cause: unknown): Promise<never> {
    try {
      await this.fs.remove(join(this.reservationsDir, id), { recursive: true });
    } catch (cleanupError) {
      if (!isNotFoundError(cleanupError)) {
        throw new AggregateError(
          [cause, cleanupError],
          `Issue creation failed and reservation cleanup also failed for ${id}`,
        );
      }
    }
    throw cause;
  }

  private async writeIssueUnlocked(issue: Issue, create: boolean): Promise<void> {
    const target = join(this.projectDir, issue.path);
    const content = serializeIssue(issue);

    if (!this.fs.rename) {
      if (create && await this.fs.exists(target)) {
        throw ISSUE_STORAGE_CONFLICT.create({
          detail: `Issue ${issue.metadata.id} already exists`,
        });
      }
      await this.fs.writeTextFile(target, content);
      return;
    }

    const temporary = join(
      this.issuesDir,
      `.${issue.metadata.id}.${crypto.randomUUID()}.tmp`,
    );
    try {
      await this.fs.writeTextFile(temporary, content);
      if (create && await this.fs.exists(target)) {
        throw ISSUE_STORAGE_CONFLICT.create({
          detail: `Issue ${issue.metadata.id} already exists`,
        });
      }
      await this.fs.rename(temporary, target);
    } catch (error) {
      try {
        await this.fs.remove(temporary);
      } catch (cleanupError) {
        if (!isNotFoundError(cleanupError)) {
          throw new AggregateError(
            [error, cleanupError],
            `Issue write failed and temporary-file cleanup also failed for ${issue.metadata.id}`,
          );
        }
      }
      throw error;
    }
  }

  /**
   * Create a new issue
   */
  create(options: CreateIssueOptions): Promise<Issue> {
    const validated = createIssueSchema.parse(options);
    return this.withStorageLock(async () => {
      await this.ensureDirUnlocked();
      const id = await this.reserveIssueId(validated.prefix);
      const now = new Date().toISOString();

      const metadata: IssueMetadata = {
        id,
        title: validated.title,
        state: "open",
        labels: validated.labels ?? [],
        assignees: validated.assignees ?? [],
        created_at: now,
        updated_at: now,
      };
      if (validated.milestone !== undefined) metadata.milestone = validated.milestone;

      const issuePath = `${ISSUES_DIR}/${id}.md`;
      const issue: Issue = {
        metadata,
        body: validated.body ?? "",
        path: issuePath,
      };

      try {
        await this.writeIssueUnlocked(issue, true);
        return issue;
      } catch (error) {
        return await this.rollbackReservation(id, error);
      }
    });
  }

  private async getUnlocked(id: string, storageValidated = false): Promise<Issue | null> {
    const validatedId = issueIdSchema.parse(id);
    if (!storageValidated && !await this.issuesDirectoryExists()) return null;
    const issuePath = `${ISSUES_DIR}/${validatedId}.md`;
    const storagePath = join(this.projectDir, issuePath);

    if (this.fs.lstat) {
      let info;
      try {
        info = await this.fs.lstat(storagePath);
      } catch (error) {
        if (isNotFoundError(error)) return null;
        throw error;
      }
      if (info.isSymlink) {
        throw SECURITY_VIOLATION.create({
          detail: `Issue ${validatedId} cannot be read through a symbolic link`,
        });
      }
      if (!info.isFile) {
        throw ISSUE_FILE_INVALID.create({
          detail: `Issue ${validatedId} is not a regular file`,
        });
      }
      if (info.size > MAX_ISSUE_FILE_BYTES) {
        throw ISSUE_FILE_INVALID.create({
          detail: `Issue ${validatedId} exceeds its file-size limit`,
        });
      }
    }

    let content: string;
    try {
      content = await this.fs.readTextFile(storagePath);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
    if (
      content.length > MAX_ISSUE_FILE_BYTES ||
      new TextEncoder().encode(content).byteLength > MAX_ISSUE_FILE_BYTES
    ) {
      throw ISSUE_FILE_INVALID.create({
        detail: `Issue ${validatedId} exceeds its file-size limit`,
      });
    }

    const issue = parseIssue(content, issuePath);
    if (!issue || issue.metadata.id !== validatedId) {
      throw ISSUE_FILE_INVALID.create({
        detail: `Issue ${validatedId} has invalid or mismatched frontmatter`,
      });
    }
    return issue;
  }

  /**
   * Get an issue by ID
   */
  get(id: string): Promise<Issue | null> {
    return this.withStorageLock(() => this.getUnlocked(id));
  }

  private async updateUnlocked(
    id: string,
    options: UpdateIssueOptions,
  ): Promise<Issue | null> {
    const validated = updateIssueSchema.parse(options);
    const existing = await this.getUnlocked(id);
    if (!existing) return null;

    const title = validated.title ?? existing.metadata.title;
    const state = validated.state ?? existing.metadata.state;
    const labels = validated.labels ?? existing.metadata.labels;
    const assignees = validated.assignees ?? existing.metadata.assignees;
    const milestone = validated.milestone === undefined
      ? existing.metadata.milestone
      : validated.milestone ?? undefined;
    const body = validated.body ?? existing.body;

    const changed = title !== existing.metadata.title ||
      state !== existing.metadata.state ||
      !equalStrings(labels, existing.metadata.labels) ||
      !equalStrings(assignees, existing.metadata.assignees) ||
      milestone !== existing.metadata.milestone ||
      body !== existing.body;
    if (!changed) return existing;

    const metadata: IssueMetadata = {
      ...existing.metadata,
      title,
      state,
      labels,
      assignees,
      updated_at: nextUpdatedAt(existing.metadata.updated_at),
    };
    if (milestone === undefined) delete metadata.milestone;
    else metadata.milestone = milestone;

    const issue: Issue = {
      metadata,
      body,
      path: existing.path,
    };

    await this.writeIssueUnlocked(issue, false);
    return issue;
  }

  /**
   * Update an existing issue
   */
  update(id: string, options: UpdateIssueOptions): Promise<Issue | null> {
    return this.withStorageLock(() => {
      const validatedId = issueIdSchema.parse(id);
      const validatedOptions = updateIssueSchema.parse(options);
      return this.withIssueMutationLock(
        validatedId,
        null,
        () => this.updateUnlocked(validatedId, validatedOptions),
      );
    });
  }

  /**
   * Delete an issue
   */
  delete(id: string): Promise<boolean> {
    return this.withStorageLock(async () => {
      const validatedId = issueIdSchema.parse(id);
      return await this.withIssueMutationLock(validatedId, false, async () => {
        try {
          await this.fs.remove(join(this.issuesDir, `${validatedId}.md`));
          return true;
        } catch (error) {
          if (isNotFoundError(error)) return false;
          throw error;
        }
      });
    });
  }

  /**
   * List issues with filtering and sorting
   */
  list(options: ListIssuesOptions = {}): Promise<ListIssuesResult> {
    const validated = listIssuesSchema.parse(options);
    return this.withStorageLock(async () => {
      const ids = await this.listIdsUnlocked();
      const issues: Issue[] = [];

      for (const id of ids) {
        if (validated.prefix && !id.startsWith(`${validated.prefix}-`)) continue;

        const issue = await this.getUnlocked(id, true);
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
      const direction = validated.sortDirection === "asc" ? 1 : -1;
      issues.sort((left, right) => {
        let comparison: number;
        if (sortKey === "id") {
          comparison = compareIssueIds(left.metadata.id, right.metadata.id);
        } else {
          const leftDate = sortKey === "updated_at"
            ? left.metadata.updated_at
            : left.metadata.created_at;
          const rightDate = sortKey === "updated_at"
            ? right.metadata.updated_at
            : right.metadata.created_at;
          comparison = compareIssueDateTimes(leftDate, rightDate);
        }
        return direction * (comparison || compareIssueIds(
          left.metadata.id,
          right.metadata.id,
        ));
      });

      const total = issues.length;
      return {
        issues: validated.limit === undefined ? issues : issues.slice(0, validated.limit),
        total,
      };
    });
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
    const validatedId = issueIdSchema.parse(id);
    const validatedLabels = updateIssueSchema.parse({
      labels: [...new Set(labels)],
    }).labels!;
    return this.withStorageLock(async () => {
      return await this.withIssueMutationLock(validatedId, null, async () => {
        const issue = await this.getUnlocked(validatedId, true);
        if (!issue) return null;
        return await this.updateUnlocked(validatedId, {
          labels: [...new Set([...issue.metadata.labels, ...validatedLabels])],
        });
      });
    });
  }

  /**
   * Remove labels from an issue
   */
  async removeLabels(id: string, labels: string[]): Promise<Issue | null> {
    const validatedId = issueIdSchema.parse(id);
    const validatedLabels = updateIssueSchema.parse({
      labels: [...new Set(labels)],
    }).labels!;
    return this.withStorageLock(async () => {
      return await this.withIssueMutationLock(validatedId, null, async () => {
        const issue = await this.getUnlocked(validatedId, true);
        if (!issue) return null;
        return await this.updateUnlocked(validatedId, {
          labels: issue.metadata.labels.filter((label) => !validatedLabels.includes(label)),
        });
      });
    });
  }
}

/** Create a file-backed manager scoped to an absolute or relative project directory. */
export function createIssuesManager(projectDir: string, fs?: FileSystem): IssuesManager {
  return new IssuesManager(projectDir, fs);
}
