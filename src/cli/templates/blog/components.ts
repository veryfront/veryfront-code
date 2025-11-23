/**
 * Blog template - Components
 */

import type { TemplateFile } from "../types.ts";

export const blogComponentTemplates: TemplateFile[] = [
  {
    path: "components/BlogPostList.tsx",
    content: `import * as React from "react";
import { formatDate } from "../lib/utils";

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
              href={\`/blog/\${post.slug}\`}
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
            href={\`/blog/\${post.slug}\`}
            className="text-blue-600 hover:underline mt-2 inline-block"
          >
            Read more →
          </a>
        </article>
      ))}
    </div>
  );
}`,
  },
  {
    path: "components/MDXContent.tsx",
    content: `'use client';

import * as React from "react";
import { MDXProvider } from "@mdx-js/react";

const components = {
  // Add custom components here
  pre: ({ children, ...props }: React.ComponentProps<'pre'>) => (
    <pre {...props} className="bg-gray-100 p-4 rounded-lg overflow-x-auto">
      {children}
    </pre>
  ),
  code: ({ children, ...props }: React.ComponentProps<'code'>) => (
    <code {...props} className="bg-gray-100 px-1 py-0.5 rounded text-sm">
      {children}
    </code>
  ),
};

export function MDXContent({ content }: { content: React.ReactNode }) {
  return (
    <MDXProvider components={components}>
      {content}
    </MDXProvider>
  );
}`,
  },
];
