export default function ProtectedPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-green-600">Protected Content</h1>
      <p className="mt-4">
        You are seeing this because you passed the Auth Guard middleware!
      </p>
    </div>
  );
}
