export default function HomePage() {
  return (
    <div style={{ textAlign: "center", padding: "4rem 0" }}>
      <h1>Welcome to Veryfront Auth Example</h1>
      <p style={{ fontSize: "1.2rem", color: "#666", margin: "2rem 0" }}>
        This example demonstrates a complete authentication system.
      </p>
      <div
        style={{
          display: "flex",
          gap: "1rem",
          justifyContent: "center",
          marginTop: "3rem",
        }}
      >
        <a
          href="/signup"
          style={{
            padding: "0.75rem 2rem",
            backgroundColor: "#0070f3",
            color: "white",
            textDecoration: "none",
            borderRadius: "5px",
            fontWeight: "bold",
          }}
        >
          Get Started
        </a>
        <a
          href="/login"
          style={{
            padding: "0.75rem 2rem",
            backgroundColor: "white",
            color: "#0070f3",
            textDecoration: "none",
            borderRadius: "5px",
            border: "2px solid #0070f3",
            fontWeight: "bold",
          }}
        >
          Login
        </a>
      </div>

      <div
        style={{
          marginTop: "4rem",
          padding: "2rem",
          backgroundColor: "white",
          borderRadius: "8px",
        }}
      >
        <h2>Features</h2>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            textAlign: "left",
            maxWidth: "400px",
            margin: "0 auto",
          }}
        >
          <li>✅ User registration</li>
          <li>✅ Secure login</li>
          <li>✅ JWT authentication</li>
          <li>✅ Protected routes</li>
          <li>✅ Session management</li>
        </ul>
      </div>
    </div>
  );
}
