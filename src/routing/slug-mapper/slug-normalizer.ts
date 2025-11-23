export function normalizeSlug(slug: string): string {
  return slug
    .split("/")
    .filter((part) => part.length > 0)
    .join("/");
}

export function slugToPath(slug: string): string {
  const normalized = normalizeSlug(slug);
  return normalized ? `/${normalized}` : "/";
}

export function pathToSlug(path: string): string {
  return normalizeSlug(path.replace(/^\//, ""));
}

export function getSlugFromPath(filePath: string): string {
  const parts = filePath.split("/");
  const fileName = parts[parts.length - 1] || "";

  const slug = fileName.replace(/\.(mdx?|tsx?|jsx?|ts|js)$/, "");

  if (slug === "index" || slug === "page") {
    const parentDir = parts[parts.length - 2];
    return parentDir === "pages" || parentDir === "app" ? "" : parentDir || "";
  }

  return slug;
}
