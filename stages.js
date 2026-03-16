// ==================== PIXEL ART ENGINE ====================
// Inspired by Legend of Obsidian's canvas renderer
// 15 FPS, 2x pixel scale, imageSmoothingEnabled = false

const PX = 2; // pixel scale

function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
}

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerp(a, b, t) {
  const [ar, ag, ab] = hexRgb(a);
  const [br, bg, bb] = hexRgb(b);
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
}

function rgba(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function osc(t, period, phase) {
  return (Math.sin((t / period) * Math.PI * 2 + (phase || 0)) + 1) / 2;
}

// Seeded PRNG (mulberry32)
function srand(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ==================== SKY RENDERER ====================
function drawSky(ctx, w, groundY, top, mid, bot) {
  const bandH = 3;
  for (let y = 0; y < groundY; y += bandH) {
    const t = y / groundY;
    const c = t < 0.5 ? lerp(top, mid, t * 2) : lerp(mid, bot, (t - 0.5) * 2);
    rect(ctx, 0, y, w, bandH, c);
  }
}

function drawStars(ctx, w, groundY, t, count, seed) {
  const r = srand(seed || 42);
  for (let i = 0; i < (count || 25); i++) {
    const sx = Math.floor(r() * w);
    const sy = Math.floor(r() * (groundY - 2));
    const a = 0.3 + osc(t, 1.5 + r() * 3, i * 0.7) * 0.7;
    px(ctx, sx, sy, rgba('#ffffff', a));
  }
}

function drawClouds(ctx, w, t, count, yMin, yMax, color, speed) {
  const r = srand(77);
  for (let i = 0; i < (count || 3); i++) {
    const bx = r() * w;
    const y = (yMin || 4) + Math.floor(r() * ((yMax || 20) - (yMin || 4)));
    const s = (speed || 3) + r() * 4;
    const cw = 5 + Math.floor(r() * 10);
    const x = ((bx + t * s) % (w + cw * 2)) - cw;
    rect(ctx, x, y, cw, 2, color || rgba('#ffffff', 0.2));
    rect(ctx, x + 1, y - 1, Math.max(1, cw - 2), 1, color || rgba('#ffffff', 0.15));
  }
}

// ==================== TERRAIN HELPERS ====================
function drawMountain(ctx, cx, groundY, h, halfW, bodyColor, capColor) {
  for (let row = 0; row < h; row++) {
    const t = row / h;
    const w = Math.floor(halfW * t);
    rect(ctx, cx - w, groundY - h + row, w * 2 + 1, 1, bodyColor);
  }
  if (capColor && h > 6) {
    rect(ctx, cx - 1, groundY - h, 3, 2, capColor);
    px(ctx, cx, groundY - h - 1, capColor);
  }
}

function drawTree(ctx, x, groundY, height, crownColor, t) {
  const trunkH = Math.max(2, Math.floor(height * 0.3));
  const crownH = height - trunkH;
  rect(ctx, x, groundY - trunkH, 1, trunkH, '#3a2820');
  const sway = Math.round(osc(t, 3 + (x % 5), x) * 1 - 0.5);
  for (let row = 0; row < crownH; row++) {
    const tw = Math.max(1, Math.floor((row / crownH) * (height * 0.4)));
    rect(ctx, x - tw + sway, groundY - trunkH - crownH + row, tw * 2 + 1, 1, crownColor);
  }
}

function drawPalmTree(ctx, x, groundY, height, t) {
  // Trunk (slightly curved)
  for (let i = 0; i < height; i++) {
    const bend = Math.floor(Math.sin(i / height * 1.2) * 2);
    px(ctx, x + bend, groundY - i, '#5a4030');
  }
  // Fronds
  const topY = groundY - height;
  const sway = Math.round(osc(t, 4, x) * 2 - 1);
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 6; i++) {
      const fx = x + side * (i + 1) + sway;
      const fy = topY + Math.floor(i * 0.5);
      px(ctx, fx, fy, '#1a5020');
      if (i < 4) px(ctx, fx, fy - 1, '#2a6830');
    }
  }
  px(ctx, x + sway, topY - 1, '#2a7030');
}

