import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {access, readFile, readdir} from 'node:fs/promises';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = resolve(repositoryRoot, 'apps/docs');
const pageFiles = await collectMarkdown(docsRoot);

test('every documentation page has one title and appears in navigation', async () => {
  const config = await readFile(resolve(docsRoot, '.vitepress/config.mts'), 'utf8');
  const navigationRoutes = new Set([...config.matchAll(/link:\s*'\/(?!\/)([^']+)'/g)].map((match) => routeToMarkdown(match[1])));

  for (const page of pageFiles) {
    const source = await readFile(resolve(docsRoot, page), 'utf8');
    const headings = [...withoutFencedCode(source).matchAll(/^#\s+.+$/gm)];
    assert.equal(headings.length, page === 'index.md' ? 0 : 1, `${page} must have ${page === 'index.md' ? 'no Markdown H1 because the home layout supplies it' : 'exactly one H1'}`);
    assert.ok(page === 'index.md' || navigationRoutes.has(page), `${page} is not reachable from docs navigation`);
  }
});

test('local documentation links and image assets resolve', async () => {
  for (const page of pageFiles) {
    const absolutePage = resolve(docsRoot, page);
    const source = await readFile(absolutePage, 'utf8');
    const targets = [
      ...[...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]),
      ...[...source.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1]),
    ];
    for (const rawTarget of targets) {
      const target = rawTarget.split('#')[0];
      if (!target || /^(https?:|mailto:)/.test(target)) continue;
      const resolved = target.startsWith('/')
        ? resolve(docsRoot, routeToMarkdown(target.slice(1)))
        : resolve(dirname(absolutePage), target);
      await assert.doesNotReject(access(resolved), `${page} has a missing local target: ${rawTarget}`);
    }
  }
});

test('CLI reference stays aligned with public help', async () => {
  const help = execFileSync('node', ['scripts/screenbranch.mjs', '--help'], {cwd: repositoryRoot, encoding: 'utf8'});
  const reference = await readFile(resolve(docsRoot, 'reference/cli.md'), 'utf8');
  const helpFlags = new Set([...help.matchAll(/--[a-z][a-z-]*/g)].map((match) => match[0]));
  const optionsSection = reference.split('## Options')[1]?.split('\n## ')[0] ?? '';
  const documentedFlags = new Set([...optionsSection.matchAll(/--[a-z][a-z-]*/g)].map((match) => match[0]));
  assert.deepEqual([...documentedFlags].sort(), [...helpFlags].sort());
});

test('first-minute copy tells people what Screenwalk opened and what to do next', async () => {
  const readme = await readFile(resolve(repositoryRoot, 'README.md'), 'utf8');
  const quickstart = await readFile(resolve(docsRoot, 'guide/quickstart.md'), 'utf8');
  const home = await readFile(resolve(docsRoot, 'index.md'), 'utf8');
  const studio = await readFile(resolve(repositoryRoot, 'apps/studio/src/App.tsx'), 'utf8');
  assert.match(readme, /what the browser opened/);
  assert.match(readme, /N of M screens opened/);
  assert.match(readme, /Copy change brief/);
  assert.match(readme, /What should change\?/);
  assert.match(readme, /Done when/);
  assert.match(quickstart, /N of M screens opened/);
  assert.match(quickstart, /Copy change brief/);
  assert.match(home, /Review the real product as a whole/i);
  assert.match(home, /say what should change and what done means/i);
  assert.match(studio, /screens opened/);
  assert.match(studio, /Copy change brief/);
  assert.doesNotMatch(studio, /A browser opened the real UI\. Click a screen, play a path, then review what still needs proof\./);
});

test('public install docs use the published Screenwalk package', async () => {
  const readme = await readFile(resolve(repositoryRoot, 'README.md'), 'utf8');
  const quickstart = await readFile(resolve(docsRoot, 'guide/quickstart.md'), 'utf8');
  assert.match(readme, /npx screenwalk \/absolute\/path\/to\/app/);
  assert.match(readme, /pnpm dlx screenwalk/);
  assert.match(quickstart, /npx screenwalk --help/);
  assert.doesNotMatch(readme, /not yet published to npm/i);
});

test('agent documentation artifacts cover every page', async () => {
  execFileSync('node', ['scripts/build-docs-artifacts.mjs'], {cwd: repositoryRoot, stdio: 'pipe'});
  const index = await readFile(resolve(docsRoot, 'public/llms.txt'), 'utf8');
  const full = await readFile(resolve(docsRoot, 'public/llms-full.txt'), 'utf8');
  for (const page of pageFiles) {
    assert.match(index, new RegExp(escapeRegex(`/markdown/${page}`)), `llms.txt omits ${page}`);
    assert.match(full, new RegExp(escapeRegex(`Source: /markdown/${page}`)), `llms-full.txt omits ${page}`);
    await access(resolve(docsRoot, 'public/markdown', page));
  }
});

async function collectMarkdown(root) {
  const files = [];
  for (const entry of await readdir(root, {withFileTypes: true})) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'public') continue;
    const absolute = resolve(root, entry.name);
    if (entry.isDirectory()) {
      for (const nested of await collectMarkdown(absolute)) files.push(`${entry.name}/${nested}`);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relative(root, absolute));
    }
  }
  return files.sort();
}

function routeToMarkdown(route) {
  if (!route || route === '/') return 'index.md';
  return `${route.replace(/^\//, '').replace(/\/$/, '')}.md`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withoutFencedCode(value) {
  return value.replace(/```[\s\S]*?```/g, '');
}
