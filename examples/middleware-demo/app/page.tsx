export default function HomePage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Middleware Demo</h1>
      <p className="mt-4">
        This page is public. Check the server console for request logs.
      </p>
      <div className="mt-4 p-4 bg-gray-100 rounded">
        <p>
          Try accessing <a href="/protected" className="text-blue-600 underline">/protected</a>{" "}
          (will fail without token)
        </p>
      </div>
    </div>
  );
}
