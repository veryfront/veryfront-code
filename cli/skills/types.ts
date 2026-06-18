import type { SkillMetadata } from "#veryfront/skill";

export interface LoadedSkill {
  metadata: SkillMetadata;
  skillMd: string;
  directory: string;
}
