/**
 * Blog template - Library utilities
 */

import type { TemplateFile } from "../types.ts";

export const blogLibTemplates: TemplateFile[] = [
  {
    path: "lib/posts.ts",
    content: `import { join } from "std/path/mod.ts";
import { extract } from "std/front_matter/yaml.ts";

interface PostMeta {
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

const POSTS_DIR = join(Deno.cwd(), "content", "posts");

export async function getPosts(): Promise<Post[]> {
  const posts: Post[] = [];

  try {
    for await (const entry of Deno.readDir(POSTS_DIR)) {
      if (entry.isFile && entry.name.endsWith(".mdx")) {
        const slug = entry.name.replace(/\\.mdx$/, "");
        const content = await Deno.readTextFile(join(POSTS_DIR, entry.name));
        const { attrs, body } = extract(content) as { attrs: PostMeta; body: string };

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
    const content = await Deno.readTextFile(join(POSTS_DIR, \`\${slug}.mdx\`));
    const { attrs, body } = extract(content) as { attrs: PostMeta; body: string };

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
