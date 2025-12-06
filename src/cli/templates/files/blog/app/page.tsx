import { BlogPostList } from "../components/BlogPostList.tsx";
import { getPosts } from "../lib/posts.ts";

export default async function HomePage() {
  const posts = await getPosts();

  return (
    <div>
      <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-8">Latest Posts</h1>
      <BlogPostList posts={posts} />
    </div>
  );
}
