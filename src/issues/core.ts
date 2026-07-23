/**
 * Core CRUD operations for file-based issue tracking.
 *
 * Issues are stored as Markdown files with YAML frontmatter in the `issues/`
 * directory. Writes use same-directory temporary files and atomic rename.
 *
 * @module issues/core
 */

import { parse as parseStandardYaml } from "@std/yaml/parse";
import { isAbsolute, join, relative, sep } from "#veryfront/compat/path";
import {
  createFileSystem,
  type FileSystem,
  isAlreadyExistsError,
  isNotFoundError,
} from "#veryfront/platform/compat/fs.ts";
import {
  INPUT_VALIDATION_FAILED,
  NOT_SUPPORTED,
  SECURITY_VIOLATION,
} from "#veryfront/errors/error-registry/general.ts";
import type {
  CreateIssueOptions,
  Issue,
  IssueMetadata,
  IssuePrefix,
  ListIssuesOptions,
  ListIssuesResult,
  UpdateIssueOptions,
} from "./schemas/index.ts";
import { ISSUES_DIR } from "./constants.ts";
import {
  createIssueSchema,
  generateIssueId,
  ISSUE_STORAGE_LIMITS,
  issueIdSchema,
  issueSchema,
  isValidIssueId,
  listIssuesSchema,
  parseIssueId,
  updateIssueSchema,
  validateMetadata,
} from "./schemas/index.ts";

export { ISSUES_DIR } from "./constants.ts";

