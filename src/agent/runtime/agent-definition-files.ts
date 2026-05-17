import type { Schema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "#veryfront/platform/compat/path/index.ts";
import { defineSchema } from "../../schemas/define.ts";
import { lazySchema } from "../../schemas/lazy.ts";
import {
  parseRuntimeAgentMarkdownDefinition,
  type RuntimeAgentMarkdownDefinition,
} from "./agent-definition.ts";

export type ResolveRuntimeAgentDefinitionsDirInput = {
  baseDir: string;
  id: string;
  fileName?: string;
};

export type ListRuntimeAgentMarkdownDefinitionIdsInput = {
  baseDir: string;
};

export type LoadRuntimeAgentMarkdownDefinitionFromFileInput = {
  agentsDir: string;
  id: string;
  fileName?: string;
};

function runtimeAgentDefinitionFileName(v: SchemaValidator): Schema<string> {
  return v.string().min(1).regex(/^[A-Za-z0-9._-]+\.md$/);
}

function runtimeAgentDefinitionFileId(v: SchemaValidator): Schema<string> {
  return v.string().min(1).regex(/^[A-Za-z0-9._-]+$/);
}

const runtimeAgentDefinitionFileNameSchema = lazySchema(
  defineSchema<string>(runtimeAgentDefinitionFileName),
);

export const resolveRuntimeAgentDefinitionsDirInputSchema = lazySchema(
  defineSchema<ResolveRuntimeAgentDefinitionsDirInput>((v) =>
    v.object({
      baseDir: v.string().min(1),
      id: runtimeAgentDefinitionFileId(v),
      fileName: runtimeAgentDefinitionFileName(v).optional(),
    })
  ),
);

export const listRuntimeAgentMarkdownDefinitionIdsInputSchema = lazySchema(
  defineSchema<ListRuntimeAgentMarkdownDefinitionIdsInput>((v) =>
    v.object({
      baseDir: v.string().min(1),
    })
  ),
);

export const loadRuntimeAgentMarkdownDefinitionFromFileInputSchema = lazySchema(
  defineSchema<LoadRuntimeAgentMarkdownDefinitionFromFileInput>((v) =>
    v.object({
      agentsDir: v.string().min(1),
      id: runtimeAgentDefinitionFileId(v),
      fileName: runtimeAgentDefinitionFileName(v).optional(),
    })
  ),
);

function getRuntimeAgentDefinitionFileName(input: {
  id: string;
  fileName?: string;
}): string {
  return input.fileName ?? `${input.id}.md`;
}

function hasRuntimeAgentDefinitionFile(path: string, fileName: string): boolean {
  return existsSync(resolve(path, fileName));
}

function getRuntimeAgentDefinitionsDirCandidates(baseDir: string): string[] {
  const firstCandidate = resolve(baseDir, "agents");
  const sourceLayoutCandidate = resolve(baseDir, "../agents");
  const candidates = [
    firstCandidate,
    sourceLayoutCandidate,
    resolve(baseDir, "../../agents"),
    resolve(baseDir, "../../../agents"),
  ];

  return [...new Set(candidates)];
}

export function resolveRuntimeAgentDefinitionsDir(
  input: ResolveRuntimeAgentDefinitionsDirInput,
): string {
  const parsedInput = resolveRuntimeAgentDefinitionsDirInputSchema.parse(input);
  const fileName = getRuntimeAgentDefinitionFileName(parsedInput);
  const candidates = getRuntimeAgentDefinitionsDirCandidates(parsedInput.baseDir);
  const sourceLayoutCandidate = resolve(parsedInput.baseDir, "../agents");
  const fallbackCandidate = basename(parsedInput.baseDir) === "src"
    ? sourceLayoutCandidate
    : resolve(parsedInput.baseDir, "agents");

  return candidates.find((candidate) => hasRuntimeAgentDefinitionFile(candidate, fileName)) ??
    fallbackCandidate;
}

export function listRuntimeAgentMarkdownDefinitionIds(
  input: ListRuntimeAgentMarkdownDefinitionIdsInput,
): string[] {
  const parsedInput = listRuntimeAgentMarkdownDefinitionIdsInputSchema.parse(input);
  const ids = new Set<string>();

  for (const dir of getRuntimeAgentDefinitionsDirCandidates(parsedInput.baseDir)) {
    if (!existsSync(dir)) {
      continue;
    }

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }

      const parseResult = runtimeAgentDefinitionFileNameSchema.safeParse(entry.name);
      if (!parseResult.success) {
        continue;
      }

      ids.add(parseResult.data.slice(0, -".md".length));
    }
  }

  return [...ids].sort((left, right) => left.localeCompare(right));
}

export function resolveRuntimeAgentMarkdownDefinitionFilePath(
  input: LoadRuntimeAgentMarkdownDefinitionFromFileInput,
): string {
  const parsedInput = loadRuntimeAgentMarkdownDefinitionFromFileInputSchema.parse(input);

  return resolve(
    parsedInput.agentsDir,
    getRuntimeAgentDefinitionFileName(parsedInput),
  );
}

export function loadRuntimeAgentMarkdownDefinitionFromFile(
  input: LoadRuntimeAgentMarkdownDefinitionFromFileInput,
): RuntimeAgentMarkdownDefinition {
  const parsedInput = loadRuntimeAgentMarkdownDefinitionFromFileInputSchema.parse(input);
  const filePath = resolveRuntimeAgentMarkdownDefinitionFilePath(parsedInput);

  return parseRuntimeAgentMarkdownDefinition({
    id: parsedInput.id,
    content: readFileSync(filePath, "utf-8"),
  });
}
