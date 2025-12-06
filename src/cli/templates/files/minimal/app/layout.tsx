export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css"
        />
      </head>
      <body className="p-8">
        {children}
      </body>
    </html>
  );
}
