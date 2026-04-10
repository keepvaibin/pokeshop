import { resolve } from "path";
import { existsSync } from "fs";

// Tailwind's internal CSS resolver (enhanced-resolve inside @tailwindcss/node)
// falls back to path.dirname(path.resolve(opts.from ?? "")) when PostCSS does
// not supply a `from` path.  In a mono-repo layout (pokeshop/ → frontend/)
// that parent-of-cwd lands on the workspace root which has no node_modules.
// globalThis.__tw_resolve is checked by @tailwindcss/node *before* it touches
// enhanced-resolve, so we can short-circuit the one problematic bare-specifier.
const tailwindCss = [
  resolve(process.cwd(), "node_modules/tailwindcss/index.css"),
  resolve(process.cwd(), "frontend/node_modules/tailwindcss/index.css"),
].find((p) => existsSync(p));

if (tailwindCss) {
  globalThis.__tw_resolve = (id) => {
    if (id === "tailwindcss") return tailwindCss;
    return null;
  };
}

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
