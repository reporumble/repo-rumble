// ==================== CONFIG ====================
const API = '/api';
let fighters = [null, null];
let battleEngine = null;
let skipMode = false;
let rematchCount = 0;

// ==================== SEEDED RNG ====================
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function battleSeed(name1, name2, extra) {
  const key = [name1, name2].sort().join('|') + (extra ? '#' + extra : '');
  return hashString(key);
}

// ==================== REPO CACHE ====================
const CACHE_KEY = 'repo-rumble-cache';
const CACHE_TTL = 24 * 60 * 60 * 1000;
const CACHE_MAX = 50;

function getCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}

function getCachedFighter(name) {
  const cache = getCache();
  const entry = cache[name.toLowerCase()];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) return null;
  entry.ts = Date.now();
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  return entry.fighter;
}

function setCachedFighter(name, fighter) {
  const cache = getCache();
  cache[name.toLowerCase()] = { fighter, ts: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    keys.sort((a, b) => cache[a].ts - cache[b].ts);
    for (let i = 0; i < keys.length - CACHE_MAX; i++) delete cache[keys[i]];
  }
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

// ==================== LEADERBOARD ====================
const LB_KEY = 'repo-rumble-leaderboard';
let leaderboardMode = 'global';

function getLeaderboard() {
  try { return JSON.parse(localStorage.getItem(LB_KEY) || '{"fighters":{},"history":[]}'); }
  catch { return { fighters: {}, history: [] }; }
}

function recordFight(winner, loser, stage) {
  const lb = getLeaderboard();
  if (!lb.fighters[winner.name]) lb.fighters[winner.name] = { wins: 0, losses: 0, avatar: winner.avatar, className: winner.className, url: winner.url };
  lb.fighters[winner.name].wins++;
  lb.fighters[winner.name].avatar = winner.avatar;
  if (!lb.fighters[loser.name]) lb.fighters[loser.name] = { wins: 0, losses: 0, avatar: loser.avatar, className: loser.className, url: loser.url };
  lb.fighters[loser.name].losses++;
  lb.fighters[loser.name].avatar = loser.avatar;
  lb.history.unshift({ p1: winner.name, p2: loser.name, winner: winner.name, stage: stage || '', date: Date.now() });
  if (lb.history.length > 50) lb.history.length = 50;
  localStorage.setItem(LB_KEY, JSON.stringify(lb));
}

async function submitFightToServer(winner, loser, stage) {
  try {
    await fetch('/api/leaderboard/fight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        winner: { name: winner.name, avatar: winner.avatar, url: winner.url, className: winner.className },
        loser: { name: loser.name, avatar: loser.avatar, url: loser.url, className: loser.className },
        stage: stage || '',
      }),
    });
  } catch (e) { /* silent fail — local leaderboard still works */ }
}

function switchLeaderboard(mode) {
  leaderboardMode = mode;
  document.getElementById('lb-tab-global').classList.toggle('active', mode === 'global');
  document.getElementById('lb-tab-local').classList.toggle('active', mode === 'local');
  renderLeaderboard();
}

async function renderLeaderboard() {
  const container = document.getElementById('lb-body');

  if (leaderboardMode === 'global') {
    container.innerHTML = '<tr><td colspan="6" class="lb-empty"><span class="spinner"></span> Loading...</td></tr>';
    try {
      const resp = await fetch('/api/leaderboard');
      if (!resp.ok) throw new Error('Failed');
      const entries = await resp.json();
      renderLeaderboardEntries(container, entries);
    } catch (e) {
      container.innerHTML = '<tr><td colspan="6" class="lb-empty">Could not load global leaderboard</td></tr>';
    }
  } else {
    const lb = getLeaderboard();
    const entries = Object.entries(lb.fighters)
      .map(([name, data]) => ({ name, ...data, total: data.wins + data.losses, winrate: data.wins / Math.max(1, data.wins + data.losses) }))
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses);
    renderLeaderboardEntries(container, entries);
  }
}

function renderLeaderboardEntries(container, entries) {
  if (!entries || entries.length === 0) {
    container.innerHTML = '<tr><td colspan="6" class="lb-empty">No fights yet. Battle some repos!</td></tr>';
    return;
  }
  container.innerHTML = entries.slice(0, 50).map((e, i) => {
    const total = e.total || (e.wins + e.losses);
    const winrate = e.winrate != null ? e.winrate : (e.wins / Math.max(1, total));
    const avatar = e.avatar || '';
    const url = e.url || `https://github.com/${e.name}`;
    return `<tr>
      <td class="lb-rank ${i === 0 ? 'lb-rank-1' : ''}">${i + 1}</td>
      <td class="lb-name">
        ${avatar ? `<img class="lb-avatar" src="${avatar}" alt="">` : ''}
        <a href="${url}" target="_blank" rel="noopener">${e.name}</a>
      </td>
      <td class="lb-wins">${e.wins}</td>
      <td class="lb-losses">${e.losses}</td>
      <td class="lb-total">${total}</td>
      <td class="lb-winrate" style="color:${winrate >= 0.6 ? 'var(--green)' : winrate >= 0.4 ? 'var(--yellow)' : 'var(--red)'}">${Math.round(winrate * 100)}%</td>
    </tr>`;
  }).join('');
}

// ==================== ROSTER (Recent Fighters) ====================
function renderRoster() {
  const cache = getCache();
  const grid = document.getElementById('roster-grid');
  if (!grid) return;

  const entries = Object.values(cache)
    .filter(e => e.fighter && Date.now() - e.ts < CACHE_TTL)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 12);

  if (entries.length === 0) {
    grid.innerHTML = '';
    return;
  }

  grid.innerHTML = entries.map(e => {
    const f = e.fighter;
    return `<div class="roster-chip" onclick="loadRoster('${f.name}')" title="${f.name} - ${f.className}">
      <img src="${f.avatar}" alt=""> ${f.shortName}
    </div>`;
  }).join('');
}

function loadRoster(name) {
  // Find which slot to fill (prefer empty, then slot 1)
  const slot = !fighters[0] ? 1 : !fighters[1] ? 2 : 1;
  document.getElementById(`repo-input-${slot}`).value = name;
  scanRepo(slot);
}

