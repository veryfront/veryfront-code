import type { WorkDefinition, WorkReference } from "./types.ts";
import { workRegistry } from "./registry.ts";

/** Resolve agent work references to concrete Work definitions. */
export function resolveWorkReferences(
  references: WorkReference | WorkReference[],
): WorkDefinition[] {
  const refs = Array.isArray(references) ? references : [references];
  return refs.map((ref) => typeof ref === "string" ? workRegistry.getRequired(ref) : ref);
}

/** Build a concise system-prompt section describing assigned Work outcomes. */
export function buildWorkManifestPrompt(works: Iterable<WorkDefinition>): string {
  const workDefinitions = Array.from(works);
  if (workDefinitions.length === 0) return "";

  const sections = workDefinitions.map((definition) => {
    const criteria = definition.acceptanceCriteria.map((criterion) => {
      const optionalLabel = criterion.optional ? " (optional)" : "";
      return `- ${criterion.id}${optionalLabel}: ${criterion.description}`;
    }).join("\n");

    return [
      `### ${definition.name} (${definition.id})`,
      `Outcome: ${definition.outcome}`,
      "Acceptance criteria:",
      criteria,
    ].join("\n");
  }).join("\n\n");

  return [
    "## Work",
    "Work is business/process state: pursue the outcome, then use Work execution tools to record durable status and evidence. Work definitions do not prescribe fixed workflow control flow.",
    "",
    sections,
  ].join("\n");
}
