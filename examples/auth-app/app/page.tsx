export default function HomePage() {
  return (
    <div className="text-center py-16">
      <h1 className="text-4xl font-bold text-neutral-900 dark:text-white mb-4">Welcome to Auth Example</h1>
      <p className="text-lg text-neutral-600 dark:text-neutral-400 my-8 max-w-md mx-auto">
        A complete authentication system with secure sessions and protected routes.
      </p>
      <div className="flex gap-3 justify-center mt-12">
        <a
          href="/signup"
          className="px-6 py-3 bg-blue-500 text-white rounded-full font-medium hover:bg-blue-600 transition-colors"
        >
          Get Started
        </a>
        <a
          href="/login"
          className="px-6 py-3 bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white rounded-full font-medium hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
        >
          Login
        </a>
      </div>

      <div className="mt-16 p-8 bg-neutral-50 dark:bg-neutral-800 rounded-2xl max-w-md mx-auto border border-neutral-200 dark:border-neutral-700">
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-white mb-4">Features</h2>
        <ul className="text-left space-y-3 text-neutral-600 dark:text-neutral-400">
          <li className="flex items-center gap-3">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            User registration
          </li>
          <li className="flex items-center gap-3">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Secure login
          </li>
          <li className="flex items-center gap-3">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            JWT authentication
          </li>
          <li className="flex items-center gap-3">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Protected routes
          </li>
          <li className="flex items-center gap-3">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Session management
          </li>
        </ul>
      </div>
    </div>
  );
}
