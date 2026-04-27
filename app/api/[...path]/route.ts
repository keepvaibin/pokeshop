/**
 * Django BFF Proxy — catches every /api/* request and forwards it verbatim
 * to the Django backend, preserving the exact pathname (including trailing
 * slash) and all client headers/body.
 *
 * Why a Route Handler instead of next.config.ts rewrites():
 *   Next.js rewrites() normalise the destination path before making the
 *   upstream fetch — they strip trailing slashes internally even when
 *   `skipTrailingSlashRedirect: true` is set.  Django's DRF DefaultRouter
 *   registers every endpoint WITH a trailing slash, so stripping it returns
 *   a 404 when APPEND_SLASH=False is set (no redirect to add it back).
 *   A Route Handler uses `request.nextUrl.pathname` which is the raw path
 *   from the HTTP request, preserving slashes exactly as sent by the client.
 */

import { NextRequest, NextResponse } from 'next/server';

// Runtime env var — available on the Node.js server at request time.
// Normalise: strip trailing slash, then strip a trailing /api segment if
// BACKEND_API_URL was set to "https://host/api" instead of "https://host".
function getDjangoBase(): string {
  const raw = (process.env.BACKEND_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '');
  return raw.replace(/\/api$/i, '');
}

// Hop-by-hop headers that must not be forwarded between proxies.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

async function proxyToDjango(request: NextRequest): Promise<NextResponse> {
  // request.nextUrl.pathname preserves the trailing slash as sent by the
  // browser, unlike params.path which splits on '/' and drops trailing slashes.
  const { pathname, search } = request.nextUrl;
  const target = `${getDjangoBase()}${pathname}${search}`;

  // Forward request headers, skipping hop-by-hop ones.
  const forwardHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  });

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  const upstream = await fetch(target, {
    method: request.method,
    headers: forwardHeaders,
    body: hasBody ? request.body : undefined,
    // Required for streaming request bodies (e.g. file uploads) in Node.js fetch.
    // @ts-expect-error -- duplex is a valid Node.js fetch option not yet in the TS types
    duplex: hasBody ? 'half' : undefined,
    // Pass redirects (Django 301 APPEND_SLASH) straight through to the client
    // rather than following them server-side, so the browser can choose.
    redirect: 'manual',
  });

  // Build the response, filtering hop-by-hop headers.
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET     = proxyToDjango;
export const POST    = proxyToDjango;
export const PUT     = proxyToDjango;
export const PATCH   = proxyToDjango;
export const DELETE  = proxyToDjango;
export const HEAD    = proxyToDjango;
export const OPTIONS = proxyToDjango;

// Use the Node.js runtime so we get real streaming fetch + full body support.
export const runtime = 'nodejs';
