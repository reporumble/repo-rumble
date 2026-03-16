// Cloudflare Worker — proxies /api/* requests to GitHub API
// and injects the GITHUB_TOKEN secret so it's never exposed to clients.
//
// Set GITHUB_TOKEN in Cloudflare dashboard:
//   Workers & Pages → repo-rumble → Settings → Variables and Secrets

const ALLOWED_PREFIXES = [
  '/repos/',
  '/search/repositories',
  '/user',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Only handle /api/* routes — everything else is static assets
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Strip /api prefix to get the GitHub API path
    const ghPath = url.pathname.replace(/^\/api/, '');
    const ghUrl = `https://api.github.com${ghPath}${url.search}`;

    // Only proxy known-safe GitHub API endpoints
    if (!ALLOWED_PREFIXES.some(p => ghPath.startsWith(p))) {
      return new Response('Endpoint not allowed', { status: 403 });
    }

    // Build headers — prefer user's own token if provided, else use server token
    const headers = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'RepoRumble',
    };
    const authHeader = request.headers.get('Authorization');
    if (authHeader) {
      headers.Authorization = authHeader;
    } else if (env.GITHUB_TOKEN) {
      headers.Authorization = `token ${env.GITHUB_TOKEN}`;
    }

    const ghResp = await fetch(ghUrl, { headers });

    // Forward the response with rate-limit headers and CORS
    const respHeaders = corsHeaders();
    for (const h of ['X-RateLimit-Remaining', 'X-RateLimit-Limit', 'X-RateLimit-Reset', 'Content-Type', 'Link']) {
      const v = ghResp.headers.get(h);
      if (v) respHeaders[h] = v;
    }

    return new Response(ghResp.body, { status: ghResp.status, headers: respHeaders });
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Accept',
  };
}
