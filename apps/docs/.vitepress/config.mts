import {defineConfig} from 'vitepress';

const docsOrigin = normalizeOrigin(process.env.SCREENWALK_DOCS_ORIGIN);

export default defineConfig({
  lang: 'en-US',
  title: 'Screenwalk',
  titleTemplate: ':title · Screenwalk',
  description: 'See the app you actually built.',
  srcExclude: ['public/markdown/**'],
  cleanUrls: true,
  lastUpdated: true,
  sitemap: docsOrigin ? {hostname: docsOrigin} : undefined,
  head: [
    ['meta', {name: 'theme-color', content: '#f6f1e8'}],
    ['link', {rel: 'icon', href: '/screenwalk-mark.svg'}],
    ['meta', {property: 'og:site_name', content: 'Screenwalk'}],
    ['meta', {property: 'og:type', content: 'website'}],
    ['meta', {property: 'og:title', content: 'Screenwalk — See the app you actually built'}],
    ['meta', {property: 'og:description', content: 'Render every screen, connect every path, and surface the gaps.'}],
    ['meta', {name: 'twitter:card', content: 'summary_large_image'}],
    ...(docsOrigin ? [
      ['meta', {property: 'og:image', content: `${docsOrigin}/social-card.jpg`}],
      ['meta', {name: 'twitter:image', content: `${docsOrigin}/social-card.jpg`}],
    ] as const : []),
  ],
  transformPageData(pageData) {
    if (!docsOrigin) return;
    const path = pageData.relativePath
      .replace(/(^|\/)index\.md$/, '$1')
      .replace(/\.md$/, '');
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(['link', {rel: 'canonical', href: `${docsOrigin}/${path}`}]);
  },
  themeConfig: {
    logo: {src: '/screenwalk-mark.svg', alt: 'Screenwalk'},
    siteTitle: 'Screenwalk',
    search: {provider: 'local'},
    nav: [
      {text: 'Live demo', link: 'https://screenwalk.app'},
      {text: 'Get started', link: '/guide/quickstart'},
      {text: 'Guides', link: '/guide/how-it-works'},
      {text: 'Reference', link: '/reference/cli'},
      {
        text: 'Public beta',
        items: [
          {text: 'Beta status', link: '/beta'},
          {text: 'Report an issue', link: 'https://github.com/Chipagosfinest/screenwalk-public/issues/new?template=public-beta-feedback.yml'},
        ],
      },
    ],
    sidebar: [
      {
        text: 'Start',
        items: [
          {text: 'Why Screenwalk', link: '/'},
          {text: 'Quickstart', link: '/guide/quickstart'},
          {text: 'How it works', link: '/guide/how-it-works'},
          {text: 'Framework cookbook', link: '/guide/frameworks'},
        ],
      },
      {
        text: 'Use the map',
        items: [
          {text: 'Read your product', link: '/guide/read-the-map'},
          {text: 'Play a flow', link: '/guide/play-a-flow'},
          {text: 'Review with an agent', link: '/guide/agent-handoff'},
          {text: 'Watch for UI changes', link: '/guide/watch-mode'},
        ],
      },
      {
        text: 'Capture real apps',
        items: [
          {text: 'HTML and SPAs', link: '/guide/html-and-spas'},
          {text: 'Password-gated UI', link: '/guide/access-gates'},
          {text: 'Evidence and safety', link: '/guide/evidence'},
        ],
      },
      {
        text: 'Reference',
        items: [
          {text: 'CLI', link: '/reference/cli'},
          {text: 'Journey recipes', link: '/reference/journey-recipes'},
          {text: 'Setup recipes', link: '/reference/setup-recipes'},
          {text: 'Supported apps and limits', link: '/reference/support'},
          {text: 'Error codes', link: '/reference/error-codes'},
          {text: 'Troubleshooting', link: '/troubleshooting'},
          {text: 'Public beta', link: '/beta'},
        ],
      },
    ],
    outline: {level: [2, 3], label: 'On this page'},
    docFooter: {prev: 'Previous', next: 'Next'},
    editLink: {
      pattern: 'https://github.com/Chipagosfinest/screenwalk-public/edit/main/apps/docs/:path',
      text: 'Improve this page',
    },
    socialLinks: [
      {icon: 'github', link: 'https://github.com/Chipagosfinest/screenwalk-public'},
    ],
    footer: {
      message: 'Local-first. Evidence-backed. Public beta.',
      copyright: 'Screenwalk',
    },
  },
});

function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('SCREENWALK_DOCS_ORIGIN must use HTTPS outside localhost.');
  }
  return url.origin;
}
