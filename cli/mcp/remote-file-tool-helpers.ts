function encodeFilePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function getBranchPath(branch?: string): string {
  return branch ? `/branches/${branch}` : "";
}

export function getBranchParam(branch?: string): string {
  return branch ? `?branch_id=${branch}` : "";
}

export function buildProjectApiPath(project: string, resource: string, branch?: string): string {
  const normalizedResource = resource.startsWith("/") ? resource.slice(1) : resource;
  return `/${project}${getBranchPath(branch)}/${normalizedResource}`;
}

export function buildProjectFilePath(project: string, filePath: string, branch?: string): string {
  return buildProjectApiPath(project, `files/${encodeFilePath(filePath)}`, branch);
}

export function slugToName(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