const ISSUE_RESERVATIONS_DIR = ".ids";
const UTF8_ENCODER = new TextEncoder();
const FRONTMATTER_OPEN_PATTERN = /^---\r?\n/;
const FRONTMATTER_CLOSE_PATTERN = /(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/g;
const YAML_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_YAML_FIELDS = 64;
interface IssueMutationQueue {
  tail: Promise<void>;
  pending: number;
}

const ISSUE_MUTATION_QUEUES = new Map<string, IssueMutationQueue>();

async function runSerializedIssueMutation<T>(key: string, operation: () => Promise<T>): Promise<T> {
  let queue = ISSUE_MUTATION_QUEUES.get(key);
  if (!queue) {
    if (ISSUE_MUTATION_QUEUES.size >= ISSUE_STORAGE_LIMITS.maxIssues) {
      throw new RangeError("Concurrent issue mutation key limit exceeded");
    }
    queue = { tail: Promise.resolve(), pending: 0 };
    ISSUE_MUTATION_QUEUES.set(key, queue);
  }
  if (queue.pending >= ISSUE_STORAGE_LIMITS.maxPendingMutationsPerIssue) {
    throw new RangeError("Concurrent issue mutation queue limit exceeded");
  }

  const previous = queue.tail;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  queue.tail = previous.then(() => gate);
  queue.pending++;

  await previous;
  try {
    return await operation();
  } finally {
    release();
    queue.pending--;
    if (queue.pending === 0 && ISSUE_MUTATION_QUEUES.get(key) === queue) {
      ISSUE_MUTATION_QUEUES.delete(key);
    }
  }
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function nextUpdatedAt(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function assertUtf8Limit(value: string, maximumBytes: number, name: string): void {
  if (value.length > maximumBytes || utf8ByteLength(value) > maximumBytes) {
    throw new RangeError(`${name} exceeds the supported size limit`);
  }
}

function compareIssueIds(leftId: string, rightId: string): number {
  const left = parseIssueId(leftId)!;
  const right = parseIssueId(rightId)!;
  return left.prefix.localeCompare(right.prefix) || left.number - right.number;
}

function compareIssues(
  left: Issue,
  right: Issue,
  sortKey: NonNullable<ListIssuesOptions["sortBy"]>,
  sortDirection: NonNullable<ListIssuesOptions["sortDirection"]>,
): number {
  let comparison: number;
  if (sortKey === "id") {
    comparison = compareIssueIds(left.metadata.id, right.metadata.id);
  } else {
    comparison = left.metadata[sortKey].localeCompare(right.metadata[sortKey]);
    if (comparison === 0) comparison = compareIssueIds(left.metadata.id, right.metadata.id);
  }
  return sortDirection === "desc" ? -comparison : comparison;
}

function findIssueInsertionIndex(
  issues: readonly Issue[],
  candidate: Issue,
  compare: (left: Issue, right: Issue) => number,
): number {
  let low = 0;
  let high = issues.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (compare(issues[middle]!, candidate) <= 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

function serializedIssueByteLength(issue: Issue): number {
  return utf8ByteLength(JSON.stringify(issue));
}

/** Extract bounded YAML frontmatter and preserve the Markdown body exactly. */
export function parseFrontmatter(content: string): { frontmatter: string; body: string } | null {
  if (typeof content !== "string") {
    throw new TypeError("Issue content must be a string");
  }
  assertUtf8Limit(content, ISSUE_STORAGE_LIMITS.maxFileBytes, "Issue file");

  const normalized = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const opening = FRONTMATTER_OPEN_PATTERN.exec(normalized);
  if (!opening) return null;

  const afterOpening = normalized.slice(opening[0].length);
  FRONTMATTER_CLOSE_PATTERN.lastIndex = 0;
  const closing = FRONTMATTER_CLOSE_PATTERN.exec(afterOpening);
  if (!closing) return null;

  const frontmatter = afterOpening.slice(0, closing.index).replace(/\r\n/g, "\n");
  if (!frontmatter) return null;
  assertUtf8Limit(
    frontmatter,
    ISSUE_STORAGE_LIMITS.maxFrontmatterBytes,
    "Issue frontmatter",
  );

  let body = afterOpening.slice(closing.index + closing[0].length);
  if (body.startsWith("\r\n")) body = body.slice(2);
  else if (body.startsWith("\n")) body = body.slice(1);
  return { frontmatter, body };
}

function normalizeYamlValue(value: unknown): unknown {
  if (value === null) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (Array.isArray(value)) {
    if (value.length > ISSUE_STORAGE_LIMITS.maxLabels + ISSUE_STORAGE_LIMITS.maxAssignees) {
      throw new RangeError("Issue YAML array exceeds the supported limit");
    }
    return value.map((entry) => {
      if (
        entry === null ||
        (typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean")
      ) {
        throw new TypeError("Issue YAML arrays must contain scalar values");
      }
      return entry;
    });
  }
  if (
    typeof value === "string" || typeof value === "number" ||
    typeof value === "boolean" || value === undefined
  ) {
    return value;
  }
  throw new TypeError("Issue YAML values must be scalar values or arrays");
}

/** Parse one bounded, flat issue-frontmatter YAML mapping. */
export function parseYaml(yaml: string): Record<string, unknown> {
  if (typeof yaml !== "string") throw new TypeError("Issue YAML must be a string");
  assertUtf8Limit(yaml, ISSUE_STORAGE_LIMITS.maxFrontmatterBytes, "Issue frontmatter");

  const parsed = parseStandardYaml(yaml);
  if (parsed === null || parsed === undefined) return Object.create(null);
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Issue frontmatter must be a YAML mapping");
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > MAX_YAML_FIELDS) {
    throw new RangeError("Issue frontmatter field count exceeds the supported limit");
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, value] of entries) {
    if (!YAML_KEY_PATTERN.test(key)) {
      throw new TypeError("Issue frontmatter contains an invalid key");
    }
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: normalizeYamlValue(value),
    });
  }
  return result;
}

/** Serialize validated issue metadata as a flat YAML mapping. */
export function serializeYaml(metadata: IssueMetadata): string {
  const validated = validateMetadata(metadata);
  const lines: string[] = [
    `id: ${validated.id}`,
    `title: ${JSON.stringify(validated.title)}`,
    `state: ${validated.state}`,
    serializeYamlStringArray("labels", validated.labels),
  ];

  if (validated.milestone !== undefined) {
    lines.push(`milestone: ${JSON.stringify(validated.milestone)}`);
  }
  lines.push(serializeYamlStringArray("assignees", validated.assignees));
  lines.push(`created_at: ${JSON.stringify(validated.created_at)}`);
  lines.push(`updated_at: ${JSON.stringify(validated.updated_at)}`);
  return lines.join("\n");
}

function serializeYamlStringArray(field: string, values: string[]): string {
  return `${field}: [${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

/** Serialize a validated issue document to its Markdown storage format. */
export function serializeIssue(issue: Issue): string {
  const validated = issueSchema.parse(issue);
  const serialized = `---\n${serializeYaml(validated.metadata)}\n---\n\n${validated.body}`;
  assertUtf8Limit(serialized, ISSUE_STORAGE_LIMITS.maxFileBytes, "Issue file");
  return serialized;
}

/** Parse a bounded issue Markdown document, or return null for invalid content. */
export function parseIssue(content: string, path: string): Issue | null {
  const parsed = parseFrontmatter(content);
  if (!parsed) return null;

  try {
    const metadata = validateMetadata(parseYaml(parsed.frontmatter));
    return issueSchema.parse({ metadata, body: parsed.body, path });
  } catch {
    return null;
  }
}

/**
 * File-backed issue manager rooted at one project directory.
 *
 * Mutations to one issue are serialized across manager instances in this
 * process. Separate processes must coordinate writes to the same project.
 */
export class IssuesManager {
  private readonly fs: FileSystem;
  private readonly projectDir: string;
  private readonly issuesDir: string;
  private readonly reservationsDir: string;

  /** Create a manager for a project directory and optional filesystem implementation. */
  constructor(projectDir: string, fs?: FileSystem) {
    if (
      typeof projectDir !== "string" || projectDir.trim().length === 0 ||
      projectDir.length > ISSUE_STORAGE_LIMITS.maxPathCharacters || projectDir.includes("\0")
    ) {
      throw new TypeError("Project directory must be a valid path");
    }
    this.projectDir = projectDir;
    this.fs = fs ?? createFileSystem();
    this.issuesDir = join(projectDir, ISSUES_DIR);
    this.reservationsDir = join(this.issuesDir, ISSUE_RESERVATIONS_DIR);
  }

  /** Resolve a required filesystem capability or report an unsupported adapter. */
  private requireFileSystemMethod<K extends "realPath" | "lstat" | "rename">(
    method: K,
  ): NonNullable<FileSystem[K]> {
    const implementation = this.fs[method];
    if (typeof implementation !== "function") {
      throw NOT_SUPPORTED.create({
        message: "Issue storage requires canonical path and atomic rename support",
      });
    }
    return implementation.bind(this.fs) as NonNullable<FileSystem[K]>;
  }

  /** Return whether the canonical issue directory is inside the project directory. */
  private async hasValidStorageRoot(): Promise<boolean> {
    return await this.hasCanonicalDescendant(
      this.projectDir,
      this.issuesDir,
      "Issue storage path must stay within the project directory",
    );
  }

  /** Return whether the canonical reservation directory is inside issue storage. */
  private async hasValidReservationsRoot(): Promise<boolean> {
    return await this.hasCanonicalDescendant(
      this.issuesDir,
      this.reservationsDir,
      "Issue ID reservations must stay within the issue storage directory",
    );
  }

  /** Validate a canonical parent-child path relationship. */
  private async hasCanonicalDescendant(
    parent: string,
    child: string,
    violationMessage: string,
  ): Promise<boolean> {
    const realPath = this.requireFileSystemMethod("realPath");
    try {
      const [canonicalParent, canonicalChild] = await Promise.all([
        realPath(parent),
        realPath(child),
      ]);
      const relation = relative(canonicalParent, canonicalChild);
      if (
        relation === "" || relation === ".." || relation.startsWith(`..${sep}`) ||
        isAbsolute(relation)
      ) {
        throw SECURITY_VIOLATION.create({
          message: violationMessage,
        });
      }
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  /** Return a canonical per-issue key for serializing local mutations. */
  private async getMutationKey(id: string): Promise<string | null> {
    if (!await this.hasValidStorageRoot()) return null;
    const canonicalIssues = await this.requireFileSystemMethod("realPath")(this.issuesDir);
    return `${canonicalIssues}\0${id}`;
  }

  /** Ensure that the validated issue and ID-reservation directories exist. */
  async ensureDir(): Promise<void> {
    await this.fs.mkdir(this.issuesDir, { recursive: true });
    if (!await this.hasValidStorageRoot()) {
      throw SECURITY_VIOLATION.create({ message: "Issue storage path is unavailable" });
    }
    await this.fs.mkdir(this.reservationsDir, { recursive: true });
    if (!await this.hasValidReservationsRoot()) {
      throw SECURITY_VIOLATION.create({ message: "Issue ID reservation path is unavailable" });
    }
  }

  /** Scan a bounded directory and return valid issue IDs accepted by the caller. */
  private async scanIds(
    directory: string,
    accept: (entry: {
      name: string;
      isFile: boolean;
      isDirectory: boolean;
      isSymlink?: boolean;
    }) => boolean,
  ): Promise<string[]> {
    const ids: string[] = [];
    let scannedEntries = 0;
    try {
      for await (const entry of this.fs.readDir(directory)) {
        scannedEntries++;
        if (scannedEntries > ISSUE_STORAGE_LIMITS.maxDirectoryEntries) {
          throw new RangeError("Issue directory scan limit exceeded");
        }
        if (entry.isSymlink || !accept(entry)) continue;
        const id = entry.name.endsWith(".md") ? entry.name.slice(0, -3) : entry.name;
        if (isValidIssueId(id)) {
          ids.push(id);
          if (ids.length > ISSUE_STORAGE_LIMITS.maxIssues) {
            throw new RangeError("Issue directory scan limit exceeded");
          }
        }
      }
    } catch (error) {
      if (isNotFoundError(error)) return [];
      throw error;
    }
    return ids;
  }

  /** Return every valid issue ID with a corresponding Markdown file. */
  async listIds(): Promise<string[]> {
    if (!await this.hasValidStorageRoot()) return [];
    const ids = await this.scanIds(
      this.issuesDir,
      (entry) => entry.isFile && entry.name.endsWith(".md"),
    );
    return ids.sort(compareIssueIds);
  }

  /** Return every atomically reserved issue ID. */
  private async listReservedIds(): Promise<string[]> {
    if (!await this.hasValidReservationsRoot()) return [];
    return await this.scanIds(
      this.reservationsDir,
      (entry) => entry.isDirectory,
    );
  }

  /** Reserve and return the next available ID for a prefix. */
  private async reserveNextId(prefix: IssuePrefix): Promise<string> {
    await this.ensureDir();
    for (let attempt = 0; attempt < ISSUE_STORAGE_LIMITS.maxIssues; attempt++) {
      const existing = new Set([
        ...await this.listIds(),
        ...await this.listReservedIds(),
      ]);
      if (existing.size >= ISSUE_STORAGE_LIMITS.maxIssues) {
        throw new RangeError("Issue count exceeds the supported limit");
      }
      const id = generateIssueId(prefix, [...existing]);
      try {
        await this.fs.mkdir(join(this.reservationsDir, id));
        return id;
      } catch (error) {
        if (isAlreadyExistsError(error)) continue;
        throw error;
      }
    }
    throw new RangeError("Issue ID reservation retry limit exceeded");
  }

  /** Release the reservation created for an issue that could not be persisted. */
  private async releaseReservation(id: string): Promise<void> {
    if (!await this.hasValidReservationsRoot()) {
      throw SECURITY_VIOLATION.create({ message: "Issue ID reservation path is unavailable" });
    }
    try {
      await this.fs.remove(join(this.reservationsDir, id), { recursive: true });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  /** Replace an issue file atomically using a same-directory temporary file. */
  private async writeIssueAtomically(issue: Issue): Promise<void> {
    if (!await this.hasValidStorageRoot()) {
      throw SECURITY_VIOLATION.create({ message: "Issue storage path is unavailable" });
    }
    const rename = this.requireFileSystemMethod("rename");
    const destination = join(this.projectDir, issue.path);
    const temporary = `${destination}.tmp-${crypto.randomUUID()}`;
    try {
      await this.fs.writeTextFile(temporary, serializeIssue(issue));
      await rename(temporary, destination);
    } catch (writeError) {
      try {
        await this.fs.remove(temporary);
      } catch (cleanupError) {
        if (!isNotFoundError(cleanupError)) {
          throw new AggregateError(
            [writeError, cleanupError],
            "Issue write and temporary-file cleanup failed",
          );
        }
      }
      throw writeError;
    }
  }

  /** Create and persist a new issue with an atomically reserved ID. */
  async create(options: CreateIssueOptions): Promise<Issue> {
    const validated = createIssueSchema.parse(options);
    const id = await this.reserveNextId(validated.prefix ?? "ISSUE");
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

    try {
      await this.writeIssueAtomically(issue);
      return issue;
    } catch (writeError) {
      try {
        const persisted = await this.readIssue(id);
        if (persisted) return persisted;
      } catch (verificationError) {
        throw new AggregateError(
          [writeError, verificationError],
          "Issue write outcome could not be verified",
        );
      }
      try {
        await this.releaseReservation(id);
      } catch (cleanupError) {
        throw new AggregateError(
          [writeError, cleanupError],
          "Issue write and ID reservation cleanup failed",
        );
      }
      throw writeError;
    }
  }

  /** Read an issue file after validating its canonical storage boundary. */
  private async readIssue(id: string): Promise<Issue | null> {
    const validatedId = issueIdSchema.parse(id);
    if (!await this.hasValidStorageRoot()) return null;
    const issuePath = `${ISSUES_DIR}/${validatedId}.md`;
    const fullPath = join(this.projectDir, issuePath);
    const lstat = this.requireFileSystemMethod("lstat");

    try {
      const info = await lstat(fullPath);
      if (!info.isFile || info.isSymlink) {
        throw SECURITY_VIOLATION.create({ message: "Issue path must be a regular file" });
      }
      if (
        !await this.hasCanonicalDescendant(this.issuesDir, fullPath, "Issue path escaped storage")
      ) {
        return null;
      }
      if (info.size > ISSUE_STORAGE_LIMITS.maxFileBytes) {
        throw new RangeError("Issue file exceeds the supported size limit");
      }
      const content = await this.fs.readTextFile(fullPath);
      assertUtf8Limit(content, ISSUE_STORAGE_LIMITS.maxFileBytes, "Issue file");
      const issue = parseIssue(content, issuePath);
      if (!issue) {
        throw INPUT_VALIDATION_FAILED.create({ message: "Issue file is invalid" });
      }
      if (issue.metadata.id !== validatedId) {
        throw INPUT_VALIDATION_FAILED.create({
          message: "Issue metadata ID does not match its file ID",
        });
      }
      return issue;
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  /** Return an issue by ID, or null when its file does not exist. */
  async get(id: string): Promise<Issue | null> {
    return await this.readIssue(id);
  }

  /** Persist already validated changes to an issue while its mutation lock is held. */
  private async persistValidatedUpdate(
    existing: Issue,
    validated: UpdateIssueOptions,
  ): Promise<Issue> {
    const title = validated.title ?? existing.metadata.title;
    const state = validated.state ?? existing.metadata.state;
    const labels = validated.labels ?? existing.metadata.labels;
    const assignees = validated.assignees ?? existing.metadata.assignees;
    const milestone = validated.milestone === undefined
      ? existing.metadata.milestone
      : validated.milestone ?? undefined;
    const body = validated.body ?? existing.body;

    if (
      title === existing.metadata.title && state === existing.metadata.state &&
      arraysEqual(labels, existing.metadata.labels) &&
      arraysEqual(assignees, existing.metadata.assignees) &&
      milestone === existing.metadata.milestone && body === existing.body
    ) {
      return existing;
    }

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
    await this.writeIssueAtomically(issue);
    return issue;
  }

  /** Apply one already validated update while the issue mutation lock is held. */
  private async updateValidated(
    validatedId: string,
    validated: UpdateIssueOptions,
  ): Promise<Issue | null> {
    const existing = await this.readIssue(validatedId);
    if (!existing) return null;
    return await this.persistValidatedUpdate(existing, validated);
  }

  /** Update an existing issue with process-serialized atomic file replacement. */
  async update(id: string, options: UpdateIssueOptions): Promise<Issue | null> {
    const validatedId = issueIdSchema.parse(id);
    const validated = updateIssueSchema.parse(options);
    const mutationKey = await this.getMutationKey(validatedId);
    if (!mutationKey) return null;
    return await runSerializedIssueMutation(
      mutationKey,
      () => this.updateValidated(validatedId, validated),
    );
  }

  /** Delete one issue while its mutation lock is held. */
  private async deleteValidated(validatedId: string): Promise<boolean> {
    if (!await this.hasValidStorageRoot()) return false;
    const issuePath = join(this.issuesDir, `${validatedId}.md`);
    const lstat = this.requireFileSystemMethod("lstat");
    try {
      const info = await lstat(issuePath);
      if (!info.isFile || info.isSymlink) {
        throw SECURITY_VIOLATION.create({ message: "Issue path must be a regular file" });
      }
      if (
        !await this.hasCanonicalDescendant(this.issuesDir, issuePath, "Issue path escaped storage")
      ) {
        return false;
      }
      await this.fs.remove(issuePath);
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  /** Delete an issue with process serialization while preserving its ID reservation. */
  async delete(id: string): Promise<boolean> {
    const validatedId = issueIdSchema.parse(id);
    const mutationKey = await this.getMutationKey(validatedId);
    if (!mutationKey) return false;
    return await runSerializedIssueMutation(
      mutationKey,
      () => this.deleteValidated(validatedId),
    );
  }

  /** List issues with validated filtering, deterministic sorting, and bounds. */
  async list(options: ListIssuesOptions = {}): Promise<ListIssuesResult> {
    const validated = listIssuesSchema.parse(options);
    if (!await this.hasValidStorageRoot()) return { issues: [], total: 0 };
    const ids = await this.listIds();
    const sortKey = validated.sortBy ?? "created_at";
    const sortDirection = validated.sortDirection ?? "desc";
    const compare = (left: Issue, right: Issue): number =>
      compareIssues(left, right, sortKey, sortDirection);
    const issues: Issue[] = [];
    const retainedSizes: number[] = [];
    let retainedBytes = 0;
    let total = 0;

    for (const id of ids) {
      if (validated.prefix && !id.startsWith(`${validated.prefix}-`)) continue;
      const issue = await this.readIssue(id);
      if (!issue) continue;
      if (validated.state && issue.metadata.state !== validated.state) continue;
      if (
        validated.labels?.length &&
        !validated.labels.every((label) => issue.metadata.labels.includes(label))
      ) continue;
      if (validated.milestone && issue.metadata.milestone !== validated.milestone) continue;
      if (validated.assignee && !issue.metadata.assignees.includes(validated.assignee)) continue;
      total++;

      if (validated.limit === undefined) {
        const size = serializedIssueByteLength(issue);
        if (retainedBytes + size > ISSUE_STORAGE_LIMITS.maxListResultBytes) {
          throw new RangeError(
            "Issue list result exceeds the supported byte limit; use filters or a smaller limit",
          );
        }
        retainedBytes += size;
        issues.push(issue);
        continue;
      }

      const insertionIndex = findIssueInsertionIndex(issues, issue, compare);
      if (insertionIndex >= validated.limit) continue;

      const size = serializedIssueByteLength(issue);
      issues.splice(insertionIndex, 0, issue);
      retainedSizes.splice(insertionIndex, 0, size);
      retainedBytes += size;
      if (issues.length > validated.limit) {
        issues.pop();
        retainedBytes -= retainedSizes.pop()!;
      }
      if (retainedBytes > ISSUE_STORAGE_LIMITS.maxListResultBytes) {
        throw new RangeError(
          "Issue list result exceeds the supported byte limit; use filters or a smaller limit",
        );
      }
    }

    if (validated.limit === undefined) issues.sort(compare);
    return { issues, total };
  }

  /** Close an issue. */
  close(id: string): Promise<Issue | null> {
    return this.update(id, { state: "closed" });
  }

  /** Reopen a closed issue. */
  reopen(id: string): Promise<Issue | null> {
    return this.update(id, { state: "open" });
  }

  /** Add validated labels to an issue without duplicates. */
  async addLabels(id: string, labels: string[]): Promise<Issue | null> {
    const validatedId = issueIdSchema.parse(id);
    const validatedLabels = updateIssueSchema.parse({ labels }).labels!;
    const mutationKey = await this.getMutationKey(validatedId);
    if (!mutationKey) return null;
    return await runSerializedIssueMutation(mutationKey, async () => {
      const issue = await this.readIssue(validatedId);
      if (!issue) return null;
      const update = updateIssueSchema.parse({
        labels: [...new Set([...issue.metadata.labels, ...validatedLabels])],
      });
      return await this.persistValidatedUpdate(issue, update);
    });
  }

  /** Remove matching labels from an issue. */
  async removeLabels(id: string, labels: string[]): Promise<Issue | null> {
    const validatedId = issueIdSchema.parse(id);
    const validatedLabels = updateIssueSchema.parse({ labels }).labels!;
    const mutationKey = await this.getMutationKey(validatedId);
    if (!mutationKey) return null;
    return await runSerializedIssueMutation(mutationKey, async () => {
      const issue = await this.readIssue(validatedId);
      if (!issue) return null;
      const update = updateIssueSchema.parse({
        labels: issue.metadata.labels.filter((label) => !validatedLabels.includes(label)),
      });
      return await this.persistValidatedUpdate(issue, update);
    });
  }
}

/** Create an issue manager for a project directory. */
export function createIssuesManager(projectDir: string, fs?: FileSystem): IssuesManager {
  return new IssuesManager(projectDir, fs);
}
