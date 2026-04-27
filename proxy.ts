import { NextResponse } from 'next/server';

// Next.js 16 renamed "middleware" to "proxy". This file activates
// `skipTrailingSlashRedirect: true` from next.config.ts, which prevents
// Next.js from 308-redirecting every /api/foo/ → /api/foo. Without this
// file, the flag is ignored, slashes are stripped, Django (APPEND_SLASH=False)
// returns 404, and the browser is stuck in an infinite 308 ↔ 404 loop.
export function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
