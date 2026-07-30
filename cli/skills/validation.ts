import { SKILL_NAME_REGEX } from "veryfront/skill";

/**
 * Reject a canonical-looking authored skill id that disagrees with the
 * directory identity. Display-style legacy names remain presentation metadata.
 */
export function assertSkillDirectoryIdentity(
  frontmatter: Record<string, unknown>,
  directoryName: string,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(frontmatter, "name");
  if (!descriptor) return;
  if (!("value" in descriptor)) {
    throw new TypeError('Skill frontmatter field "name" must be a data property');
  }
  if (typeof descriptor.value !== "string") return;

  const authoredName = descriptor.value.trim();
  if (SKILL_NAME_REGEX.test(authoredName) && authoredName !== directoryName) {
    throw new Error(
      `Skill name "${authoredName}" does not match directory name "${directoryName}"`,
    );
  }
}
