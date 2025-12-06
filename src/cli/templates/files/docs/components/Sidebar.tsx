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

export function Sidebar() {
  const [pathname, setPathname] = React.useState("/");

  React.useEffect(() => {
    setPathname(window.location.pathname);
  }, []);

  return (
    <aside className="w-64 border-r border-gray-200 min-h-screen">
      <nav className="p-6 space-y-8">
        {navigation.map((section) => (
          <div key={section.title}>
            <h3 className="font-semibold text-gray-900 mb-3">
              {section.title}
            </h3>
            <ul className="space-y-2">
              {section.items.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className={`block px-3 py-1.5 text-sm rounded-md transition-colors ${
                      pathname === item.href
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                    }`}
                  >
                    {item.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}