// ==================== RATE LIMIT TRACKING ====================
let rateRemaining = null;
let rateTotal = null;
let rateReset = null;

function updateRateLimitUI() {
  const bar = document.getElementById('rate-limit-bar');
  if (rateRemaining === null) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  bar.className = 'rate-limit-bar' + (rateRemaining <= 5 ? ' critical' : rateRemaining <= 15 ? ' warning' : '');
  if (rateRemaining <= 5 && rateReset) {
    const mins = Math.ceil((rateReset * 1000 - Date.now()) / 60000);
    bar.innerHTML = mins > 0
      ? `API: ${rateRemaining}/${rateTotal} - Resets in ${mins}m <a onclick="toggleToken()">Add token</a>`
      : `API: ${rateRemaining}/${rateTotal}`;
  } else {
    bar.textContent = `API: ${rateRemaining}/${rateTotal}`;
  }
}

// ==================== GITHUB TOKEN ====================
function saveToken(val) { localStorage.setItem('repo-rumble-token', val.trim()); }
function getToken() { return (localStorage.getItem('repo-rumble-token') || '').trim(); }
function toggleToken() {
  if (document.querySelector('#title-screen.active')) {
    document.getElementById('token-area').classList.toggle('visible');
    return;
  }
  const current = getToken();
  const val = prompt('Enter GitHub personal access token (increases limit to 5,000/hr):', current);
  if (val !== null) {
    const trimmed = val.trim();
    document.getElementById('gh-token').value = trimmed;
    saveToken(trimmed);
    if (trimmed) validateToken(trimmed);
    else showToast('Token cleared');
  }
}

function setTokenStatus(text, color) {
  const el = document.getElementById('token-status');
  if (el) { el.textContent = text; el.style.color = color || 'var(--text-dim)'; }
}

function verifyTokenBtn() {
  const val = document.getElementById('gh-token').value.trim();
  if (!val) { setTokenStatus('Enter a token first', 'var(--red)'); return; }
  saveToken(val);
  setTokenStatus('Verifying...', 'var(--text-dim)');
  validateToken(val);
}

async function validateToken(token) {
  try {
    const resp = await fetch(`${API}/user`, {
      headers: { Accept: 'application/vnd.github.v3+json', Authorization: `token ${token}` }
    });
    if (resp.ok) {
      const user = await resp.json();
      const limit = resp.headers.get('X-RateLimit-Limit') || '5000';
      const msg = `Connected as ${user.login} (${limit}/hr)`;
      setTokenStatus(msg, 'var(--green)');
      showToast(msg);
    } else if (resp.status === 401) {
      setTokenStatus('Invalid token', 'var(--red)');
      showToast('Invalid token - check and try again');
      document.getElementById('gh-token').value = '';
      saveToken('');
    } else {
      setTokenStatus('Token saved (could not verify)', 'var(--yellow)');
    }
  } catch { setTokenStatus('Token saved (offline)', 'var(--yellow)'); }
}

(function initToken() {
  const saved = getToken();
  if (saved) document.getElementById('gh-token').value = saved;
})();

// ==================== API ====================
async function ghFetch(path) {
  const headers = { Accept: 'application/vnd.github.v3+json' };
  const token = (document.getElementById('gh-token').value || getToken()).trim();
  if (token) headers.Authorization = `token ${token}`;
  const resp = await fetch(`${API}${path}`, { headers });

  const remaining = resp.headers.get('X-RateLimit-Remaining');
  const total = resp.headers.get('X-RateLimit-Limit');
  const reset = resp.headers.get('X-RateLimit-Reset');
  if (remaining !== null) {
    rateRemaining = parseInt(remaining);
    rateTotal = parseInt(total);
    rateReset = parseInt(reset);
    updateRateLimitUI();
  }

  if (resp.status === 403) throw new Error('Rate limited. Add a GitHub token for higher limits.');
  if (resp.status === 404) throw new Error('Repository not found. Check the owner/repo format.');
  if (!resp.ok) throw new Error(`GitHub API error: ${resp.status}`);
  return { data: await resp.json(), headers: resp.headers };
}

// ==================== SCREEN NAV ====================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(name + '-screen').classList.add('active');
  // Stop stage rendering when leaving battle
  if (name !== 'battle') stopStageRender();
  // Render roster when showing select
  if (name === 'select') renderRoster();
  // Render leaderboard when showing it
  if (name === 'leaderboard') renderLeaderboard();
}

