import { SKILL_TEXT_FILE_MAX_BYTES } from "veryfront/skill";
import { readBoundedSkillTextFile } from "#veryfront/skill/bounded-text-file.ts";

/** Read one SKILL.md under the same byte budget used by runtime discovery. */
export async function readSkillDocument(path: string): Promise<string> {
  return await readBoundedSkillTextFile(path, undefined, SKILL_TEXT_FILE_MAX_BYTES);
}
