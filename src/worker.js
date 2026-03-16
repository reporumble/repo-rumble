// Cloudflare Worker — proxies /api/* to GitHub API + public leaderboard via KV
//
// Secrets (set in Cloudflare dashboard):
//   GITHUB_TOKEN — GitHub personal access token
// Bindings (set in Cloudflare dashboard):
//   LEADERBOARD — KV namespace for global leaderboard

const ALLOWED_PREFIXES = [
  '/repos/',
  '/search/repositories',
  '/user',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // ---- LEADERBOARD ROUTES ----
    if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
      return handleGetLeaderboard(env);
    }

    if (url.pathname === '/api/leaderboard/fight' && request.method === 'POST') {
      return handlePostFight(request, env);
    }

    // ---- GITHUB PROXY (GET only) ----
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    const ghPath = url.pathname.replace(/^\/api/, '');
    const ghUrl = `https://api.github.com${ghPath}${url.search}`;

    if (!ALLOWED_PREFIXES.some(p => ghPath.startsWith(p))) {
      return new Response('Endpoint not allowed', { status: 403 });
    }

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

    const respHeaders = corsHeaders();
    for (const h of ['X-RateLimit-Remaining', 'X-RateLimit-Limit', 'X-RateLimit-Reset', 'Content-Type', 'Link']) {
      const v = ghResp.headers.get(h);
      if (v) respHeaders[h] = v;
    }

    return new Response(ghResp.body, { status: ghResp.status, headers: respHeaders });
  },
};

// ==================== LEADERBOARD HANDLERS ====================

async function handleGetLeaderboard(env) {
  if (!env.LEADERBOARD) {
    return json([], 200);
  }
  const data = await env.LEADERBOARD.get('leaderboard:top50');
  return json(JSON.parse(data || '[]'), 200);
}

async function handlePostFight(request, env) {
  if (!env.LEADERBOARD) {
    return json({ error: 'Leaderboard not configured' }, 503);
  }

  // Rate limit by IP: 10 fights per minute
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `ratelimit:${ip}`;
  const rlVal = await env.LEADERBOARD.get(rlKey);
  const rlCount = rlVal ? parseInt(rlVal) : 0;
  if (rlCount >= 10) {
    return json({ error: 'Rate limited. Try again in a minute.' }, 429);
  }
  await env.LEADERBOARD.put(rlKey, String(rlCount + 1), { expirationTtl: 60 });

  // Parse and validate
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { winner, loser, stage } = body;
  if (!winner?.name || !loser?.name) {
    return json({ error: 'Missing winner/loser name' }, 400);
  }
  const repoPattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
  if (!repoPattern.test(winner.name) || !repoPattern.test(loser.name)) {
    return json({ error: 'Invalid repo name format' }, 400);
  }
  if (winner.name === loser.name) {
    return json({ error: 'Repos must be different' }, 400);
  }

  const now = Date.now();

  // Update winner
  const winnerData = await getRepoRecord(env, winner.name);
  winnerData.wins++;
  winnerData.avatar = winner.avatar || winnerData.avatar;
  winnerData.url = winner.url || winnerData.url;
  winnerData.className = winner.className || winnerData.className;
  winnerData.lastFight = now;
  await env.LEADERBOARD.put(`repo:${winner.name}`, JSON.stringify(winnerData));

  // Update loser
  const loserData = await getRepoRecord(env, loser.name);
  loserData.losses++;
  loserData.avatar = loser.avatar || loserData.avatar;
  loserData.url = loser.url || loserData.url;
  loserData.className = loser.className || loserData.className;
  loserData.lastFight = now;
  await env.LEADERBOARD.put(`repo:${loser.name}`, JSON.stringify(loserData));

  // Update recent fights
  let recent = [];
  try { recent = JSON.parse(await env.LEADERBOARD.get('recent') || '[]'); } catch {}
  recent.unshift({ winner: winner.name, loser: loser.name, stage: stage || '', date: now });
  if (recent.length > 100) recent.length = 100;
  await env.LEADERBOARD.put('recent', JSON.stringify(recent));

  // Rebuild top-50 cache
  await rebuildLeaderboardCache(env, winnerData, loserData);

  return json({ ok: true }, 200);
}

async function getRepoRecord(env, name) {
  const raw = await env.LEADERBOARD.get(`repo:${name}`);
  if (raw) return JSON.parse(raw);
  return { name, avatar: '', url: `https://github.com/${name}`, className: '', wins: 0, losses: 0, lastFight: 0 };
}

async function rebuildLeaderboardCache(env, ...records) {
  let top = [];
  try { top = JSON.parse(await env.LEADERBOARD.get('leaderboard:top50') || '[]'); } catch {}

  for (const rec of records) {
    const idx = top.findIndex(r => r.name === rec.name);
    if (idx >= 0) top[idx] = rec;
    else top.push(rec);
  }

  top.sort((a, b) => b.wins - a.wins || a.losses - b.losses);
  if (top.length > 50) top.length = 50;

  await env.LEADERBOARD.put('leaderboard:top50', JSON.stringify(top));
}

// ==================== HELPERS ====================

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type',
  };
}
