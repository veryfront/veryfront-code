import { BlogPostList } from "../components/BlogPostList.tsx";
import { getPosts } from "../lib/posts.ts";

export default async function HomePage() {
  const posts = await getPosts();

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8">Latest Posts</h1>
      <BlogPostList posts={posts} />
    </div>
  );
}