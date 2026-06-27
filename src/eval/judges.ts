import { resolveRuntimeModel } from "#veryfront/agent/runtime/model-resolution.ts";
import { type ModelRuntime, resolveModel } from "#veryfront/provider";
import { generateText } from "#veryfront/runtime/runtime-bridge.ts";

import type { EvalAnswerGroundednessMetricOptions } from "./types.ts";

type GroundednessJudge = NonNullable<EvalAnswerGroundednessMetricOptions["judge"]>;

/** Options for the built-in LLM groundedness judge. */
export interface EvalLlmGroundednessJudgeOptions {
  /** Model id or runtime used to judge answer grounding. Defaults to the runtime auto model. */
  model?: string | ModelRuntime;
  /** Minimum score required for the judge to pass. Defaults to 0.8. */
  threshold?: number;
  /** Maximum retrieved evidence characters included in the judge prompt. Defaults to 12000. */
  maxEvidenceChars?: number;
  /** Maximum judge response tokens. Defaults to 800. */
  maxOutputTokens?: number;
  /** Judge model temperature. Defaults to 0 for repeatability. */
  temperature?: number;
  /** Provider-specific options forwarded to the model runtime. */
  providerOptions?: Record<string, unknown>;
}

const DEFAULT_JUDGE_MODEL = "auto";
const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_MAX_EVIDENCE_CHARS = 12_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 800;

function asJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

function resolveJudgeModel(model: string | ModelRuntime | undefined): ModelRuntime {
  if (model && typeof model === "object") return model;
  return resolveModel(resolveRuntimeModel(model ?? DEFAULT_JUDGE_MODEL));
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 24))}\n[truncated]`;
}

function buildEvidenceBlock(evidence: string[], sources: string[], maxChars: number): string {
  const entries = evidence.length > 0 ? evidence : ["No retrieved evidence was provided."];
  const sourceBlock = sources.length > 0
    ? sources.map((source, index) => `- [source ${index + 1}] ${source}`).join("\n")
    : "- none";
  const evidenceBlock = entries.map((entry, index) => `[evidence ${index + 1}]\n${entry}`).join(
    "\n\n",
  );
  const block = `Retrieved sources:
${sourceBlock}

Evidence snippets:
${evidenceBlock}`;
  return truncate(block, maxChars);
}

function buildGroundednessPrompt(
  input: Parameters<GroundednessJudge>[0],
  options: Required<Pick<EvalLlmGroundednessJudgeOptions, "threshold" | "maxEvidenceChars">>,
): string {
  return `Evaluate whether an agent answer is grounded in retrieved evidence.

Rubric:
${input.rubric}

Rules:
- Grade only against the evidence and the reference.
- Treat unsupported factual claims, unsupported instructions, or missing required actions as failures.
- Do not reward keyword overlap by itself. Judge semantic support.
- Use score 1.0 only when all material claims are supported and the answer satisfies the reference.
- Use score 0.8 for mostly grounded answers with only minor omissions.
- Use score 0.5 for partially grounded answers with material omissions.
- Use score 0.0 for ungrounded, contradictory, or non-responsive answers.
- Pass only when score is at least ${options.threshold}.

Return only valid JSON with this shape:
{
  "score": 0.0,
  "pass": false,
  "explanation": "Short reason.",
  "unsupportedClaims": ["claim not supported by evidence"],
  "missingEvidence": ["required point missing from the answer"]
}

Input:
${asJson(input.input)}

Reference:
${asJson(input.reference)}

Metadata:
${asJson(input.metadata)}

Answer:
${asJson(input.output)}

Evidence:
${buildEvidenceBlock(input.evidence, input.sources, options.maxEvidenceChars)}
`;
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function extractJsonObject(value: string): string | null {
  const stripped = stripJsonFence(value);
  try {
    JSON.parse(stripped);
    return stripped;
  } catch {
    // Continue and extract the first balanced object from explanatory text.
  }

  const start = stripped.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < stripped.length; index++) {
    const char = stripped[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return stripped.slice(start, index + 1);
  }

  return null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function parseJudgeResponse(
  text: string,
  threshold: number,
): { score: number; pass: boolean; explanation: string } {
  const json = extractJsonObject(text);
  if (!json) {
    return {
      score: 0,
      pass: false,
      explanation: "LLM judge did not return valid JSON.",
    };
  }

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const score = clampScore(typeof parsed.score === "number" ? parsed.score : 0);
    const modelPass = typeof parsed.pass === "boolean" ? parsed.pass : true;
    const unsupportedClaims = stringList(parsed.unsupportedClaims);
    const missingEvidence = stringList(parsed.missingEvidence);
    const details = [
      typeof parsed.explanation === "string" && parsed.explanation.trim()
        ? parsed.explanation.trim()
        : "LLM judge returned a structured groundedness score.",
      ...(unsupportedClaims.length > 0
        ? [`Unsupported claims: ${unsupportedClaims.join("; ")}`]
        : []),
      ...(missingEvidence.length > 0 ? [`Missing evidence: ${missingEvidence.join("; ")}`] : []),
    ];

    return {
      score,
      pass: modelPass && score >= threshold,
      explanation: details.join(" "),
    };
  } catch {
    return {
      score: 0,
      pass: false,
      explanation: "LLM judge returned malformed JSON.",
    };
  }
}

function createLlmGroundednessJudge(
  options: EvalLlmGroundednessJudgeOptions = {},
): GroundednessJudge {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const maxEvidenceChars = options.maxEvidenceChars ?? DEFAULT_MAX_EVIDENCE_CHARS;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  return async (input) => {
    const model = resolveJudgeModel(options.model);
    const response = await generateText({
      model,
      messages: [{
        role: "user",
        content: buildGroundednessPrompt(input, { threshold, maxEvidenceChars }),
      }],
      maxOutputTokens,
      temperature: options.temperature ?? 0,
      ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
    });

    return parseJudgeResponse(response.text, threshold);
  };
}

/** Built-in judge factories for semantic eval metrics. */
export const judges = {
  llm: {
    /** Create an LLM judge for `metrics.answer.groundedness`. */
    groundedness: createLlmGroundednessJudge,
  },
} as const;
