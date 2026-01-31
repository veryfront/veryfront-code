export function HeroSection(): JSX.Element {
  return (
    <section className="py-24 md:py-32">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center max-w-3xl mx-auto">
          <p className="text-sm font-medium text-blue-500 mb-4">Starter template</p>

          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-neutral-900 dark:text-white mb-6">
            Build your app
          </h1>

          <p className="text-lg text-neutral-600 dark:text-neutral-400 mb-10 max-w-xl mx-auto">
            Full-stack starter with auth, API routes, and UI scaffolding you can customize.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/register"
              className="px-6 py-3 bg-blue-500 text-white rounded-full font-medium hover:bg-blue-600 transition-colors"
            >
              Get started
            </a>
            <a
              href="/docs"
              className="px-6 py-3 bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white rounded-full font-medium hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
            >
              Documentation
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
