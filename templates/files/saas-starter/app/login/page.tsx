"use client";

// Dashboard preview: this page keeps the starter usable out of the box while
// making the missing auth boundary explicit. Scaffold OIDC auth before
// protecting real user data.
export default function LoginPage(): React.JSX.Element {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-xl font-bold text-neutral-900 dark:text-white">
            Preview the dashboard
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            This starter skips sign-in until you configure OIDC auth.
          </p>
        </div>

        <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-6 space-y-4">
          <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-400">
            Open the dashboard preview to test the chat UI, sidebar, and browser conversation
            storage. Add real authentication before deploying user accounts or private data.
          </p>
          <a
            href="/dashboard"
            className="flex items-center justify-center w-full px-4 py-2.5 rounded-xl bg-neutral-900 text-sm font-medium text-white hover:opacity-90 transition-opacity dark:bg-white dark:text-neutral-900"
          >
            Open dashboard preview
          </a>
        </div>

        <p className="mt-6 text-center text-xs text-neutral-400">
          <a
            href="/"
            className="hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            &larr; Back to home
          </a>
        </p>
      </div>
    </div>
  );
}
