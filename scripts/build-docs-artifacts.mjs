#!/usr/bin/env node

import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = resolve(repositoryRoot, 'apps/docs');
const publicRoot = resolve(docsRoot, 'public');
const markdownRoot = resolve(publicRoot, 'markdown');

const preferredOrder = [
  'index.md',
  'guide/quickstart.md',
  'guide/how-it-works.md',
  'guide/frameworks.md',
  'guide/read-the-map.md',
  'guide/play-a-flow.md',
  'guide/agent-handoff.md',
  'guide/watch-mode.md',
  'guide/html-and-spas.md',
  'guide/access-gates.md',
  'guide/evidence.md',
  'reference/cli.md',
  'reference/setup-recipes.md',
  'reference/support.md',
  'reference/error-codes.md',
  'troubleshooting.md',
  'beta.md',
];

const discovered = await collectMarkdown(docsRoot);
const pages = [...discovered].sort((left, right) => {
  const leftIndex = preferredOrder.indexOf(left);
  const rightIndex = preferredOrder.indexOf(right);
  if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
  return left.localeCompare(right);
});

await rm(markdownRoot, {recursive: true, force: true});
const entries = [];
for (const page of pages) {
  const source = await readFile(resolve(docsRoot, page), 'utf8');
  const destination = resolve(markdownRoot, page);
  await mkdir(dirname(destination), {recursive: true});
  await writeFile(destination, source, 'utf8');
  entries.push({
    path: page,
    title: extractTitle(page, source),
    description: extractDescription(source),
    source: stripFrontmatter(source),
  });
}

const concise = [
  '# Screenwalk',
  '',
  '> See the app you actually built. Render every screen, connect every path, and surface the gaps.',
  '',
  'Machine-readable copies of the current documentation follow. Use the support matrix before inferring framework or source-analysis coverage.',
  '',
  ...renderIndex(entries),
  '',
].join('\n');

const full = [
  '# Screenwalk documentation',
  '',
  '> Generated from the same Markdown that builds the Screenwalk documentation site. Evidence labels and current limits are product contracts.',
  '',
  ...entries.flatMap((entry) => [
    `## ${entry.title}`,
    '',
    `Source: /markdown/${entry.path}`,
    '',
    entry.source.trim(),
    '',
    '---',
    '',
  ]),
].join('\n');

await writeFile(resolve(publicRoot, 'llms.txt'), concise, 'utf8');
await writeFile(resolve(publicRoot, 'llms-full.txt'), full, 'utf8');

const origin = normalizeOrigin(process.env.SCREENWALK_DOCS_ORIGIN);
const robots = ['User-agent: *', 'Allow: /', ...(origin ? ['', `Sitemap: ${origin}/sitemap.xml`] : []), ''].join('\n');
await writeFile(resolve(publicRoot, 'robots.txt'), robots, 'utf8');

console.log(`Generated agent docs for ${entries.length} pages.`);

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
  return files;
}

function extractTitle(path, source) {
  const heading = stripFrontmatter(source).match(/^#\s+(.+)$/m)?.[1];
  if (heading) return heading.replace(/<[^>]+>/g, '').trim();
  if (path === 'index.md') return 'Why Screenwalk';
  throw new Error(`${path} needs one H1 for machine-readable docs.`);
}

function extractDescription(source) {
  const body = stripFrontmatter(source)
    .replace(/^#\s+.+$/m, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#') && !line.startsWith('```') && !line.startsWith('<') && !line.startsWith('|') && !line.startsWith(':::'));
  return body?.replace(/[*_`>]/g, '').slice(0, 180) ?? 'Screenwalk documentation.';
}

function stripFrontmatter(source) {
  return source.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

function renderIndex(entries) {
  const groups = [
    ['Start', entries.filter((entry) => entry.path === 'index.md' || entry.path.startsWith('guide/'))],
    ['Reference', entries.filter((entry) => entry.path.startsWith('reference/') || entry.path === 'troubleshooting.md')],
    ['Status', entries.filter((entry) => entry.path === 'beta.md')],
  ];
  return groups.flatMap(([label, group]) => [
    `## ${label}`,
    '',
    ...group.map((entry) => `- [${entry.title}](/markdown/${entry.path}): ${entry.description}`),
    '',
  ]);
}

function normalizeOrigin(value) {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('SCREENWALK_DOCS_ORIGIN must use HTTPS outside localhost.');
  }
  return url.origin;
}
