export default function HomePage() {
  return (
    <div className="text-center py-16">
      <h1 className="text-4xl font-bold mb-4">Welcome to Veryfront Auth Example</h1>
      <p className="text-xl text-gray-600 my-8">
        This example demonstrates a complete authentication system.
      </p>
      <div className="flex gap-4 justify-center mt-12">
        <a
          href="/signup"
          className="px-8 py-3 bg-blue-500 text-white rounded-md font-bold hover:bg-blue-600 transition-colors"
        >
          Get Started
        </a>
        <a
          href="/login"
          className="px-8 py-3 bg-white text-blue-500 rounded-md font-bold border-2 border-blue-500 hover:bg-blue-50 transition-colors"
        >
          Login
        </a>
      </div>

      <div className="mt-16 p-8 bg-white rounded-lg max-w-md mx-auto">
        <h2 className="text-2xl font-semibold mb-4">Features</h2>
        <ul className="text-left space-y-2">
          <li>User registration</li>
          <li>Secure login</li>
          <li>JWT authentication</li>
          <li>Protected routes</li>
          <li>Session management</li>
        </ul>
      </div>
    </div>
  );
}
