import type { ReactNode } from "react";

export default function BlogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="blog-layout">
      <nav>Blog Navigation</nav>
      <article>{children}</article>
      <aside>Blog Sidebar</aside>
    </div>
  );
}
