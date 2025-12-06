'use client';

import React, { useState } from "react";

export function Header() {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <header className="border-b border-gray-200 bg-white sticky top-0 z-50">
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <a href="/" className="text-xl font-bold text-gray-900">
            📚 My Docs
          </a>
          <nav className="flex gap-6">
            <a href="/docs" className="text-gray-600 hover:text-gray-900">
              Docs
            </a>
            <a href="/api" className="text-gray-600 hover:text-gray-900">
              API
            </a>
            <a href="/examples" className="text-gray-600 hover:text-gray-900">
              Examples
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="search"
            placeholder="Search docs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select className="px-3 py-2 border border-gray-300 rounded-lg">
            <option>v2.0</option>
            <option>v1.0</option>
          </select>
          <a
            href="https://github.com/example/docs"
            className="text-gray-600 hover:text-gray-900"
          >
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}