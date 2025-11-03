import { NextRequest, NextResponse } from "next/server";

// Security: API Key validation
const API_KEY = process.env.NEXT_PUBLIC_BOSS_RAID_API_KEY;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:3000", "http://localhost:3001"];

export function middleware(request: NextRequest) {
  // Only apply middleware to API routes
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Allow GET requests to /api/bosses (public read access)
  if (request.method === "GET" && request.nextUrl.pathname === "/api/bosses") {
    return NextResponse.next();
  }

  // Allow POST requests to /api/trades (trade logging)
  if (request.method === "POST" && request.nextUrl.pathname === "/api/trades") {
    return NextResponse.next();
  }

  // For POST requests to protected routes, validate API key
  if (request.method === "POST") {
    const apiKey = request.headers.get("x-api-key");

    if (!apiKey || apiKey !== API_KEY) {
      return NextResponse.json(
        { error: "Unauthorized - Invalid API Key" },
        { status: 401 }
      );
    }

    // Additional origin validation
    const origin = request.headers.get("origin");
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return NextResponse.json(
        { error: "Unauthorized - Invalid Origin" },
        { status: 401 }
      );
    }

    // Basic bot protection via User-Agent
    const userAgent = request.headers.get("user-agent");
    if (!userAgent || userAgent.length < 10) {
      return NextResponse.json(
        { error: "Unauthorized - Invalid User Agent" },
        { status: 401 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
