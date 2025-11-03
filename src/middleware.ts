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

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
