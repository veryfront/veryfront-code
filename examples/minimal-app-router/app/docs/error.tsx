"use client";

export default function ErrorBoundary({ error }: { error?: unknown }) {
  return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-6 rounded-2xl">
      <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">
        Something went wrong
      </h3>
      <pre className="text-sm text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 p-3 rounded-xl overflow-auto">
        {String((error as { message?: string })?.message ?? error ?? "Unknown error")}
      </pre>
    </div>
  );
}
