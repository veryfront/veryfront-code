export default function RootLayout(
  { children }: { children: React.ReactNode },
) {
  return (
    <html>
      <head>
        <title>Minimal App Router</title>
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
