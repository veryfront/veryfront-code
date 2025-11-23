import { AuthProvider } from "../components/AuthProvider.tsx";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <div style={{ minHeight: "100vh", backgroundColor: "#f5f5f5" }}>
            <nav
              style={{
                backgroundColor: "white",
                padding: "1rem 2rem",
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              }}
            >
              <div
                style={{
                  maxWidth: "1200px",
                  margin: "0 auto",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Auth Example</h1>
                <div
                  style={{ display: "flex", gap: "1rem", alignItems: "center" }}
                >
                  <a href="/">Home</a>
                  <a href="/dashboard">Dashboard</a>
                  <a href="/login">Login</a>
                  <a href="/signup">Sign Up</a>
                </div>
              </div>
            </nav>
            <main
              style={{ maxWidth: "1200px", margin: "0 auto", padding: "2rem" }}
            >
              {children}
            </main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
