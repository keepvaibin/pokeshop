import { NextRequest } from 'next/server';
import { proxyToDjango } from '@/app/lib/api-proxy';

function proxyToDjangoApiPath(request: NextRequest) {
  return proxyToDjango(request, { stripPathPrefix: '/api-proxy' });
}

export const GET     = proxyToDjangoApiPath;
export const POST    = proxyToDjangoApiPath;
export const PUT     = proxyToDjangoApiPath;
export const PATCH   = proxyToDjangoApiPath;
export const DELETE  = proxyToDjangoApiPath;
export const HEAD    = proxyToDjangoApiPath;
export const OPTIONS = proxyToDjangoApiPath;

export const runtime = 'nodejs';