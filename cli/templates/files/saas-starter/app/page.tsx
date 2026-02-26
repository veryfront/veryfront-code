export default function LandingPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      {/* Nav */}
      <nav className="border-b border-neutral-100 dark:border-neutral-900">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 h-14">
          <span className="font-semibold text-neutral-900 dark:text-white">
            AI SaaS
          </span>
          <div className="flex items-center gap-4">
            <a
              href="/login"
              className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
            >
              Sign in
            </a>
            <a
              href="/login"
              className="text-sm px-4 py-1.5 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-full font-medium hover:opacity-90 transition-opacity"
            >
              Get started
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main className="max-w-5xl mx-auto px-6">
        <div className="pt-24 pb-16 text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-neutral-900 dark:text-white">
            Your AI-powered platform
          </h1>
          <p className="mt-4 text-lg text-neutral-500 dark:text-neutral-400 max-w-lg mx-auto">
            Built with Veryfront. Agents, tools, and memory — ready for
            production.
          </p>
          <div className="mt-8 flex gap-3 justify-center">
            <a
              href="/login"
              className="px-6 py-2.5 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-full font-medium hover:opacity-90 transition-opacity"
            >
              Start free
            </a>
            <a
              href="https://veryfront.com/code/guides"
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
              desc: "Define agents with tools, memory, and streaming — auto-discovered from your project.",
            },
            {
              title: "Per-User Memory",
              desc: "Each user gets their own conversation history, persisted across sessions.",
            },
            {
              title: "Production Ready",
              desc: "Auth, rate limiting, and deploy — ship to production with one command.",
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
