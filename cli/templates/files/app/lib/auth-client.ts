type AuthErrorResponse = { error?: string };

async function postJson<TBody, TResponse>(url: string, body: TBody, fallbackError: string): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = (await response.json()) as AuthErrorResponse;
    throw new Error(error?.error ?? fallbackError);
  }

  return (await response.json()) as TResponse;
}

export async function login(email: string, password: string): Promise<any> {
  return postJson("/api/auth/login", { email, password }, "Login failed");
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/";
}

export async function register(data: { email: string; password: string; name: string }): Promise<any> {
  return postJson("/api/auth/register", data, "Registration failed");
}
