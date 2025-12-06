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
    <div>
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-2">
          Veryfront RSC Demo
        </h1>
        <p className="text-neutral-500 dark:text-neutral-400">
          React Server Components demonstration
        </p>
      </div>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">
          Server-like Data
        </h2>
        <div className="bg-neutral-50 dark:bg-neutral-800 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-700">
          <p className="text-neutral-500 dark:text-neutral-400 text-sm mb-3">
            In a full RSC setup, this content would be rendered on the server.
          </p>
          <div className="space-y-2">
            <p className="text-neutral-900 dark:text-white">
              <span className="text-neutral-500 dark:text-neutral-400">
                Server time:{" "}
              </span>
              {serverTime || "Loading..."}
            </p>
            <p className="text-neutral-900 dark:text-white">
              <span className="text-neutral-500 dark:text-neutral-400">
                Fetched data:{" "}
              </span>
              {data?.message || "Loading..."}
            </p>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">
          Interactive Component
        </h2>
        <div className="bg-blue-50 dark:bg-blue-900/20 p-5 rounded-2xl border border-blue-200 dark:border-blue-800">
          <p className="text-neutral-600 dark:text-neutral-400 text-sm mb-4">
            This is a client component with React state.
          </p>
          <p className="text-2xl font-semibold text-neutral-900 dark:text-white mb-4">
            Count: {count}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setCount(count + 1)}
              className="px-5 py-2.5 bg-blue-500 text-white font-medium rounded-xl hover:bg-blue-600 transition-colors"
            >
              Increment
            </button>
            <button
              type="button"
              onClick={() => setCount(count - 1)}
              className="px-5 py-2.5 bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-white font-medium rounded-xl hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors"
            >
              Decrement
            </button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">
          RSC Benefits
        </h2>
        <div className="bg-neutral-50 dark:bg-neutral-800 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-700">
          <ul className="space-y-2">
            {[
              "Server components have zero client-side JavaScript",
              "Direct database/API access on the server",
              "Client components only ship interactive code",
              "Automatic code splitting at component boundaries",
            ].map((benefit, i) => (
              <li
                key={i}
                className="flex items-center gap-3 text-neutral-600 dark:text-neutral-400"
              >
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0"></span>
                {benefit}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
