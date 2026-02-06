import { setApiKey } from "../../../../lib/token-store.ts";

export async function POST(request: Request): Promise<Response> {
  try {
    const { apiKey, databaseUrl } = await request.json();

    if (!apiKey) {
      return Response.json({ error: "API key is required" }, { status: 400 });
    }

    const response = await fetch("https://console.neon.tech/api/v2/projects", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return Response.json({ error: "Invalid API key" }, { status: 401 });
    }

    setApiKey(apiKey, databaseUrl);

    return Response.json({
      success: true,
      message: "Successfully authenticated with Neon",
    });
  } catch (error) {
    console.error("Neon auth error:", error);
    return Response.json({ error: "Authentication failed" }, { status: 500 });
  }
}

export function GET(): Response {
  return Response.json({
    authenticated: false,
    message: "Use POST to authenticate with API key",
  });
}
