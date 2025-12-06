'use client';

import React, { useState } from "react";

interface CodeBlockProps {
  children: string;
  language?: string;
  filename?: string;
}

export function CodeBlock({
  children,
  language = "typescript",
  filename
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      {filename && (
        <div className="bg-gray-700 text-gray-300 px-4 py-2 text-sm rounded-t-lg">
          {filename}
        </div>
      )}
      <pre className={`bg-gray-800 text-gray-100 p-4 rounded-lg overflow-x-auto ${
        filename ? "rounded-t-none" : ""
      }`}>
        <code className={`language-${language}`}>{children}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 px-3 py-1 bg-gray-700 text-gray-300 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}