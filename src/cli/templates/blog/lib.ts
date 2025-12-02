/**
 * Blog template - Library utilities
 */

import type { TemplateFile } from "../types.ts";

export const blogLibTemplates: TemplateFile[] = [
  {
    path: "lib/posts.ts",
    content: `interface PostMeta {
  title: string;
  date: string;
  author?: string;
  tags?: string[];
  excerpt?: string;
}

interface Post extends PostMeta {
  slug: string;
  content: string;
}

const POSTS_DIR = pathMod ? pathMod.join(cwd(), "content", "posts") : new URL("../../content/posts", import.meta.url).pathname;

export async function getPosts(): Promise<Post[]> {
  const posts: Post[] = [];

  try {
    let entries: { name: string; isFile: boolean; isDirectory: boolean }[] = [];
    for await (const entry of fs.readDir(POSTS_DIR)) {
      entries.push(entry);
    }

    for (const entry of entries) {
      if (entry.isFile && entry.name.endsWith(".mdx")) {
        const slug = entry.name.replace(/\\.mdx$/, "");
        const content = await fs.readTextFile(pathMod ? pathMod.join(POSTS_DIR, entry.name) : join(POSTS_DIR, entry.name));
        const { attrs, body } = extractYaml(content) as { attrs: PostMeta; body: string };

        posts.push({
          slug,
          content: body,
          ...attrs,
        });
      }
    }
  } catch (error) {
    console.error("Error reading posts:", error);
  }

  // Sort by date, newest first
  return posts.sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export async function getPost(slug: string): Promise<Post | null> {
  try {
    const content = await fs.readTextFile(pathMod ? pathMod.join(POSTS_DIR, \`\${slug}.mdx\`) : join(POSTS_DIR, \`\${slug}.mdx\`));
    const { attrs, body } = extractYaml(content) as { attrs: PostMeta; body: string };

    return {
      slug,
      content: body,
      ...attrs,
    };
  } catch {
    return null;
  }
}`,
  },
  {
    path: "lib/utils.ts",
    content: `export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}`,
  },
];
