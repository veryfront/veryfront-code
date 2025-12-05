"use client";

/**
 * RSC Demo Page
 *
 * Note: Full RSC support requires React Server Components runtime.
 * This demo shows client-side rendering with React 19 patterns.
 */

import { useState, useEffect } from "react";

export default function HomePage() {
  const [count, setCount] = useState(10);
  const [serverTime, setServerTime] = useState<string | null>(null);
  const [data, setData] = useState<{ message: string } | null>(null);

  useEffect(() => {
    // Simulate server-side data that would be available in RSC
    setServerTime(new Date().toISOString());
    // Simulate data fetching
    const timer = setTimeout(() => {
      setData({ message: "Hello from the server!" });
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="p-5 font-sans max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Veryfront RSC Demo</h1>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Server-like Data</h2>
        <p className="text-gray-600 mb-2">In a full RSC setup, this content would be rendered on the server.</p>
        <p className="text-gray-700">Server time: {serverTime || "Loading..."}</p>
        <p className="text-gray-700">Fetched data: {data?.message || "Loading..."}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Interactive Component</h2>
        <p className="text-gray-600 mb-3">The counter below demonstrates client-side interactivity:</p>
        <div className="border-2 border-blue-500 p-4 rounded-lg bg-blue-50 my-3">
          <p className="mb-2">This is a client component with React state.</p>
          <p className="text-lg font-semibold mb-3">Count: {count}</p>
          <button
            type="button"
            onClick={() => setCount(count + 1)}
            className="px-4 py-2 bg-blue-600 text-white rounded mr-3 hover:bg-blue-700 transition-colors"
          >
            Increment
          </button>
          <button
            type="button"
            onClick={() => setCount(count - 1)}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
          >
            Decrement
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">RSC Benefits (when enabled)</h2>
        <ul className="list-disc list-inside space-y-1 text-gray-700">
          <li>Server components have zero client-side JavaScript</li>
          <li>Direct database/API access on the server</li>
          <li>Client components only ship interactive code</li>
          <li>Automatic code splitting at component boundaries</li>
        </ul>
      </section>
    </div>
  );
}
