import { NextRequest, NextResponse } from "next/server";
import { setApiKey } from "../../../../lib/token-store.ts";

// Simple API key validation endpoint
// In production, you may want to validate the key against Stripe API
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiKey } = body;

    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 },
      );
    }

    // Validate that it looks like a Stripe key
    if (!apiKey.startsWith("sk_test_") && !apiKey.startsWith("sk_live_")) {
      return NextResponse.json(
        { error: "Invalid Stripe API key format. Key should start with sk_test_ or sk_live_" },
        { status: 400 },
      );
    }

    // Optionally validate the key by making a test API call
    try {
      const response = await fetch("https://api.stripe.com/v1/balance", {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Stripe-Version": "2024-12-18.acacia",
        },
      });

      if (!response.ok) {
        const error = await response.json();
        return NextResponse.json(
          { error: `Invalid API key: ${error.error?.message || "Authentication failed"}` },
          { status: 401 },
        );
      }
    } catch (error) {
      return NextResponse.json(
        { error: "Failed to validate API key with Stripe" },
        { status: 500 },
      );
    }

    // Store the API key
    setApiKey(apiKey);

    return NextResponse.json({
      success: true,
      message: "Stripe API key validated and stored successfully",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Get authentication status
export async function GET() {
  const apiKey = process.env.STRIPE_SECRET_KEY;

  return NextResponse.json({
    authenticated: !!apiKey,
    hasEnvKey: !!apiKey,
  });
}
