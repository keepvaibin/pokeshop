import { NextRequest, NextResponse } from 'next/server';

// This file is REQUIRED for `skipTrailingSlashRedirect: true` in next.config.ts
// to take effect. Without a middleware registered on /api/* paths, Next.js ignores
// the flag and still 308-redirects every "/api/foo/" → "/api/foo", which then hits
// Django (APPEND_SLASH=False) as a no-slash URL and gets 404 — or, when Django is
// behind Azure which normalises URLs, causes a 308 ↔ 301 infinite redirect loop.
//
// By registering middleware that calls NextResponse.next() on /api/* paths, we
// satisfy the "let middleware decide" contract that skipTrailingSlashRedirect
// requires, and the trailing slash is preserved all the way to the Django backend.
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
