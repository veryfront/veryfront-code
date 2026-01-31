import { MDX } from "veryfront/mdx";
import { getPost, getPosts } from "../../../lib/posts.ts";
import { formatDate } from "../../../lib/utils.ts";

export default async function BlogPost({
  params,
}: {
  params: { slug: string };
}): Promise<JSX.Element> {
  const post = await getPost(params.slug);

  if (!post) {
    return <div>Post not found</div>;
  }

  const hasTags = !!post.tags?.length;

  return (
    <article className="prose lg:prose-lg mx-auto">
      <header className="mb-8">
        <h1 className="mb-2">{post.title}</h1>
        <div className="text-gray-600">
          <time>{formatDate(post.date)}</time>
          {post.author && <span> · By {post.author}</span>}
        </div>

        {hasTags && (
          <div className="flex gap-2 mt-4">
            {post.tags!.map((tag) => (
              <span
                key={tag}
                className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>

      <MDX source={post.content} />
    </article>
  );
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const posts = await getPosts();
  return posts.map((post) => ({ slug: post.slug }));
}
