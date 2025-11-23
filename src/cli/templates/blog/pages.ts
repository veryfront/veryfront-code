/**
 * Blog template - Page templates
 */

import type { TemplateFile } from "../types.ts";

export const blogPageTemplates: TemplateFile[] = [
  {
    path: "app/layout.tsx",
    content: `import * as React from "react";

export const metadata = {
  title: "My Blog",
  description: "A blog built with Veryfront",
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css"
        />
      </head>
      <body className="bg-gray-50">
        <header className="bg-white shadow-sm">
          <nav className="max-w-4xl mx-auto px-4 py-4">
            <div className="flex justify-between items-center">
              <a href="/" className="text-xl font-bold text-gray-900">
                My Blog
              </a>
              <div className="flex gap-6">
                <a href="/" className="text-gray-600 hover:text-gray-900">
                  Home
                </a>
                <a href="/about" className="text-gray-600 hover:text-gray-900">
                  About
                </a>
                <a href="/archive" className="text-gray-600 hover:text-gray-900">
                  Archive
                </a>
              </div>
            </div>
          </nav>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-8">
          {children}
        </main>
        <footer className="bg-gray-100 mt-16">
          <div className="max-w-4xl mx-auto px-4 py-8 text-center text-gray-600">
            © 2024 My Blog. Built with Veryfront.
          </div>
        </footer>
      </body>
    </html>
  );
}`,
  },
  {
    path: "app/page.tsx",
    content: `import { BlogPostList } from "../components/BlogPostList";
import { getPosts } from "../lib/posts";

export default async function HomePage() {
  const posts = await getPosts();

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8">Latest Posts</h1>
      <BlogPostList posts={posts} />
    </div>
  );
}`,
  },
  {
    path: "app/blog/[slug]/page.tsx",
    content: `import { getPost, getPosts } from "../../../lib/posts";
import { MDXContent } from "@veryfront/components";
import { formatDate } from "../../../lib/utils";

export default async function BlogPost({
  params
}: {
  params: { slug: string }
}) {
  const post = await getPost(params.slug);

  if (!post) {
    return <div>Post not found</div>;
  }

  return (
    <article className="prose lg:prose-lg mx-auto">
      <header className="mb-8">
        <h1 className="mb-2">{post.title}</h1>
        <div className="text-gray-600">
          <time>{formatDate(post.date)}</time>
          {post.author && <span> · By {post.author}</span>}
        </div>
        {post.tags && (
          <div className="flex gap-2 mt-4">
            {post.tags.map(tag => (
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
      <MDXContent content={post.content} />
    </article>
  );
}

export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map(post => ({
    slug: post.slug,
  }));
}`,
  },
  {
    path: "app/about/page.mdx",
    content: `# About

Welcome to my blog! I write about technology, programming, and life.

## Contact

You can reach me at:
- Email: hello@example.com
- Twitter: @yourhandle
- GitHub: @yourusername

## About This Site

This blog is built with [Veryfront](https://github.com/veryfront/veryfront), a Deno-first React framework with excellent MDX support.`,
  },
  {
    path: "app/archive/page.tsx",
    content: `import { getPosts } from "../../lib/posts";
import { formatDate } from "../../lib/utils";

export default async function Archive() {
  const posts = await getPosts();
  const postsByYear = posts.reduce((acc, post) => {
    const year = new Date(post.date).getFullYear();
    if (!acc[year]) acc[year] = [];
    acc[year].push(post);
    return acc;
  }, {} as Record<number, typeof posts>);

  const years = Object.keys(postsByYear)
    .map(Number)
    .sort((a, b) => b - a);

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8">Archive</h1>
      {years.map(year => (
        <div key={year} className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">{year}</h2>
          <ul className="space-y-2">
            {postsByYear[year].map(post => (
              <li key={post.slug}>
                <a
                  href={\`/blog/\${post.slug}\`}
                  className="text-blue-600 hover:underline"
                >
                  {post.title}
                </a>
                <span className="text-gray-600 ml-2">
                  {formatDate(post.date)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}`,
  },
];
