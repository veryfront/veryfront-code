export default function HomePage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-4xl font-bold mb-4">
        Welcome to Veryfront
      </h1>
      <p className="text-gray-600 mb-8">
        Edit <code className="bg-gray-100 px-1 rounded">app/page.tsx</code> to get started.
      </p>
      <div className="flex gap-4">
        <a
          href="/about"
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          About
        </a>
        <a
          href="https://github.com/veryfront/veryfront"
          className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
        >
          Documentation
        </a>
      </div>
    </div>
  );
}
