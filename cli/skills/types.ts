import type { SkillMetadata } from "veryfront/skill";

export interface LoadedSkill {
  metadata: SkillMetadata;
  skillMd: string;
  directory: string;
  /** Reference documents keyed by path relative to the skill, e.g. `references/ROUTES.md`. */
  references?: Record<string, string>;
}
