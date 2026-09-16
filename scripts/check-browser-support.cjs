/**
 * Fails the build if the shipped client JS uses syntax newer than the
 * browsers this business actually runs the app on.
 *
 * Why this exists: on 2026-09-16 the business reported being unable to log
 * in on an old Windows i3 laptop, while everything looked fine on a Mac.
 * Cause: with no `browserslist` declared, Next/SWC targeted its own modern
 * default and emitted an ES2022 class static block (`static{...}`) inside
 * Next's core App Router chunk. Older Chrome refuses to parse that whole
 * chunk, so the router never initialised and React never hydrated — and
 * because every page here is server-rendered, the login form still
 * appeared, looking completely normal, with a Sign in button that silently
 * did nothing. Nothing in tsc/eslint/next build catches that, and it can't
 * be reproduced on a modern machine, which is exactly why it took a
 * round trip through the business to find.
 *
 * `browserslist` in package.json is the fix; this is the alarm that goes
 * off if a future Next/React upgrade quietly raises the floor again.
 *
 * Run: npm run check:browsers   (after a build — reads .next/static)
 */
const acorn = require('acorn');
const fs = require('fs');
const path = require('path');

// Chrome 87 (our browserslist floor) implements ES2021 in full. Anything
// requiring newer syntax than this would not parse there.
const MAX_ECMA_VERSION = 2021;
const CHUNK_DIR = path.join('.next', 'static');

function collectJs(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJs(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function parsesAt(source, ecmaVersion) {
  for (const sourceType of ['script', 'module']) {
    try {
      acorn.parse(source, { ecmaVersion, sourceType });
      return true;
    } catch {
      /* try the other sourceType */
    }
  }
  return false;
}

const files = collectJs(CHUNK_DIR, []);
if (files.length === 0) {
  console.error(`No client JS found under ${CHUNK_DIR} — run \`next build\` first.`);
  process.exit(1);
}

const tooNew = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  if (!parsesAt(source, MAX_ECMA_VERSION)) tooNew.push(file);
}

if (tooNew.length > 0) {
  console.error(
    `\n✖ ${tooNew.length} client chunk(s) use syntax newer than ES${MAX_ECMA_VERSION} ` +
      `(the floor Chrome 87 can parse):\n` +
      tooNew.map((f) => `    ${f}`).join('\n') +
      `\n\nOn an older browser these throw a SyntaxError, React never hydrates, and every\n` +
      `server-rendered page loads looking normal with buttons that silently do nothing.\n` +
      `Check the \`browserslist\` field in package.json is still being honoured.\n`
  );
  process.exit(1);
}

console.log(`✔ all ${files.length} client chunks parse as ES${MAX_ECMA_VERSION} or older`);
