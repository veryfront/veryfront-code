export const DEFAULT_E2E_PROJECT = "blank";
export const DEFAULT_E2E_MATRIX_PROJECTS = [DEFAULT_E2E_PROJECT, "second"] as const;

function parseProjects(env: Readonly<Record<string, string | undefined>>): string[] {
  const singleProject = env.E2E_PROJECT?.trim();
  if (singleProject) return [singleProject];

  const projectList = env.E2E_PROJECTS;
  if (!projectList) return [];

  return projectList
    .split(",")
    .map((project) => project.trim())
    .filter(Boolean);
}

export function getProjectsToTest(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const parsedProjects = parseProjects(env);
  return parsedProjects.length > 0 ? parsedProjects : [DEFAULT_E2E_PROJECT];
}

export function getProjectsToProvision(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const parsedProjects = parseProjects(env);
  return parsedProjects.length > 0 ? parsedProjects : [...DEFAULT_E2E_MATRIX_PROJECTS];
}
