export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <main className="mx-auto max-w-2xl px-6 py-16">{children}</main>
    </div>
  );
}
