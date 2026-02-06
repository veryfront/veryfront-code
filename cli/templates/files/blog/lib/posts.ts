import { parse as parseYaml } from "yaml";
import { join } from "veryfront/platform/path";
import { cwd, createFileSystem } from "veryfront/platform";

interface PostMeta {
  title: string;
  date: string;
  author?: string;
  tags?: string[];
  excerpt?: string;
}

export interface Post extends PostMeta {
  slug: string;
  content: string;
}

const fs = createFileSystem();

function getPostsDir(): string {
  return join(cwd(), "content", "posts");
}

function extractFrontmatter(content: string): { attrs: PostMeta; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return {
      attrs: { title: "Untitled", date: new Date().toISOString() },
      body: content,
    };
  }

  const attrs = parseYaml(match[1]) as PostMeta;
  return { attrs, body: match[2].trim() };
}

export async function getPosts(): Promise<Post[]> {
  const postsDir = getPostsDir();
  const posts: Post[] = [];

  try {
    for await (const entry of fs.readDir(postsDir)) {
      if (!entry.isFile || !entry.name.endsWith(".mdx")) continue;

      const slug = entry.name.replace(/\.mdx$/, "");
      const content = await fs.readTextFile(join(postsDir, entry.name));
      const { attrs, body } = extractFrontmatter(content);

      posts.push({ slug, content: body, ...attrs });
    }
  } catch (error) {
    console.error("Error reading posts:", error);
  }

  return posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function getPost(slug: string): Promise<Post | null> {
  try {
    const postsDir = getPostsDir();
    const content = await fs.readTextFile(join(postsDir, `${slug}.mdx`));
    const { attrs, body } = extractFrontmatter(content);
    return { slug, content: body, ...attrs };
  } catch {
    return null;
  }
}
