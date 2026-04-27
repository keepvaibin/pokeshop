import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const nextConfig = read('next.config.ts');
const proxy = read('proxy.ts');
const routeHandler = read(path.join('app', 'api', '[...path]', 'route.ts'));
const cacheSafeRouteHandler = read(path.join('app', 'api-proxy', '[...path]', 'route.ts'));
const sharedProxy = read(path.join('app', 'lib', 'api-proxy.ts'));
const apiHelper = read(path.join('app', 'lib', 'api.ts'));

assert(
  /skipTrailingSlashRedirect\s*:\s*true/.test(nextConfig),
  'next.config.ts must keep skipTrailingSlashRedirect: true for /api/* paths.'
);

assert(
  !/\basync\s+rewrites\s*\(/.test(nextConfig) && !/\brewrites\s*:\s*(async\s*)?\(/.test(nextConfig),
  'next.config.ts must not reintroduce rewrites(); it strips Django trailing slashes.'
);

assert(
  /matcher\s*:\s*\[[^\]]*['"]\/api\/:path\*['"][^\]]*['"]\/api-proxy\/:path\*['"][^\]]*\]/s.test(proxy),
  'proxy.ts must keep matchers for /api/:path* and /api-proxy/:path* so Next.js applies the trailing-slash setting.'
);

assert(
  /request\.nextUrl/.test(sharedProxy) && /\bpathname\b/.test(sharedProxy),
  'app/lib/api-proxy.ts must proxy request.nextUrl.pathname to preserve trailing slashes.'
);

assert(
  /redirect\s*:\s*['"]manual['"]/.test(sharedProxy),
  'app/lib/api-proxy.ts must use redirect: manual so upstream redirects are visible during failures.'
);

assert(
  /API_BASE_URL\s*=\s*['"]\/api-proxy['"]/.test(apiHelper),
  'app/lib/api.ts must keep browser API calls on /api-proxy to bypass stale permanent /api redirect caches.'
);

assert(
  /stripPathPrefix\s*:\s*['"]\/api-proxy['"]/.test(cacheSafeRouteHandler),
  'app/api-proxy/[...path]/route.ts must strip /api-proxy before forwarding to Django /api paths.'
);

for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
  assert(
    new RegExp(`export\\s+const\\s+${method}\\s*=\\s*proxyToDjangoApiPath`).test(routeHandler),
    `app/api/[...path]/route.ts must export ${method} = proxyToDjangoApiPath.`
  );
  assert(
    new RegExp(`export\\s+const\\s+${method}\\s*=\\s*proxyToDjangoApiPath`).test(cacheSafeRouteHandler),
    `app/api-proxy/[...path]/route.ts must export ${method} = proxyToDjangoApiPath.`
  );
}

console.log('API proxy regression checks passed.');