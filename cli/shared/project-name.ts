/** Reject path separators and traversal so the name stays a single directory. */
export function validateProjectName(name: string): string | null {
  if (/[/\\]/.test(name)) return 'Project name cannot contain "/" or "\\"';
  if (name === "." || name === "..") return 'Project name cannot be "." or ".."';
  return null;
}
