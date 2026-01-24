export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
      <main className="max-w-2xl mx-auto px-6 py-16">{children}</main>
    </div>
  );
}
