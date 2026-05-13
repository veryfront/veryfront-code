import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { z } from "zod";
import {
  parseRuntimeAgentMarkdownDefinition,
  type RuntimeAgentMarkdownDefinition,
} from "./runtime-agent-definition.ts";

const runtimeAgentDefinitionFileNameSchema = z.string().min(1).regex(/^[A-Za-z0-9._-]+\.md$/);
const runtimeAgentDefinitionFileIdSchema = z.string().min(1).regex(/^[A-Za-z0-9._-]+$/);

export const resolveRuntimeAgentDefinitionsDirInputSchema = z.object({
  baseDir: z.string().min(1),
  id: runtimeAgentDefinitionFileIdSchema,
  fileName: runtimeAgentDefinitionFileNameSchema.optional(),
});

export type ResolveRuntimeAgentDefinitionsDirInput = z.infer<
  typeof resolveRuntimeAgentDefinitionsDirInputSchema
>;

export const listRuntimeAgentMarkdownDefinitionIdsInputSchema = z.object({
  baseDir: z.string().min(1),
});

export type ListRuntimeAgentMarkdownDefinitionIdsInput = z.infer<
  typeof listRuntimeAgentMarkdownDefinitionIdsInputSchema
>;

export const loadRuntimeAgentMarkdownDefinitionFromFileInputSchema = z.object({
  agentsDir: z.string().min(1),
  id: runtimeAgentDefinitionFileIdSchema,
  fileName: runtimeAgentDefinitionFileNameSchema.optional(),
});

export type LoadRuntimeAgentMarkdownDefinitionFromFileInput = z.infer<
  typeof loadRuntimeAgentMarkdownDefinitionFromFileInputSchema
>;

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
