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

assert(
  /skipTrailingSlashRedirect\s*:\s*true/.test(nextConfig),
  'next.config.ts must keep skipTrailingSlashRedirect: true for /api/* paths.'
);

assert(
  !/\basync\s+rewrites\s*\(/.test(nextConfig) && !/\brewrites\s*:\s*(async\s*)?\(/.test(nextConfig),
  'next.config.ts must not reintroduce rewrites(); it strips Django trailing slashes.'
);

assert(
  /matcher\s*:\s*['"]\/api\/:path\*['"]/.test(proxy),
  'proxy.ts must keep matcher: /api/:path* so Next.js applies the trailing-slash setting.'
);

assert(
  /request\.nextUrl/.test(routeHandler) && /\bpathname\b/.test(routeHandler),
  'app/api/[...path]/route.ts must proxy request.nextUrl.pathname to preserve trailing slashes.'
);

assert(
  /redirect\s*:\s*['"]manual['"]/.test(routeHandler),
  'app/api/[...path]/route.ts must use redirect: manual so upstream redirects are visible during failures.'
);

for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
  assert(
    new RegExp(`export\\s+const\\s+${method}\\s*=\\s*proxyToDjango`).test(routeHandler),
    `app/api/[...path]/route.ts must export ${method} = proxyToDjango.`
  );
}

console.log('API proxy regression checks passed.');