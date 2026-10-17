/** What search engines see (frontend/site-plugins.ts writes robots.txt and sitemap.xml from it at build time).
 *  Add a public page to PUBLIC_PAGES when you add its route in App.tsx; signed-in and auth pages stay out. */
export const PUBLIC_PAGES: { path: string; changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly' }[] = [
  { path: '/', changefreq: 'weekly' },
  { path: '/terms', changefreq: 'yearly' },
  { path: '/privacy', changefreq: 'yearly' },
];

/** Never crawled: the API, signed-in pages and the sign-in flow. */
export const PRIVATE_PATHS = ['/api/', '/dashboard', '/login', '/signup', '/verify', '/forgot-password'];
