export function normalizeSlug(slug: string): string {
  return slug.split("/").filter(Boolean).join("/");
}

export function slugToPath(slug: string): string {
  const normalized = normalizeSlug(slug);
  return normalized ? `/${normalized}` : "/";
}

export function pathToSlug(path: string): string {
  return normalizeSlug(path.replace(/^\//, ""));
}

export function getSlugFromPath(filePath: string): string {
  const parts = filePath.replaceAll("\\", "/").split("/");
  const fileName = parts.at(-1) ?? "";
  const slug = fileName.replace(/\.(mdx?|tsx?|jsx?|ts|js)$/i, "");

  if (slug !== "index" && slug !== "page") return slug;

  const parentDir = parts.at(-2) ?? "";
  if (parentDir === "pages" || parentDir === "app") return "";

  return parentDir;
}
