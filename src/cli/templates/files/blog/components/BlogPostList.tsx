import { formatDate } from "../lib/utils.ts";

interface Post {
  slug: string;
  title: string;
  date: string;
  excerpt?: string;
  tags?: string[];
}

export function BlogPostList({ posts }: { posts: Post[] }): JSX.Element {
  return (
    <div className="space-y-10">
      {posts.map((post) => {
        const hasExcerpt = Boolean(post.excerpt);
        const tags = post.tags ?? [];
        const hasTags = tags.length > 0;

        return (
          <article key={post.slug}>
            <a href={`/blog/${post.slug}`} className="group block">
              <time className="text-sm text-neutral-500 dark:text-neutral-400">
                {formatDate(post.date)}
              </time>
              <h2 className="text-xl font-semibold text-neutral-900 dark:text-white mt-1 group-hover:text-blue-500 transition-colors">
                {post.title}
              </h2>
              {hasExcerpt && (
                <p className="text-neutral-600 dark:text-neutral-400 mt-2 line-clamp-2">
                  {post.excerpt}
                </p>
              )}
            </a>

            {hasTags && (
              <div className="flex gap-2 mt-3">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-1 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 rounded-md text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