function drawBuilding(ctx, x, groundY, w, h, color, roofColor, winColor, t) {
  rect(ctx, x, groundY - h, w, h, color);
  // Roof
  if (roofColor) {
    for (let row = 0; row < 2; row++) {
      const rw = Math.floor(w / 2 + 1 - row);
      rect(ctx, x + Math.floor(w / 2) - rw, groundY - h - 2 + row, rw * 2 + 1, 1, roofColor);
    }
  }
  // Windows
  if (winColor) {
    for (let wy = groundY - h + 2; wy < groundY - 2; wy += 3) {
      for (let wx = x + 1; wx < x + w - 1; wx += 3) {
        const lit = osc(t, 2 + ((wx * 7 + wy * 3) % 5), wx + wy) > 0.3;
        if (lit) px(ctx, wx, wy, winColor);
      }
    }
  }
}

// ==================== STAGE DEFINITIONS ====================

const STAGES = {

  // ===== 1. TOKYO NIGHT =====
  tokyo: {
    name: 'TOKYO',
    render(ctx, w, h, t) {
      const gY = Math.floor(h * 0.75);

      // Sky
      drawSky(ctx, w, gY, '#08081e', '#101030', '#1a1840');
      drawStars(ctx, w, gY, t, 15, 100);

      // Distant buildings
      const r = srand(200);
      for (let i = 0; i < 12; i++) {
        const bx = Math.floor(r() * w);
        const bw = 6 + Math.floor(r() * 12);
        const bh = 15 + Math.floor(r() * 25);
        const shade = lerp('#101828', '#182038', r());
        rect(ctx, bx, gY - bh, bw, bh, shade);
        // Windows
        for (let wy = gY - bh + 2; wy < gY - 1; wy += 3) {
          for (let wx = bx + 1; wx < bx + bw - 1; wx += 2) {
            if (r() > 0.4) {
              const flicker = osc(t, 3 + r() * 5, wx + wy) > 0.2 ? 0.8 : 0.3;
              px(ctx, wx, wy, rgba('#ffe060', flicker));
            }
          }
        }
      }

      // Neon signs
      const neonColors = ['#ff2080', '#00a0ff', '#00ff60', '#ff6000', '#a040ff'];
      const nr = srand(300);
      for (let i = 0; i < 5; i++) {
        const nx = Math.floor(nr() * w);
        const ny = gY - 20 - Math.floor(nr() * 15);
        const nc = neonColors[i % neonColors.length];
        const glow = 0.5 + osc(t, 1.5 + nr() * 2, i * 2) * 0.5;
        rect(ctx, nx, ny, 4 + Math.floor(nr() * 4), 2, rgba(nc, glow));
        // Glow beneath
        rect(ctx, nx - 1, ny + 2, 6 + Math.floor(nr() * 4), 1, rgba(nc, glow * 0.2));
      }

      // Ground (asphalt)
      rect(ctx, 0, gY, w, h - gY, '#1a1820');
      // Lane markings
      for (let lx = 0; lx < w; lx += 12) {
        const offset = (t * 8) % 12;
        rect(ctx, lx - offset, gY + Math.floor((h - gY) / 2), 5, 1, rgba('#ffffff', 0.15));
      }

      // Paper lanterns
      const lr = srand(400);
      for (let i = 0; i < 6; i++) {
        const lx = Math.floor(lr() * w);
        const ly = gY - 8 - Math.floor(lr() * 6);
        const glow = 0.6 + osc(t, 2, i * 1.5) * 0.4;
        px(ctx, lx, ly, rgba('#ff4020', glow));
        px(ctx, lx, ly + 1, rgba('#ff6030', glow * 0.7));
      }

      // Cherry blossom petals
      const pr = srand(500);
      for (let i = 0; i < 12; i++) {
        const bx = pr() * w;
        const by = pr() * h;
        const drift = Math.sin(t * 0.6 + i * 2) * 4;
        const fall = (t * (1 + pr() * 2) * 8 + by) % (h + 10) - 5;
        const fx = Math.floor((bx + drift) % w);
        const fy = Math.floor(fall);
        if (fy >= 0 && fy < h) px(ctx, fx, fy, rgba('#ff8090', 0.6 + pr() * 0.3));
      }

      // Rain
      const rr = srand(Math.floor(t * 15) * 3);
      for (let i = 0; i < 20; i++) {
        const rx = Math.floor(rr() * w);
        const ry = Math.floor(rr() * h);
        px(ctx, rx, ry, rgba('#6080c0', 0.3));
        if (ry + 1 < h) px(ctx, rx, ry + 1, rgba('#6080c0', 0.15));
      }
    }
  },

  // ===== 2. SANTA CRUZ BEACH =====
  beach: {
    name: 'SANTA CRUZ',
    render(ctx, w, h, t) {
      const gY = Math.floor(h * 0.55); // horizon
      const sandY = Math.floor(h * 0.78);

      // Sunset sky
      drawSky(ctx, w, gY, '#1a1040', '#6a2030', '#e08030');

      // Sun
      const sunX = Math.floor(w * 0.7);
      const sunY = gY - 4;
      rect(ctx, sunX - 2, sunY - 2, 5, 5, '#ffe060');
      rect(ctx, sunX - 3, sunY - 1, 7, 3, rgba('#ffe060', 0.4));
      // Sun reflection glow
      for (let i = 0; i < 3; i++) {
        rect(ctx, sunX - 4 - i, sunY + 2 + i, 9 + i * 2, 1, rgba('#ff8030', 0.15 - i * 0.04));
      }

      // Clouds
      drawClouds(ctx, w, t, 4, 3, gY - 6, rgba('#ff9060', 0.25), 2);

      // Ocean
      rect(ctx, 0, gY, w, sandY - gY, '#1a3060');
      // Waves
      const wr = srand(150);
      for (let row = 0; row < sandY - gY; row += 2) {
        for (let i = 0; i < 8; i++) {
          const wx = (Math.floor(wr() * w) + Math.floor(t * (3 + row * 0.5))) % w;
          const ww = 3 + Math.floor(wr() * 5);
          const wc = row < 4 ? rgba('#ff8040', 0.15) : rgba('#3060a0', 0.3);
          rect(ctx, wx, gY + row, ww, 1, wc);
        }
      }
      // Foam line
      for (let i = 0; i < 15; i++) {
        const fx = (i * 18 + Math.floor(t * 4) + Math.floor(Math.sin(t * 0.8 + i) * 3)) % w;
        rect(ctx, fx, sandY - 1, 4, 1, rgba('#ffffff', 0.4));
      }

      // Sand
      rect(ctx, 0, sandY, w, h - sandY, '#c0a060');
      const sr = srand(250);
      for (let i = 0; i < 30; i++) {
        px(ctx, Math.floor(sr() * w), sandY + Math.floor(sr() * (h - sandY)), sr() > 0.5 ? '#d0b070' : '#a08040');
      }

      // Palm trees
      drawPalmTree(ctx, Math.floor(w * 0.1), sandY, 22, t);
      drawPalmTree(ctx, Math.floor(w * 0.85), sandY, 25, t);
      drawPalmTree(ctx, Math.floor(w * 0.15), sandY, 18, t);

      // Seagulls
      const gr = srand(350);
      for (let i = 0; i < 4; i++) {
        const bx = (gr() * w + t * (5 + i * 2)) % (w + 20) - 10;
        const by = 6 + Math.floor(gr() * 15);
        const wing = osc(t, 0.4, i * 3) > 0.5 ? -1 : 0;
        px(ctx, Math.floor(bx), by + wing, '#2a2020');
        px(ctx, Math.floor(bx) - 1, by, '#2a2020');
        px(ctx, Math.floor(bx) + 1, by, '#2a2020');
      }
    }
  },

  // ===== 3. NYC ROOFTOP =====
  nyc: {
    name: 'NEW YORK',
    render(ctx, w, h, t) {
      const gY = Math.floor(h * 0.65);

      // Day sky
      drawSky(ctx, w, gY, '#2048a0', '#4080c0', '#80b0d0');
      drawClouds(ctx, w, t, 3, 4, gY - 10, rgba('#ffffff', 0.3), 2);

      // Distant skyline
      const sr = srand(180);
      for (let i = 0; i < 18; i++) {
        const bx = Math.floor(i * (w / 18) + (sr() - 0.5) * 8);
        const bw = 4 + Math.floor(sr() * 8);
        const bh = 8 + Math.floor(sr() * 25);
        rect(ctx, bx, gY - bh, bw, bh, lerp('#4060a0', '#506888', sr()));
        // Antenna
        if (sr() > 0.7) px(ctx, bx + Math.floor(bw / 2), gY - bh - 2 - Math.floor(sr() * 3), '#4060a0');
      }

      // Water tower (iconic)
      const wtx = Math.floor(w * 0.7);
      // Legs
      rect(ctx, wtx - 3, gY - 14, 1, 6, '#5a4838');
      rect(ctx, wtx + 3, gY - 14, 1, 6, '#5a4838');
      // Tank
      rect(ctx, wtx - 4, gY - 20, 9, 6, '#6a5040');
      // Roof
      rect(ctx, wtx - 3, gY - 21, 7, 1, '#5a4030');
      rect(ctx, wtx - 2, gY - 22, 5, 1, '#5a4030');
      px(ctx, wtx, gY - 23, '#5a4030');

      // Ground (brick rooftop)
      rect(ctx, 0, gY, w, h - gY, '#8a4030');
      const br = srand(270);
      for (let gy = gY; gy < h; gy += 3) {
        const offset = (gy % 6 === 0) ? 0 : 4;
        for (let gx = offset; gx < w; gx += 8) {
          rect(ctx, gx, gy, 7, 2, br() > 0.5 ? '#7a3828' : '#9a4838');
          rect(ctx, gx, gy + 2, 8, 1, rgba('#4a2010', 0.3)); // mortar
        }
      }

      // Rooftop details
      rect(ctx, 2, gY - 2, w - 4, 2, '#6a3020'); // ledge
      // Vent
      rect(ctx, Math.floor(w * 0.3), gY - 6, 5, 6, '#606868');
      rect(ctx, Math.floor(w * 0.3) - 1, gY - 7, 7, 1, '#707878');

      // Pigeons
      const pr = srand(380);
      for (let i = 0; i < 5; i++) {
        const px2 = Math.floor(pr() * (w - 20)) + 10;
        const py = gY + 2 + Math.floor(pr() * 4);
        const bob = Math.floor(osc(t, 0.8, i * 2));
        ctx.fillStyle = '#505060';
        ctx.fillRect(px2, py - bob, 2, 1);
        ctx.fillRect(px2 + 2, py - bob - 1, 1, 1); // head
      }
    }
  },

  // ===== 4. AMAZON JUNGLE =====
  jungle: {
    name: 'AMAZON',
    render(ctx, w, h, t) {
      const gY = Math.floor(h * 0.8);

      // Misty sky
      drawSky(ctx, w, gY * 0.4, '#102010', '#1a3818', '#2a4a28');
      // Mist/fog below sky
      for (let y = Math.floor(gY * 0.4); y < gY; y++) {
        const a = 0.05 + osc(t, 6, y * 0.1) * 0.05;
        rect(ctx, 0, y, w, 1, rgba('#3a5a30', a));
      }

      // Background tree layer
      const tr1 = srand(120);
      for (let i = 0; i < 20; i++) {
        drawTree(ctx, Math.floor(tr1() * w), gY - 4, 12 + Math.floor(tr1() * 10), '#0a2810', t);
      }

      // Mid tree layer
      const tr2 = srand(220);
      for (let i = 0; i < 15; i++) {
        drawTree(ctx, Math.floor(tr2() * w), gY - 1, 14 + Math.floor(tr2() * 12), '#1a3a18', t);
      }

      // Waterfall (right side)
      const wfx = Math.floor(w * 0.82);
      rect(ctx, wfx, gY - 30, 3, 30, '#0a2010'); // cliff face
      for (let wy = gY - 28; wy < gY; wy++) {
        const wobble = Math.floor(osc(t, 0.3, wy * 0.5) * 2);
        px(ctx, wfx + 1 + wobble, wy, rgba('#80b0e0', 0.6));
        if (wy % 3 === 0) px(ctx, wfx + wobble, wy, rgba('#a0d0f0', 0.3));
      }
      // Splash
      for (let i = 0; i < 3; i++) {
        const sp = osc(t, 0.5, i * 2);
        px(ctx, wfx + Math.floor(sp * 4) - 1, gY, rgba('#a0d0f0', 0.4));
      }

      // Ground
      rect(ctx, 0, gY, w, h - gY, '#1a1408');
      const gr = srand(320);
      for (let i = 0; i < 25; i++) {
        px(ctx, Math.floor(gr() * w), gY + Math.floor(gr() * (h - gY)), gr() > 0.5 ? '#2a2010' : '#121008');
      }

      // Vines
      const vr = srand(420);
      for (let i = 0; i < 6; i++) {
        const vx = Math.floor(vr() * w);
        const vlen = 8 + Math.floor(vr() * 12);
        const sway = Math.round(osc(t, 4 + vr() * 3, i) * 1.5 - 0.75);
        for (let vy = 0; vy < vlen; vy++) {
          px(ctx, vx + sway + Math.floor(Math.sin(vy * 0.5) * 1), vy + 2, '#1a3010');
        }
      }

      // Flowers
      const fr = srand(520);
      const flowerColors = ['#ff4060', '#ff8040', '#ffc020', '#ff60c0', '#40c0ff'];
      for (let i = 0; i < 8; i++) {
        px(ctx, Math.floor(fr() * w), gY - 1 - Math.floor(fr() * 3), flowerColors[i % 5]);
      }

      // Fireflies
      for (let i = 0; i < 8; i++) {
        const fx = Math.floor((srand(600 + i)()) * w);
        const fy = Math.floor(h * 0.3 + (srand(601 + i)()) * (h * 0.5));
        const fx2 = fx + Math.floor(Math.sin(t * 0.8 + i * 3) * 6);
        const fy2 = fy + Math.floor(Math.cos(t * 0.6 + i * 2) * 4);
        const a = 0.3 + Math.sin(t * 2 + i * 5) * 0.4;
        if (fx2 >= 0 && fx2 < w && fy2 >= 0 && fy2 < h && a > 0) {
          px(ctx, fx2, fy2, rgba('#c0ff40', Math.max(0, a)));
        }
      }
    }
  },

  // ===== 5. ARCTIC TUNDRA =====
  arctic: {
    name: 'ARCTIC',
    render(ctx, w, h, t) {
      const gY = Math.floor(h * 0.7);

      // Dark polar sky
      drawSky(ctx, w, gY, '#040818', '#081028', '#101838');
      drawStars(ctx, w, gY, t, 30, 700);

      // Aurora borealis (animated bands)
      for (let band = 0; band < 4; band++) {
        const bandY = 8 + band * 6;
        const auroraColors = ['#00ff80', '#00c0a0', '#2080ff', '#8040ff'];
        for (let ax = 0; ax < w; ax++) {
          const wave = Math.sin(ax * 0.03 + t * 0.5 + band * 1.5) * 4;
          const a = (0.15 + osc(t, 3 + band, ax * 0.02 + band) * 0.2);
          const y = Math.floor(bandY + wave);
          if (y >= 0 && y < gY - 5) {
            px(ctx, ax, y, rgba(auroraColors[band], a));
            px(ctx, ax, y + 1, rgba(auroraColors[band], a * 0.5));
          }
        }
      }

      // Snow mountains
      drawMountain(ctx, Math.floor(w * 0.2), gY, 18, 20, '#3a4060', '#d0d8f0');
      drawMountain(ctx, Math.floor(w * 0.5), gY, 22, 25, '#2a3050', '#c8d0e8');
      drawMountain(ctx, Math.floor(w * 0.8), gY, 16, 18, '#4a5070', '#d8e0f8');

      // Ice formations
      const ir = srand(450);
      for (let i = 0; i < 4; i++) {
        const ix = Math.floor(ir() * w);
        const ih = 4 + Math.floor(ir() * 6);
        // Icicle shape
        for (let iy = 0; iy < ih; iy++) {
          const iw = Math.max(1, Math.floor((1 - iy / ih) * 3));
          rect(ctx, ix - Math.floor(iw / 2), gY - ih + iy, iw, 1, rgba('#80c0e0', 0.5 + ir() * 0.3));
        }
      }

      // Snow ground
      rect(ctx, 0, gY, w, h - gY, '#c0c8e0');
      const sr = srand(550);
      for (let i = 0; i < 20; i++) {
        px(ctx, Math.floor(sr() * w), gY + Math.floor(sr() * (h - gY)), sr() > 0.5 ? '#d0d8f0' : '#a0a8c0');
      }

      // Snowfall
      const snow = srand(650);
      for (let i = 0; i < 20; i++) {
        const bx = snow() * w;
        const by = snow() * h;
        const drift = Math.sin(t * 0.4 + i * 2) * 5;
        const fall = (t * (1.5 + snow() * 2.5) * 6 + by) % (h + 10) - 5;
        const x = Math.floor((bx + drift) % w);
        const y = Math.floor(fall);
        if (y >= 0 && y < h) px(ctx, x, y, rgba('#ffffff', 0.6 + snow() * 0.3));
      }
    }
  },

  // ===== 6. SERVER ROOM =====
  server: {
    name: 'SERVER ROOM',
    render(ctx, w, h, t) {
      const gY = Math.floor(h * 0.82);

      // Very dark background
      rect(ctx, 0, 0, w, h, '#06060e');

      // Server racks
      const rr = srand(160);
      const rackCount = Math.floor(w / 16);
      for (let i = 0; i < rackCount; i++) {
        const rx = i * 16 + 4;
        const rh = 30 + Math.floor(rr() * 20);
        const ry = gY - rh;

        // Rack body
        rect(ctx, rx, ry, 10, rh, '#181820');
        rect(ctx, rx + 1, ry + 1, 8, rh - 2, '#101018');
        // Rack rails
        rect(ctx, rx, ry, 1, rh, '#282838');
        rect(ctx, rx + 9, ry, 1, rh, '#282838');

        // Server units (horizontal stripes)
        for (let sy = ry + 2; sy < gY - 2; sy += 3) {
          rect(ctx, rx + 2, sy, 6, 2, '#141420');
          // LED lights
          const ledColor = rr() > 0.7 ? '#ff3030' : rr() > 0.4 ? '#00ff40' : '#00a0ff';
          const blink = osc(t, 0.5 + rr() * 3, rx + sy) > 0.3;
          if (blink) px(ctx, rx + 7, sy, ledColor);
          if (rr() > 0.5 && blink) px(ctx, rx + 7, sy + 1, rgba(ledColor, 0.4));
        }
      }

      // Floor (raised tiles with grid)
      rect(ctx, 0, gY, w, h - gY, '#0a0a18');
      for (let fy = gY; fy < h; fy += 4) {
        rect(ctx, 0, fy, w, 1, rgba('#1a1a30', 0.5));
      }
      for (let fx = 0; fx < w; fx += 6) {
        rect(ctx, fx, gY, 1, h - gY, rgba('#1a1a30', 0.3));
      }

      // Matrix code rain
      const cr = srand(750);
      for (let col = 0; col < Math.floor(w / 3); col++) {
        const cx = col * 3 + 1;
        const speed = 4 + cr() * 8;
        const len = 5 + Math.floor(cr() * 10);
        const headY = ((t * speed + cr() * 50) % (gY + len)) - len;

        for (let ci = 0; ci < len; ci++) {
          const cy = Math.floor(headY + ci);
          if (cy >= 0 && cy < gY) {
            const fade = 1 - ci / len;
            const a = fade * 0.3 * (ci === 0 ? 2 : 1);
            px(ctx, cx, cy, rgba(ci === 0 ? '#80ff80' : '#00c040', Math.min(1, a)));
          }
        }
      }

      // Cooling vents glow
      for (let i = 0; i < 3; i++) {
        const vx = Math.floor(w * (0.2 + i * 0.3));
        const glow = 0.1 + osc(t, 2, i * 2) * 0.15;
        rect(ctx, vx - 2, gY - 2, 5, 2, rgba('#00a0c0', glow));
      }
    }
  }
};

