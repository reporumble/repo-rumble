// Cloudflare Pages Function — proxies GitHub API requests
// and injects the server-side token so it's never exposed to clients.
//
// The GITHUB_TOKEN secret must be set in Cloudflare Pages:
//   Dashboard → Pages → reporumble → Settings → Environment variables
//   Add: GITHUB_TOKEN = ghp_xxxx (encrypt it)

const ALLOWED_PREFIXES = [
  '/repos/',
  '/search/repositories',
  '/user',
];

export async function onRequest(context) {
  const { request, env, params } = context;

  // Only allow GET requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Reconstruct the GitHub API path from the catch-all param
  const ghPath = '/' + (params.path || []).join('/');
  const url = new URL(request.url);
  const ghUrl = `https://api.github.com${ghPath}${url.search}`;

  // Only proxy known-safe GitHub API endpoints
  if (!ALLOWED_PREFIXES.some(p => ghPath.startsWith(p))) {
    return new Response('Endpoint not allowed', { status: 403 });
  }

  // Build headers — prefer user's own token if provided, else use server token
  const headers = { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'RepoRumble' };
  const authHeader = request.headers.get('Authorization');
  if (authHeader) {
    // User supplied their own token — pass it through
    headers.Authorization = authHeader;
  } else if (env.GITHUB_TOKEN) {
    // Use the server-side secret token
    headers.Authorization = `token ${env.GITHUB_TOKEN}`;
  }

  const ghResp = await fetch(ghUrl, { headers });

  // Forward the response with rate-limit headers and CORS
  const respHeaders = corsHeaders(request);
  for (const h of ['X-RateLimit-Remaining', 'X-RateLimit-Limit', 'X-RateLimit-Reset', 'Content-Type', 'Link']) {
    const v = ghResp.headers.get(h);
    if (v) respHeaders[h] = v;
  }

  return new Response(ghResp.body, { status: ghResp.status, headers: respHeaders });
}

function corsHeaders(request) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Accept',
  };
}
