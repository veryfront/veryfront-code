import { existsSync, readFileSync } from "node:fs";
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

export function resolveRuntimeAgentDefinitionsDir(
  input: ResolveRuntimeAgentDefinitionsDirInput,
): string {
  const parsedInput = resolveRuntimeAgentDefinitionsDirInputSchema.parse(input);
  const fileName = getRuntimeAgentDefinitionFileName(parsedInput);
  const firstCandidate = resolve(parsedInput.baseDir, "agents");
  const sourceLayoutCandidate = resolve(parsedInput.baseDir, "../agents");
  const candidates = [
    firstCandidate,
    sourceLayoutCandidate,
    resolve(parsedInput.baseDir, "../../agents"),
    resolve(parsedInput.baseDir, "../../../agents"),
  ];
  const fallbackCandidate = basename(parsedInput.baseDir) === "src"
    ? sourceLayoutCandidate
    : firstCandidate;

  return candidates.find((candidate) => hasRuntimeAgentDefinitionFile(candidate, fileName)) ??
    fallbackCandidate;
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
