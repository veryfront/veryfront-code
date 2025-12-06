import * as React from "react";
import { formatDate } from "../lib/utils.ts";

interface Post {
  slug: string;
  title: string;
  date: string;
  excerpt?: string;
  tags?: string[];
}

export function BlogPostList({ posts }: { posts: Post[] }) {
  return (
    <div className="space-y-8">
      {posts.map(post => (
        <article key={post.slug} className="border-b pb-8">
          <h2 className="text-2xl font-semibold mb-2">
            <a
              href={`/blog/${post.slug}`}
              className="text-gray-900 hover:text-blue-600"
            >
              {post.title}
            </a>
          </h2>
          <div className="text-gray-600 text-sm mb-2">
            {formatDate(post.date)}
          </div>
          {post.excerpt && (
            <p className="text-gray-700 mb-4">{post.excerpt}</p>
          )}
          {post.tags && (
            <div className="flex gap-2">
              {post.tags.map(tag => (
                <span
                  key={tag}
                  className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          <a
            href={`/blog/${post.slug}`}
            className="text-blue-600 hover:underline mt-2 inline-block"
          >
            Read more →
          </a>
        </article>
      ))}
    </div>
  );
}