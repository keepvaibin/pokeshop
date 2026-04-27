import { NextRequest, NextResponse } from 'next/server';

// Runtime env var available on the Node.js server at request time.
// BACKEND_API_URL may be "https://host" or "https://host/api".
function getDjangoBase(): string {
  const raw = (process.env.BACKEND_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '');
  return raw.replace(/\/api$/i, '');
}

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

interface ProxyOptions {
  stripPathPrefix?: string;
}

export async function proxyToDjango(
  request: NextRequest,
  { stripPathPrefix = '' }: ProxyOptions = {},
): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const upstreamPathname = stripPathPrefix && pathname.startsWith(stripPathPrefix)
    ? pathname.slice(stripPathPrefix.length) || '/'
    : pathname;
  const target = `${getDjangoBase()}${upstreamPathname}${search}`;

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
    // @ts-expect-error -- duplex is a valid Node.js fetch option not yet in the TS types
    duplex: hasBody ? 'half' : undefined,
    redirect: 'manual',
  });

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