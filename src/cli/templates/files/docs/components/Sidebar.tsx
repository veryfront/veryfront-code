"use client";

import * as React from "react";

const navigation = [
  {
    title: "Getting Started",
    items: [
      { title: "Introduction", href: "/" },
      { title: "Installation", href: "/docs/getting-started" },
      { title: "Quick Start", href: "/docs/getting-started#quick-start" },
    ],
  },
  {
    title: "Core Concepts",
    items: [
      { title: "Overview", href: "/docs/core-concepts" },
      { title: "Architecture", href: "/docs/core-concepts#architecture" },
      { title: "Data Flow", href: "/docs/core-concepts#data-flow" },
    ],
  },
  {
    title: "API Reference",
    items: [
      { title: "Core API", href: "/docs/api" },
      { title: "Components", href: "/docs/api#components" },
      { title: "Hooks", href: "/docs/api#hooks" },
    ],
  },
];

export function Sidebar(): React.JSX.Element {
  const [pathname, setPathname] = React.useState<string>("/");

  React.useEffect(() => {
    setPathname(window.location.pathname);
  }, []);

  return (
    <aside className="w-56 shrink-0 border-r border-neutral-200 dark:border-neutral-800 min-h-[calc(100vh-3.5rem)]">
      <nav className="p-4 space-y-6 sticky top-14">
        {navigation.map((section) => (
          <div key={section.title}>
            <h3 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2 px-3">
              {section.title}
            </h3>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href;

                return (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className={[
                        "block px-3 py-1.5 text-sm rounded-lg transition-colors",
                        isActive
                          ? "bg-blue-500/10 text-blue-500 font-medium"
                          : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800",
                      ].join(" ")}
                    >
                      {item.title}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