// ==================== STAGE RENDERER ====================
const STAGE_KEYS = Object.keys(STAGES);
let currentStageKey = null;
let stageCanvas = null;
let stageCtx = null;
let stageAnimFrame = null;
let stageStartTime = 0;

function initStage(canvasEl) {
  stageCanvas = canvasEl;
  stageCtx = canvasEl.getContext('2d');
  stageCtx.imageSmoothingEnabled = false;
}

function startStageRender(stageKey) {
  stopStageRender();
  currentStageKey = stageKey || STAGE_KEYS[Math.floor(Math.random() * STAGE_KEYS.length)];
  stageStartTime = performance.now();

  const stage = STAGES[currentStageKey];
  if (!stage) return;

  function frame() {
    if (!stageCanvas) return;
    const physW = stageCanvas.width;
    const physH = stageCanvas.height;
    const logW = Math.floor(physW / PX);
    const logH = Math.floor(physH / PX);

    stageCtx.setTransform(PX, 0, 0, PX, 0, 0);
    stageCtx.clearRect(0, 0, logW, logH);

    const elapsed = (performance.now() - stageStartTime) / 1000;
    stage.render(stageCtx, logW, logH, elapsed);

    stageAnimFrame = setTimeout(() => requestAnimationFrame(frame), 1000 / 15); // 15 FPS
  }

  requestAnimationFrame(frame);
  return stage;
}

function stopStageRender() {
  if (stageAnimFrame) {
    clearTimeout(stageAnimFrame);
    stageAnimFrame = null;
  }
}

function getRandomStageKey() {
  return STAGE_KEYS[Math.floor(Math.random() * STAGE_KEYS.length)];
}