// ==================== REPO SCANNING ====================
async function scanRepo(slot) {
  const input = document.getElementById(`repo-input-${slot}`);
  const status = document.getElementById(`scan-status-${slot}`);
  const card = document.getElementById(`card-${slot}`);
  const raw = input.value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '').replace(/\.git$/, '');

  if (!raw || !raw.includes('/')) {
    status.className = 'scan-status error';
    status.textContent = 'Enter as owner/repo';
    return;
  }

  const cached = getCachedFighter(raw);
  if (cached) {
    fighters[slot - 1] = cached;
    renderCard(slot, cached);
    status.className = 'scan-status';
    status.innerHTML = 'Loaded from cache<span class="cached-badge">24h</span>';
    document.getElementById('fight-btn').disabled = !(fighters[0] && fighters[1]);
    renderRoster();
    return;
  }

  status.className = 'scan-status';
  status.innerHTML = '<span class="spinner"></span>Scanning...';
  card.classList.remove('visible');

  try {
    const [repoRes, langRes, contentsRes] = await Promise.all([
      ghFetch(`/repos/${raw}`),
      ghFetch(`/repos/${raw}/languages`),
      ghFetch(`/repos/${raw}/contents/`).catch(() => ({ data: [] })),
    ]);

    const repo = repoRes.data;
    const languages = langRes.data;
    const rootContents = contentsRes.data;

    let hasCI = false;
    const ghDir = rootContents.find(f => f.name === '.github' && f.type === 'dir');
    if (ghDir) {
      try {
        const wf = await ghFetch(`/repos/${raw}/contents/.github/workflows`);
        hasCI = Array.isArray(wf.data) && wf.data.length > 0;
      } catch(e) {}
    }
    const ciFiles = ['.travis.yml', 'Jenkinsfile', '.circleci', 'azure-pipelines.yml', '.gitlab-ci.yml', 'bitbucket-pipelines.yml'];
    if (!hasCI) hasCI = rootContents.some(f => ciFiles.includes(f.name));

    let contributorCount = 1;
    try {
      const contribRes = await ghFetch(`/repos/${raw}/contributors?per_page=1&anon=true`);
      const linkHeader = contribRes.headers.get('link');
      if (linkHeader) {
        const match = linkHeader.match(/page=(\d+)>; rel="last"/);
        if (match) contributorCount = parseInt(match[1]);
      } else {
        contributorCount = Array.isArray(contribRes.data) ? contribRes.data.length : 1;
      }
    } catch(e) {}

    let releaseCount = 0;
    try {
      const relRes = await ghFetch(`/repos/${raw}/releases?per_page=1`);
      const linkHeader = relRes.headers.get('link');
      if (linkHeader) {
        const match = linkHeader.match(/page=(\d+)>; rel="last"/);
        if (match) releaseCount = parseInt(match[1]);
      } else {
        releaseCount = Array.isArray(relRes.data) ? relRes.data.length : 0;
      }
    } catch(e) {}

    const fileNames = rootContents.map(f => f.name.toLowerCase());
    const dirNames = rootContents.filter(f => f.type === 'dir').map(f => f.name.toLowerCase());

    const flags = {
      hasCI,
      hasTests: dirNames.some(d => ['test', 'tests', '__tests__', 'spec', 'specs'].includes(d)),
      hasGitignore: fileNames.includes('.gitignore'),
      hasDockerfile: fileNames.includes('dockerfile') || fileNames.some(f => f.startsWith('docker-compose')),
      hasSecurity: fileNames.includes('security.md'),
      hasContributing: fileNames.includes('contributing.md'),
      hasEditorConfig: fileNames.some(f => ['.editorconfig', '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.prettierrc', '.prettierrc.js', 'pyproject.toml', '.rubocop.yml', '.flake8', 'biome.json'].includes(f)),
      hasReadme: fileNames.some(f => f.startsWith('readme')),
      hasDocs: dirNames.some(d => ['docs', 'doc', 'documentation'].includes(d)),
      hasLicense: fileNames.some(f => f.startsWith('license') || f.startsWith('licence')),
      hasChangelog: fileNames.some(f => f.startsWith('changelog') || f.startsWith('changes') || f.startsWith('history')),
      hasMakefile: fileNames.some(f => ['makefile', 'justfile', 'taskfile.yml', 'rakefile'].includes(f)),
    };

    const fighter = buildFighter(repo, languages, flags, contributorCount, releaseCount);
    fighters[slot - 1] = fighter;
    setCachedFighter(raw, fighter);
    renderCard(slot, fighter);
    status.className = 'scan-status';
    status.textContent = 'Scan complete';
    document.getElementById('fight-btn').disabled = !(fighters[0] && fighters[1]);
    renderRoster();

  } catch(err) {
    status.className = 'scan-status error';
    status.textContent = err.message;
    fighters[slot - 1] = null;
    document.getElementById('fight-btn').disabled = true;
  }
}

// ==================== STAT ENGINE ====================
const CLASS_MAP = {
  JavaScript: 'Frontend Mage', TypeScript: 'Type Sorcerer', Python: 'Data Warlock',
  Go: 'Speed Demon', Rust: 'Iron Guardian', Java: 'Enterprise Knight',
  'C++': 'Bare Metal Berserker', C: 'Bare Metal Berserker', Ruby: 'Gem Enchanter',
  PHP: 'Legacy Warrior', Shell: 'System Shaman', Kotlin: 'Android Sentinel',
  Swift: 'App Alchemist', Dart: 'Flutter Phantom', Lua: 'Script Trickster',
  Haskell: 'Lambda Sage', Elixir: 'Phoenix Mage', Scala: 'JVM Sorcerer',
  'C#': 'Dotnet Paladin', Vue: 'Reactive Duelist', Svelte: 'Compiler Ninja',
  HCL: 'Infra Architect', Dockerfile: 'Container Commander', Nix: 'Nix Necromancer',
};

const NORMAL_ATTACKS = [
  'Code Push', 'Merge Conflict', 'Force Push', 'Rebase Strike', 'Cherry Pick',
  'Hotfix Jab', 'Branch Slash', 'Commit Crush', 'Pull Request Punch', 'Deploy Strike',
  'Dependency Slam', 'Lint Sweep', 'Refactor Uppercut', 'Squash Smash', 'Stash Pop',
];

