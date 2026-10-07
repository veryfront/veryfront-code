export default function LandingPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      {/* Nav */}
      <nav className="border-b border-neutral-100 dark:border-neutral-900">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 h-14">
          <span className="font-semibold text-neutral-900 dark:text-white">
            AI SaaS Starter
          </span>
          <a
            href="/login"
            className="text-sm px-4 py-1.5 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-full font-medium hover:opacity-90 transition-opacity"
          >
            Preview dashboard
          </a>
        </div>
      </nav>

      {/* Hero */}
      <main className="max-w-5xl mx-auto px-6">
        <div className="pt-24 pb-16 text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-neutral-900 dark:text-white">
            Build an AI SaaS dashboard
          </h1>
          <p className="mt-4 text-lg text-neutral-500 dark:text-neutral-400 max-w-lg mx-auto">
            Start with a polished chat dashboard, an agent endpoint, and demo conversation storage.
            Add OIDC auth before you protect real users.
          </p>
          <div className="mt-8 flex gap-3 justify-center">
            <a
              href="/login"
              className="px-6 py-2.5 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-full font-medium hover:opacity-90 transition-opacity"
            >
              Preview dashboard
            </a>
            <a
              href="https://veryfront.com/docs/code/guides"
              className="px-6 py-2.5 border border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 rounded-full font-medium hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
            >
              Documentation
            </a>
          </div>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-16 border-t border-neutral-100 dark:border-neutral-900">
          {[
            {
              title: "AI Agents",
              desc:
                "Define agents with tools, memory, and streaming. Veryfront auto-discovers them from your project.",
            },
            {
              title: "Demo Memory",
              desc:
                "The starter persists preview conversations in the browser so you can test the UI immediately.",
            },
            {
              title: "OIDC Ready",
              desc:
                "Generate Veryfront's built-in OIDC scaffold when you are ready to configure provider login.",
            },
          ].map(({ title, desc }) => (
            <div key={title}>
              <h3 className="font-medium text-neutral-900 dark:text-white">
                {title}
              </h3>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                {desc}
              </p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
