import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { ToolExecutionContext } from "#veryfront/tool/types.ts";
import {
  SKILL_ID_MAX_LENGTH,
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_PATH_SEGMENT_MAX_LENGTH,
  SKILL_RELATIVE_PATH_MAX_LENGTH,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "#veryfront/skill/limits.ts";
import { SKILL_READABLE_DIRS } from "#veryfront/skill/types.ts";
import { hasControlCharacters, isUtf8WithinByteLimit } from "#veryfront/skill/string-safety.ts";

const apply = Reflect.apply;
const startsWith = String.prototype.startsWith;
const trim = String.prototype.trim;
const descriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;

function canonicalSkillPath(path: string, kind: "reference" | "script"): boolean {
  if (
    apply(trim, path, []) !== path || hasControlCharacters(path) ||
    !isUtf8WithinByteLimit(path, SKILL_RELATIVE_PATH_MAX_LENGTH)
  ) return false;
  // Native split still dispatches separator[Symbol.split]. Inspect primitive
  // string indices so project hooks cannot replace the path segments.
  let segmentStart = 0;
  for (let index = 0; index <= path.length; index++) {
    if (index < path.length && path[index] === "\\") return false;
    if (index < path.length && path[index] !== "/") continue;
    const length = index - segmentStart;
    if (
      length === 0 || length > SKILL_PATH_SEGMENT_MAX_LENGTH ||
      (path[segmentStart] === "." &&
        (length === 1 || (length === 2 && path[segmentStart + 1] === ".")))
    ) {
      return false;
    }
    segmentStart = index + 1;
  }
  if (kind === "script") return apply(startsWith, path, ["scripts/"]);
  for (let index = 0; index < SKILL_READABLE_DIRS.length; index++) {
    if (apply(startsWith, path, [`${SKILL_READABLE_DIRS[index]}/`])) return true;
  }
  return false;
}

/** Only dynamic skill data may accompany an explicitly granted project-tool call. */
export const getExecutorProjectCallContextSchema = defineSchema((v) => {
  const path = (kind: "reference" | "script") =>
    v.string().min(1).max(SKILL_RELATIVE_PATH_MAX_LENGTH).refine((value) =>
      canonicalSkillPath(value, kind)
    );
  return v.object({
    activeSkillId: v.string().min(1).max(SKILL_ID_MAX_LENGTH).refine((value) =>
      !hasControlCharacters(value) && isUtf8WithinByteLimit(value, SKILL_ID_MAX_LENGTH)
    ).optional(),
    activeSkillToolAvailability: v.object({
      hasActiveSkill: v.boolean().optional(),
      references: v.array(path("reference")).max(SKILL_LOADABLE_REFERENCE_MAX_ENTRIES).optional(),
      scripts: v.array(path("script")).max(SKILL_SUBDIR_MAX_ENTRIES).optional(),
    }).strict().optional(),
  }).strict();
});

export type ExecutorProjectCallContext = InferSchema<
  ReturnType<typeof getExecutorProjectCallContextSchema>
>;

/** Select own skill fields without enumerating credentials or other host context. */
export function captureExecutorProjectCallContext(
  context?: ToolExecutionContext,
): ExecutorProjectCallContext | undefined {
  const read = (key: "activeSkillId" | "activeSkillToolAvailability") => {
    if (!context) return undefined;
    const property = descriptor(context, key);
    if (!property) return undefined;
    if (!hasOwn(property, "value")) throw new TypeError("Invalid project skill context");
    return property.value;
  };
  const activeSkillId = read("activeSkillId");
  const availability = read("activeSkillToolAvailability");
  if (activeSkillId === undefined && availability === undefined) return undefined;
  const snapshot = snapshotBoundedJsonValue({
    ...(activeSkillId === undefined ? {} : { activeSkillId }),
    ...(availability === undefined ? {} : { activeSkillToolAvailability: availability }),
  });
  if (!snapshot.success) throw new TypeError("Invalid project skill context");
  const parsed = getExecutorProjectCallContextSchema().safeParse(snapshot.value);
  if (!parsed.success) throw new TypeError("Invalid project skill context");
  return parsed.data;
}