function buildFighter(repo, languages, flags, contributors, releases) {
  const langList = Object.keys(languages);
  const primaryLang = repo.language || langList[0] || 'Unknown';
  const className = CLASS_MAP[primaryLang] || 'Code Warrior';
  const now = Date.now();
  const created = new Date(repo.created_at).getTime();
  const pushed = new Date(repo.pushed_at).getTime();
  const ageMonths = (now - created) / (1000 * 60 * 60 * 24 * 30);
  const daysSincePush = (now - pushed) / (1000 * 60 * 60 * 24);

  let hp = 500;
  hp += Math.min(Math.log2(Math.max(repo.stargazers_count, 1)) * 50, 500);
  hp += Math.min(ageMonths * 5, 200);
  hp += Math.min(contributors * 15, 200);
  hp += Math.min(repo.size / 100, 200);
  if (daysSincePush > 180) hp -= 200;
  hp -= Math.min(repo.open_issues_count * 2, 200);
  hp = Math.max(300, Math.round(hp));

  let atk = 20;
  atk += Math.min(langList.length * 8, 40);
  atk += Math.min(Math.log2(Math.max(repo.size, 1)) * 3, 25);
  atk += Math.min(releases * 4, 20);
  atk += Math.min(Math.log2(Math.max(repo.stargazers_count, 1)) * 3, 15);
  if (releases === 0) atk -= 5;

  let def = 15;
  if (flags.hasCI) def += 25; if (flags.hasTests) def += 20; if (flags.hasGitignore) def += 10;
  if (flags.hasDockerfile) def += 10; if (flags.hasSecurity) def += 15; if (flags.hasContributing) def += 10;
  if (flags.hasEditorConfig) def += 8; if (!flags.hasCI) def -= 10; if (!flags.hasGitignore) def -= 8;

  let spd = 25;
  if (daysSincePush < 7) spd += 30; else if (daysSincePush < 30) spd += 20; else if (daysSincePush < 90) spd += 10;
  if (daysSincePush > 180) spd -= 20; if (repo.size < 10000) spd += 12;
  spd += Math.min(contributors * 2, 15); if (repo.open_issues_count < 10) spd += 8;

  let int_ = 15;
  if (flags.hasReadme) int_ += 20; if (flags.hasDocs) int_ += 15; if (flags.hasLicense) int_ += 15;
  if (repo.description) int_ += 10; if (repo.topics && repo.topics.length > 0) int_ += 8;
  if (flags.hasContributing) int_ += 8; if (flags.hasChangelog) int_ += 10;
  if (!flags.hasReadme) int_ -= 15; if (!flags.hasLicense) int_ -= 8;

  let lck = 20;
  lck += Math.min(Math.log2(Math.max(repo.stargazers_count, 1)) * 5, 25);
  lck += Math.min(Math.log2(Math.max(repo.forks_count, 1)) * 5, 20);
  lck += Math.min(repo.watchers_count * 0.5, 10);
  if (!repo.fork) lck += 8; if (repo.has_discussions) lck += 5; if (repo.has_pages) lck += 5; if (repo.has_wiki) lck += 5;

  atk = clamp(Math.round(atk), 10, 100); def = clamp(Math.round(def), 10, 100);
  spd = clamp(Math.round(spd), 10, 100); int_ = clamp(Math.round(int_), 10, 100); lck = clamp(Math.round(lck), 10, 100);

  const specials = [];
  const weaknesses = [];
  if (repo.stargazers_count > 50) specials.push({ name: 'Star Storm', type: 'atk', mult: 1.8, desc: 'Community power!' });
  if (flags.hasCI) specials.push({ name: 'CI/CD Barrier', type: 'block', desc: 'Automated defenses!' });
  if (flags.hasLicense) specials.push({ name: 'License Shield', type: 'heal', pct: 0.12, desc: 'Open source protection!' });
  if (contributors > 5) specials.push({ name: 'Contributor Combo', type: 'multi', hits: 3, mult: 0.6, desc: 'Team attack!' });
  if (daysSincePush < 7) specials.push({ name: 'Fresh Commit', type: 'atk', mult: 2.0, desc: 'Bleeding edge!' });
  if (flags.hasDocs && flags.hasReadme) specials.push({ name: 'Docs Cannon', type: 'int_atk', desc: 'Knowledge is power!' });
  if (flags.hasDockerfile) specials.push({ name: 'Docker Deploy', type: 'atk_heal', mult: 1.5, pct: 0.05, desc: 'Containerized strike!' });
  if (flags.hasTests) specials.push({ name: 'Test Suite Barrage', type: 'crit', desc: 'Full coverage!' });
  if (repo.size > 50000) specials.push({ name: 'Mono Repo Slam', type: 'heavy', mult: 2.5, selfDmg: 0.08, desc: 'MASSIVE CODEBASE!' });
  if (flags.hasSecurity) specials.push({ name: 'Security Audit', type: 'debuff', desc: 'Vulnerabilities exposed!' });
  if (!flags.hasCI) weaknesses.push('No CI/CD'); if (!flags.hasTests) weaknesses.push('No Tests');
  if (!flags.hasLicense) weaknesses.push('No License'); if (!flags.hasReadme) weaknesses.push('No README');
  if (!flags.hasGitignore) weaknesses.push('No .gitignore');
  if (daysSincePush > 180) weaknesses.push('Stale (6mo+)'); if (daysSincePush > 365) weaknesses.push('Abandoned (1yr+)');
  if (repo.open_issues_count > 50) weaknesses.push('Issue Overload');

  return { name: repo.full_name, shortName: repo.name, description: repo.description || 'No description',
    avatar: repo.owner.avatar_url, url: repo.html_url, className, primaryLang, stars: repo.stargazers_count,
    forks: repo.forks_count, hp, maxHp: hp, stats: { atk, def, spd, int: int_, lck },
    specials, weaknesses, flags, cooldowns: {}, effects: [], raw: repo };
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ==================== RENDER FIGHTER CARD ====================
function renderCard(slot, f) {
  const card = document.getElementById(`card-${slot}`);
  const sc = v => v >= 75 ? 'var(--cyan)' : v >= 50 ? 'var(--green)' : v >= 30 ? 'var(--yellow)' : 'var(--red)';
  card.innerHTML = `
    <div class="card-header">
      <a class="card-avatar-link" href="${f.url}" target="_blank" rel="noopener"><img class="card-avatar" src="${f.avatar}" alt="${f.shortName}"></a>
      <div class="card-info">
        <div class="card-name"><a href="${f.url}" target="_blank" rel="noopener">${f.name}</a></div>
        <div class="card-class">${f.className} [${f.primaryLang}]</div>
        <div class="card-desc">${f.description}</div>
      </div>
    </div>
    <div class="card-hp"><div class="card-hp-label">HP</div><div class="card-hp-value">${f.hp}</div></div>
    <div class="stats-grid">
      ${['atk','def','spd','int','lck'].map(s => `
        <div class="stat-row"><span class="stat-label">${s.toUpperCase()}</span>
        <div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${f.stats[s]}%;background:${sc(f.stats[s])}"></div></div>
        <span class="stat-val" style="color:${sc(f.stats[s])}">${f.stats[s]}</span></div>`).join('')}
    </div>
    ${f.specials.length ? `<div class="specials-title">SPECIAL MOVES</div><div class="specials-list">${f.specials.map(s => `<span class="special-tag">${s.name}</span>`).join('')}</div>` : ''}
    ${f.weaknesses.length ? `<div class="specials-title">WEAKNESSES</div><div class="weaknesses-list">${f.weaknesses.map(w => `<span class="weakness-tag">${w}</span>`).join('')}</div>` : ''}`;
  card.classList.add('visible');
}

// ==================== BATTLE ENGINE ====================
class BattleEngine {
  constructor(f1, f2, seedExtra) {
    this.f1 = { ...f1, hp: f1.maxHp, cooldowns: {}, effects: [], defBuff: 0 };
    this.f2 = { ...f2, hp: f2.maxHp, cooldowns: {}, effects: [], defBuff: 0 };
    this.turn = 0; this.maxTurns = 60; this.log = []; this.over = false; this.winner = null;
    const seed = battleSeed(f1.name, f2.name, seedExtra);
    this.rng = mulberry32(seed);
    const spdDiff = this.f1.stats.spd - this.f2.stats.spd;
    this.current = (spdDiff + (this.rng() - 0.5) * 20 >= 0) ? 'f1' : 'f2';
  }

  getAttacker() { return this[this.current]; }
  getDefender() { return this[this.current === 'f1' ? 'f2' : 'f1']; }

  playTurn() {
    if (this.over) return null;
    this.turn++;
    const atk = this.getAttacker(), dfn = this.getDefender(), events = [];
    for (const k in atk.cooldowns) { atk.cooldowns[k]--; if (atk.cooldowns[k] <= 0) delete atk.cooldowns[k]; }
    if (dfn.defBuff > 0) dfn.defBuff--; else if (dfn.defBuff < 0) dfn.defBuff++;
    let useSpecial = null;
    if (this.rng() < 0.35) {
      const avail = atk.specials.filter(s => !atk.cooldowns[s.name]);
      if (avail.length) useSpecial = avail[Math.floor(this.rng() * avail.length)];
    }
    if (useSpecial) { events.push(...this.executeSpecial(atk, dfn, useSpecial)); atk.cooldowns[useSpecial.name] = 4 + Math.floor(this.rng() * 3); }
    else events.push(...this.executeNormal(atk, dfn));
    this.f1.hp = Math.max(0, this.f1.hp); this.f2.hp = Math.max(0, this.f2.hp);
    if (this.f1.hp <= 0 || this.f2.hp <= 0) {
      this.over = true;
      if (this.f1.hp <= 0 && this.f2.hp <= 0) { this.winner = null; events.push({ type: 'sys', text: "DOUBLE KO! It's a draw!" }); }
      else { this.winner = this.f1.hp > 0 ? this.f1 : this.f2; events.push({ type: 'sys', text: `${this.winner.shortName} WINS!` }); }
    }
    if (this.turn >= this.maxTurns && !this.over) {
      this.over = true; this.winner = this.f1.hp >= this.f2.hp ? this.f1 : this.f2;
      events.push({ type: 'sys', text: `Time's up! ${this.winner.shortName} wins by HP!` });
    }
    this.current = this.current === 'f1' ? 'f2' : 'f1';
    return events;
  }

  executeNormal(atk, dfn) {
    const events = [];
    const move = NORMAL_ATTACKS[Math.floor(this.rng() * NORMAL_ATTACKS.length)];
    const base = atk.stats.atk * (0.8 + this.rng() * 0.4);
    const defRed = (dfn.stats.def + dfn.defBuff * 10) * 0.28;
    let dmg = Math.max(1, Math.round(base - defRed));
    let crit = false;
    if (this.rng() < atk.stats.lck / 180) { dmg = Math.round(dmg * 2); crit = true; }
    events.push({ type: 'atk', text: `${atk.shortName} uses ${move}!`, who: atk === this.f1 ? 1 : 2 });
    dfn.hp -= dmg;
    events.push(crit ? { type: 'crit', text: `CRITICAL HIT! ${dmg} damage!`, dmg, target: dfn === this.f1 ? 1 : 2 }
      : { type: 'dmg', text: `${dfn.shortName} takes ${dmg} damage!`, dmg, target: dfn === this.f1 ? 1 : 2 });
    return events;
  }

  executeSpecial(atk, dfn, move) {
    const events = [];
    const t = dfn === this.f1 ? 1 : 2;
    const w = atk === this.f1 ? 1 : 2;
    events.push({ type: 'special', text: `${atk.shortName} uses ${move.name}!`, moveName: move.name, who: w });
    switch (move.type) {
      case 'atk': { const d = Math.max(1, Math.round(atk.stats.atk * move.mult * (0.9 + this.rng() * 0.2) - dfn.stats.def * 0.2)); dfn.hp -= d; events.push({ type: 'dmg', text: `${move.desc} ${d} damage!`, dmg: d, target: t }); break; }
      case 'block': { atk.defBuff = 2; events.push({ type: 'block', text: `${atk.shortName}'s defenses harden! DEF boosted for 2 turns.`, who: w }); break; }
      case 'heal': { const h = Math.round(atk.maxHp * move.pct); atk.hp = Math.min(atk.maxHp, atk.hp + h); events.push({ type: 'heal', text: `${atk.shortName} heals ${h} HP! ${move.desc}`, heal: h, who: w }); break; }
      case 'multi': { let td = 0; for (let i = 0; i < move.hits; i++) { const h = Math.max(1, Math.round(atk.stats.atk * move.mult * (0.7 + this.rng() * 0.3) - dfn.stats.def * 0.15)); td += h; dfn.hp -= h; } events.push({ type: 'dmg', text: `${move.hits}-hit combo! ${td} total damage!`, dmg: td, target: t }); break; }
      case 'int_atk': { const d = Math.max(1, Math.round(atk.stats.int * 1.2 * (0.9 + this.rng() * 0.2))); dfn.hp -= d; events.push({ type: 'dmg', text: `${move.desc} ${d} INT-based damage! (Ignores DEF)`, dmg: d, target: t }); break; }
      case 'atk_heal': { const d = Math.max(1, Math.round(atk.stats.atk * move.mult * (0.85 + this.rng() * 0.3) - dfn.stats.def * 0.2)); dfn.hp -= d; const h = Math.round(atk.maxHp * move.pct); atk.hp = Math.min(atk.maxHp, atk.hp + h); events.push({ type: 'dmg', text: `${d} damage! Heals ${h} HP!`, dmg: d, target: t }); break; }
      case 'crit': { const d = Math.round(atk.stats.atk * 1.8 * (0.9 + this.rng() * 0.2)); dfn.hp -= d; events.push({ type: 'crit', text: `Guaranteed CRITICAL! ${d} damage! ${move.desc}`, dmg: d, target: t }); break; }
      case 'heavy': { const d = Math.max(1, Math.round(atk.stats.atk * move.mult * (0.9 + this.rng() * 0.2) - dfn.stats.def * 0.15)); dfn.hp -= d; const sd = Math.round(atk.maxHp * move.selfDmg); atk.hp -= sd; events.push({ type: 'dmg', text: `${move.desc} ${d} damage! (${sd} recoil)`, dmg: d, target: t }); break; }
      case 'debuff': { dfn.defBuff = -3; const d = Math.round(atk.stats.int * 0.8); dfn.hp -= d; events.push({ type: 'dmg', text: `${move.desc} ${d} damage! DEF weakened!`, dmg: d, target: t }); break; }
    }
    return events;
  }
}

// ==================== BATTLE UI ====================
let currentStageName = '';

async function startBattle() {
  if (!fighters[0] || !fighters[1]) return;
  skipMode = false;
  showScreen('battle');

  const f1 = fighters[0], f2 = fighters[1];
  document.getElementById('battle-name-1').innerHTML = `<a href="${f1.url}" target="_blank" rel="noopener">${f1.shortName}</a>`;
  document.getElementById('battle-name-2').innerHTML = `<a href="${f2.url}" target="_blank" rel="noopener">${f2.shortName}</a>`;
  document.getElementById('battle-mini-1').src = f1.avatar;
  document.getElementById('battle-mini-2').src = f2.avatar;
  document.getElementById('battle-avatar-1').src = f1.avatar;
  document.getElementById('battle-avatar-2').src = f2.avatar;
  document.getElementById('battle-log').innerHTML = '';
  document.getElementById('skip-btn').disabled = false;

  // Start pixel art stage
  const canvas = document.getElementById('stage-canvas');
  if (canvas) {
    const stageArea = document.getElementById('battle-stage');
    canvas.width = stageArea.offsetWidth;
    canvas.height = stageArea.offsetHeight;
    initStage(canvas);
    const stage = startStageRender(getRandomStageKey());
    currentStageName = stage ? stage.name : '';
    const label = document.getElementById('stage-label');
    if (label) label.textContent = currentStageName;
  }

  battleEngine = new BattleEngine(f1, f2, rematchCount > 0 ? rematchCount : undefined);
  const fightHash = `fight=${encodeURIComponent(f1.name)},${encodeURIComponent(f2.name)}`;
  history.replaceState(null, '', '#' + fightHash);
  updateHPBars();
  addLog('sys', `${f1.shortName} [${f1.className}] vs ${f2.shortName} [${f2.className}]`);
  addLog('sys', `Stage: ${currentStageName}`);
  addLog('sys', `${battleEngine.current === 'f1' ? f1.shortName : f2.shortName} moves first! (Higher SPD)`);
  await sleep(1000);
  runBattle();
}

async function runBattle() {
  while (!battleEngine.over) {
    const events = battleEngine.playTurn();
    if (!events) break;
    for (const ev of events) { await processEvent(ev); if (!skipMode) await sleep(ev.type === 'special' ? 600 : 350); }
    updateHPBars();
    if (!skipMode) await sleep(500);
  }
  document.getElementById('skip-btn').disabled = true;
  await sleep(skipMode ? 200 : 1500);
  showVictory();
}

async function processEvent(ev) {
  addLog(ev.type, ev.text);
  if (ev.type === 'special' && !skipMode) {
    showMoveAnnounce(ev.moveName);
    const c = document.getElementById(`avatar-container-${ev.who}`);
    c.classList.add(ev.who === 1 ? 'attacking' : 'attacking-right');
    await sleep(400);
    c.classList.remove('attacking', 'attacking-right');
  }
  if ((ev.type === 'dmg' || ev.type === 'crit') && ev.target) {
    const c = document.getElementById(`avatar-container-${ev.target}`);
    c.classList.add('hit');
    showDamageFloat(ev.target, `-${ev.dmg}`, ev.type === 'crit');
    if (ev.type === 'crit' && !skipMode) {
      document.getElementById('battle-screen').classList.add('screen-shake');
      setTimeout(() => document.getElementById('battle-screen').classList.remove('screen-shake'), 300);
    }
    setTimeout(() => c.classList.remove('hit'), 400);
  }
  if (ev.type === 'heal' && ev.who) showDamageFloat(ev.who, `+${ev.heal}`, false, true);
  if (ev.type === 'atk' && !skipMode) {
    const c = document.getElementById(`avatar-container-${ev.who}`);
    c.classList.add(ev.who === 1 ? 'attacking' : 'attacking-right');
    await sleep(300);
    c.classList.remove('attacking', 'attacking-right');
  }
}

function updateHPBars() {
  const f1 = battleEngine.f1, f2 = battleEngine.f2;
  const p1 = Math.max(0, (f1.hp / f1.maxHp) * 100), p2 = Math.max(0, (f2.hp / f2.maxHp) * 100);
  const fill1 = document.getElementById('hp-fill-1'), fill2 = document.getElementById('hp-fill-2');
  fill1.style.width = p1 + '%'; fill2.style.width = p2 + '%';
  fill1.className = 'hp-bar-fill' + (p1 < 20 ? ' critical' : p1 < 50 ? ' hurt' : '');
  fill2.className = 'hp-bar-fill p2' + (p2 < 20 ? ' critical' : p2 < 50 ? ' hurt' : '');
  document.getElementById('hp-text-1').textContent = `${Math.max(0, f1.hp)} / ${f1.maxHp}`;
  document.getElementById('hp-text-2').textContent = `${Math.max(0, f2.hp)} / ${f2.maxHp}`;
}

function addLog(type, text) {
  const log = document.getElementById('battle-log');
  const cm = { atk: 'log-atk', dmg: 'log-dmg', heal: 'log-heal', special: 'log-special', crit: 'log-crit', sys: 'log-sys', block: 'log-block' };
  const div = document.createElement('div');
  div.className = `log-entry ${cm[type] || 'log-sys'}`;
  div.textContent = `> ${text}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function showDamageFloat(target, text, isCrit, isHeal) {
  const c = document.getElementById(`avatar-container-${target}`);
  const el = document.createElement('div');
  el.className = `dmg-float${isCrit ? ' crit' : ''}${isHeal ? ' heal' : ''}`;
  el.textContent = text;
  c.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

function showMoveAnnounce(name) {
  const el = document.createElement('div');
  el.className = 'move-announce';
  el.textContent = name;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

function skipBattle() { skipMode = true; }
function sleep(ms) { return skipMode ? Promise.resolve() : new Promise(r => setTimeout(r, ms)); }

// ==================== VICTORY ====================
function showVictory() {
  stopStageRender();
  showScreen('victory');

  const f1 = battleEngine.f1, f2 = battleEngine.f2;
  const winner = battleEngine.winner;
  const draw = !winner;

  // Record to leaderboard (local + global)
  if (!draw) {
    const loser = winner === f1 ? f2 : f1;
    recordFight(winner, loser, currentStageName);
    submitFightToServer(winner, loser, currentStageName);
  }

  document.getElementById('victory-avatar').src = draw ? '' : winner.avatar;
  document.getElementById('victory-avatar').style.display = draw ? 'none' : '';
  if (draw) {
    document.getElementById('victory-name').textContent = 'DRAW';
    document.getElementById('victory-name').style.color = 'var(--text-dim)';
  } else {
    document.getElementById('victory-name').innerHTML = `<a href="${winner.url}" target="_blank" rel="noopener">${winner.name}</a>`;
    document.getElementById('victory-name').style.color = 'var(--yellow)';
  }

  if (!draw) {
    const hpPct = Math.round((winner.hp / winner.maxHp) * 100);
    document.getElementById('victory-subtitle').textContent =
      `${winner.shortName} wins with ${winner.hp}/${winner.maxHp} HP remaining (${hpPct}%). Battle lasted ${battleEngine.turn} turns. Stage: ${currentStageName}`;
  } else {
    document.getElementById('victory-subtitle').textContent = 'Both repositories knocked each other out simultaneously!';
  }

  document.getElementById('victory-repos').innerHTML = `
    <a class="victory-repo-link" href="${f1.url}" target="_blank" rel="noopener"><img src="${f1.avatar}" alt="${f1.shortName}"><span>${f1.name}</span></a>
    <a class="victory-repo-link" href="${f2.url}" target="_blank" rel="noopener"><img src="${f2.avatar}" alt="${f2.shortName}"><span>${f2.name}</span></a>`;

  drawRadarChart(f1, f2);

  const table = document.getElementById('comparison-table');
  const stats = ['atk', 'def', 'spd', 'int', 'lck'];
  const sl = { atk: 'ATTACK', def: 'DEFENSE', spd: 'SPEED', int: 'INTELLIGENCE', lck: 'LUCK' };
  table.innerHTML = `<tr><th>${f1.shortName}</th><th>STAT</th><th>${f2.shortName}</th></tr>
    <tr><td class="${f1.maxHp >= f2.maxHp ? 'winner-cell' : ''}">${f1.maxHp}</td><td>HP</td><td class="${f2.maxHp >= f1.maxHp ? 'winner-cell' : ''}">${f2.maxHp}</td></tr>
    ${stats.map(s => `<tr><td class="${f1.stats[s] >= f2.stats[s] ? 'winner-cell' : ''}">${f1.stats[s]}</td><td>${sl[s]}</td><td class="${f2.stats[s] >= f1.stats[s] ? 'winner-cell' : ''}">${f2.stats[s]}</td></tr>`).join('')}
    <tr><td class="${f1.specials.length >= f2.specials.length ? 'winner-cell' : ''}">${f1.specials.length}</td><td>SPECIALS</td><td class="${f2.specials.length >= f1.specials.length ? 'winner-cell' : ''}">${f2.specials.length}</td></tr>
    <tr><td class="${f1.weaknesses.length <= f2.weaknesses.length ? 'winner-cell' : ''}">${f1.weaknesses.length}</td><td>WEAKNESSES</td><td class="${f2.weaknesses.length <= f1.weaknesses.length ? 'winner-cell' : ''}">${f2.weaknesses.length}</td></tr>`;
}

// ==================== RADAR CHART ====================
function drawRadarChart(f1, f2) {
  const svg = document.getElementById('radar-chart');
  const cx = 150, cy = 150, r = 110;
  const stats = ['atk', 'def', 'spd', 'int', 'lck'];
  const labels = ['ATK', 'DEF', 'SPD', 'INT', 'LCK'];
  const n = stats.length, step = (2 * Math.PI) / n, start = -Math.PI / 2;
  const pt = (i, v, rad) => { const a = start + i * step; const d = (v / 100) * rad; return { x: cx + d * Math.cos(a), y: cy + d * Math.sin(a) }; };
  let grid = '', axes = '', lbls = '';
  for (let ring = 25; ring <= 100; ring += 25) { const pts = []; for (let i = 0; i < n; i++) { const p = pt(i, ring, r); pts.push(`${p.x},${p.y}`); } grid += `<polygon points="${pts.join(' ')}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`; }
  for (let i = 0; i < n; i++) { const p = pt(i, 100, r); axes += `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`; }
  for (let i = 0; i < n; i++) { const p = pt(i, 115, r); lbls += `<text x="${p.x}" y="${p.y}" fill="#5a5a7a" font-family="'Press Start 2P', monospace" font-size="7" text-anchor="middle" dominant-baseline="central">${labels[i]}</text>`; }
  const poly = (f, c, a) => { const pts = stats.map((s, i) => { const p = pt(i, f.stats[s], r); return `${p.x},${p.y}`; }).join(' '); return `<polygon points="${pts}" fill="${c}" fill-opacity="${a}" stroke="${c}" stroke-width="2" stroke-opacity="0.8"/>`; };
  svg.innerHTML = `${grid}${axes}${poly(f1, '#00e5ff', 0.15)}${poly(f2, '#ff0066', 0.15)}${lbls}
    <text x="10" y="290" fill="#00e5ff" font-family="'Press Start 2P', monospace" font-size="6">${f1.shortName}</text>
    <text x="290" y="290" fill="#ff0066" font-family="'Press Start 2P', monospace" font-size="6" text-anchor="end">${f2.shortName}</text>`;
}

// ==================== RANDOM REPO PICKER ====================
const DICE_FACES = ['\u2680','\u2681','\u2682','\u2683','\u2684','\u2685'];
const RANDOM_LANGUAGES = ['javascript','typescript','python','go','rust','java','c','cpp','ruby','php','swift','kotlin','scala','elixir','haskell','lua','shell','dart','zig','nim','ocaml','clojure','julia','r','perl','erlang'];
const RANDOM_TOPICS = ['cli','api','web','framework','database','devtools','machine-learning','security','terminal','docker','kubernetes','blockchain','game','bot','compiler','editor','monitoring','proxy','auth','testing','http','graphql','rest','websocket','queue','cache','search','cms'];
const STAR_RANGES = ['10..200','200..1000','1000..5000','5000..20000','20000..100000'];
const POPULAR_REPOS = ['facebook/react','vuejs/core','angular/angular','sveltejs/svelte','denoland/deno','nodejs/node','python/cpython','rust-lang/rust','golang/go','microsoft/TypeScript','torvalds/linux','apple/swift','vercel/next.js','django/django','pallets/flask','astral-sh/ruff','expressjs/express','rails/rails','laravel/laravel','tiangolo/fastapi','docker/compose','kubernetes/kubernetes','hashicorp/terraform','grafana/grafana','prometheus/prometheus','elastic/elasticsearch','redis/redis','supabase/supabase','prisma/prisma','drizzle-team/drizzle-orm','tailwindlabs/tailwindcss','shadcn-ui/ui','chartjs/Chart.js','d3/d3','huggingface/transformers','neovim/neovim','tmux/tmux','junegunn/fzf','BurntSushi/ripgrep'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function fetchRandomRepo() {
  if (rateRemaining !== null && rateRemaining <= 2) return pick(POPULAR_REPOS);
  const strategy = Math.random();
  let q, sort;
  if (strategy < 0.4) { q = `stars:${pick(STAR_RANGES)} language:${pick(RANDOM_LANGUAGES)}`; sort = Math.random() < 0.5 ? 'stars' : 'updated'; }
  else if (strategy < 0.7) { q = `topic:${pick(RANDOM_TOPICS)} stars:>50`; sort = Math.random() < 0.5 ? 'stars' : 'updated'; }
  else { q = `stars:${pick(STAR_RANGES)}`; sort = 'updated'; }
  try {
    const res = await ghFetch(`/search/repositories?q=${encodeURIComponent(q)}&sort=${sort}&per_page=30&page=1`);
    if (res.data.items && res.data.items.length > 0) return res.data.items[Math.floor(Math.random() * res.data.items.length)].full_name;
  } catch(e) { if (rateRemaining !== null && rateRemaining <= 2) return pick(POPULAR_REPOS); throw e; }
  return pick(POPULAR_REPOS);
}

function animateDice(btn, duration) {
  btn.classList.add('rolling');
  const iv = setInterval(() => { btn.textContent = pick(DICE_FACES); }, 80);
  return new Promise(r => { setTimeout(() => { clearInterval(iv); btn.classList.remove('rolling'); btn.textContent = '\u2684'; r(); }, duration); });
}

async function rollRandom(slot) {
  const btn = document.querySelector(`#slot-${slot} .dice-btn`);
  const input = document.getElementById(`repo-input-${slot}`);
  const status = document.getElementById(`scan-status-${slot}`);
  btn.disabled = true;
  status.className = 'scan-status';
  status.innerHTML = '<span class="spinner"></span>Rolling...';
  try {
    const [repoName] = await Promise.all([fetchRandomRepo(), animateDice(btn, 1200)]);
    input.value = repoName;
    status.textContent = `Rolled: ${repoName}`;
    btn.disabled = false;
    await scanRepo(slot);
  } catch(err) { status.className = 'scan-status error'; status.textContent = err.message; btn.disabled = false; }
}

async function rollBothRandom() {
  const btn = document.querySelector('.roll-both-btn');
  btn.disabled = true;
  await Promise.all([rollRandom(1), rollRandom(2)]);
  btn.disabled = false;
}

// ==================== REMATCH & SHARE ====================
function rematch() { if (!fighters[0] || !fighters[1]) return; rematchCount++; startBattle(); }

function shareFight() {
  if (!fighters[0] || !fighters[1]) return;
  const url = `${location.origin}${location.pathname}#fight=${encodeURIComponent(fighters[0].name)},${encodeURIComponent(fighters[1].name)}`;
  navigator.clipboard.writeText(url).then(() => showToast('Fight URL copied!')).catch(() => prompt('Copy this fight URL:', url));
}

function showToast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ==================== URL HASH ROUTER ====================
async function handleHash() {
  const hash = location.hash.slice(1);
  if (!hash) return;
  const fm = hash.match(/^fight=([^,]+),(.+)$/);
  const sm = hash.match(/^select=([^,]+),(.+)$/);
  if (fm || sm) {
    const r1 = decodeURIComponent((fm || sm)[1]), r2 = decodeURIComponent((fm || sm)[2]);
    showScreen('select');
    document.getElementById('repo-input-1').value = r1;
    document.getElementById('repo-input-2').value = r2;
    await Promise.all([scanRepo(1), scanRepo(2)]);
    if (fm && fighters[0] && fighters[1]) { rematchCount = 0; startBattle(); }
  }
}

handleHash();

// ==================== KEYBOARD ====================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const active = document.querySelector('.screen.active');
    if (active.id === 'title-screen') showScreen('select');
    else if (active.id === 'select-screen' && fighters[0] && fighters[1]) startBattle();
  }
  if (e.key === 's' || e.key === 'S') { if (document.querySelector('#battle-screen.active')) skipBattle(); }
});
