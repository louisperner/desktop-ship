const $ = (id) => document.getElementById(id);

// ===================== STARFIELD / UNIVERSE =====================
// A small registry of background "universe" styles. Each style exposes
// reset(geometry) and draw(ctx, geometry, speed, frameCount). The active style
// is switchable at runtime via window.__setStarStyle(name); warp speed feeds in
// via window.__setWarp(speed) and drives the motion-based styles.
(function starfield() {
  const cv = $('stars');
  const ctx = cv.getContext('2d');
  // Shared geometry recomputed on resize and handed to every style.
  const G = { w: 0, h: 0, cx: 0, cy: 0, depth: 0 };

  // Shared, user-tunable options every style reads from. speedMul/density/size
  // scale the built-in defaults; the booleans toggle effects. rgb is derived
  // from the chosen hex color so styles can drop it straight into rgba().
  const TAU = Math.PI * 2;
  const O = {
    color: '#beeeff', rgb: '190,238,255', hue: 192,
    speedMul: 1, density: 1, size: 1,
    trails: false, colorful: false,
    bgColor: '#02040a', bgRgb: '2,4,10', bgAlpha: 0,  // space backdrop tint (0 = see desktop)
    shape: 'square',                                  // square | circle | cross
    twinkle: 60,                                      // 0..100 intensity (0 = static)
    vpY: 0.46,                                         // vanishing point Y (fraction of height)
    parallax: false, reactive: true,
    show: true,                                       // master on/off for the starfield
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }
  function hexToHue(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0;
    let hh;
    if (mx === r) hh = ((g - b) / d) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    return (hh * 60 + 360) % 360;
  }

  // Per-star fill: a random rainbow hue when "colorful" is on, otherwise the
  // chosen base color. `hue` is precomputed per star at spawn.
  const starFill = (s, alpha) =>
    O.colorful ? `hsla(${s.hue},85%,72%,${alpha})` : `rgba(${O.rgb},${alpha})`;

  // Twinkle alpha: amplitude scales with O.twinkle (0 = constant, no flicker).
  function twAlpha(s, base = 0.5) {
    const amp = O.twinkle / 100;
    return Math.max(0.05, Math.min(1, base + 0.45 * amp * Math.sin(s.tw)));
  }

  // Draw one star in the user-chosen shape, centered on (x, y).
  function drawDot(x, y, size, fill) {
    ctx.fillStyle = fill;
    if (O.shape === 'circle') { ctx.beginPath(); ctx.arc(x, y, size / 2, 0, TAU); ctx.fill(); }
    else if (O.shape === 'cross') {
      const hsz = size / 2, t = Math.max(0.5, size * 0.24);
      ctx.fillRect(x - hsz, y - t / 2, size, t);
      ctx.fillRect(x - t / 2, y - hsz, t, size);
    } else ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }

  // Clears the canvas each frame. Trails paint a translucent veil so prior
  // frames fade out; a backdrop tint paints over a fresh clear; otherwise the
  // canvas is fully cleared so the desktop shows through.
  function clearFrame() {
    if (O.trails) { ctx.fillStyle = `rgba(${O.bgRgb},${Math.max(0.14, O.bgAlpha)})`; ctx.fillRect(0, 0, G.w, G.h); }
    else if (O.bgAlpha > 0) { ctx.clearRect(0, 0, G.w, G.h); ctx.fillStyle = `rgba(${O.bgRgb},${O.bgAlpha})`; ctx.fillRect(0, 0, G.w, G.h); }
    else ctx.clearRect(0, 0, G.w, G.h);
  }

  // ---- helpers shared across styles (counts scale with O.density) ----
  function makeWarpStars(divisor) {
    const count = Math.round((G.w * G.h) / divisor * O.density);
    return Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * G.w * 2.4,
      y: (Math.random() - 0.5) * G.h * 2.4,
      z: Math.random() * G.depth,
      hue: rand(0, 360),
    }));
  }
  function makeFlatStars(divisor) {
    const count = Math.round((G.w * G.h) / divisor * O.density);
    return Array.from({ length: count }, () => ({
      x: Math.random() * G.w,
      y: Math.random() * G.h,
      r: rand(0.3, 1.6),
      tw: rand(0, TAU),               // twinkle phase
      sp: rand(0.01, 0.05),           // twinkle speed
      hue: rand(0, 360),
    }));
  }

  // ---- style registry ----
  const STYLES = {
    // Stars streaming outward — the original "forward motion" warp.
    warp: {
      reset() { this.stars = makeWarpStars(2600); },
      draw(ctx, G, speed) {
        clearFrame();
        for (const s of this.stars) {
          s.z -= speed;
          if (s.z <= 1) { s.x = (Math.random() - 0.5) * G.w * 2.4; s.y = (Math.random() - 0.5) * G.h * 2.4; s.z = G.depth; }
          const k = 140 / s.z;
          const px = G.cx + s.x * k, py = G.cy + s.y * k;
          if (px < 0 || px > G.w || py < 0 || py > G.h) continue;
          const t = 1 - s.z / G.depth;
          const size = (0.6 + t * 2.2) * O.size;
          drawDot(px, py, size, starFill(s, Math.min(1, 0.25 + t)));
        }
      },
    },

    // Light-speed streaks: stars stretch into lines that grow with warp speed.
    hyperspace: {
      reset() { this.stars = makeWarpStars(2600); },
      draw(ctx, G, speed) {
        clearFrame();
        ctx.lineCap = 'round';
        const stretch = 1 + speed * 8;
        for (const s of this.stars) {
          const pz = s.z;
          s.z -= speed * 2.2;
          if (s.z <= 1) { s.x = (Math.random() - 0.5) * G.w * 2.4; s.y = (Math.random() - 0.5) * G.h * 2.4; s.z = G.depth; continue; }
          const k = 140 / s.z, k2 = 140 / Math.min(G.depth, pz + stretch);
          const px = G.cx + s.x * k, py = G.cy + s.y * k;
          const qx = G.cx + s.x * k2, qy = G.cy + s.y * k2;
          if (px < -40 || px > G.w + 40 || py < -40 || py > G.h + 40) continue;
          const t = 1 - s.z / G.depth;
          ctx.strokeStyle = starFill(s, Math.min(1, 0.3 + t));
          ctx.lineWidth = (0.5 + t * 1.6) * O.size;
          ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(px, py); ctx.stroke();
        }
      },
    },

    // Calm twinkling field — static stars that drift very slowly.
    calm: {
      reset() { this.stars = makeFlatStars(1400); },
      draw(ctx, G, speed) {
        clearFrame();
        const drift = 0.05 + speed * 0.04;
        for (const s of this.stars) {
          s.tw += s.sp;
          s.y += drift; if (s.y > G.h) { s.y = 0; s.x = Math.random() * G.w; }
          drawDot(s.x, s.y, s.r * 2 * O.size, starFill(s, twAlpha(s, 0.55)));
        }
      },
    },

    // Soft nebula clouds (tinted by the chosen color) behind a twinkling field.
    nebula: {
      reset() {
        this.stars = makeFlatStars(2000);
        const base = O.hue;
        const hues = [base, (base + 40) % 360, (base + 320) % 360];
        this.clouds = Array.from({ length: 6 }, (_, i) => ({
          x: Math.random() * G.w, y: Math.random() * G.h,
          r: rand(G.w * 0.18, G.w * 0.4),
          hue: hues[i % hues.length], a: rand(0.05, 0.14),
        }));
      },
      draw(ctx, G, speed) {
        ctx.fillStyle = '#02040a'; ctx.fillRect(0, 0, G.w, G.h);
        ctx.globalCompositeOperation = 'lighter';
        for (const c of this.clouds) {
          c.x += speed * 0.15; if (c.x - c.r > G.w) c.x = -c.r;
          const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
          g.addColorStop(0, `hsla(${c.hue},70%,55%,${c.a})`);
          g.addColorStop(1, `hsla(${c.hue},70%,55%,0)`);
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU); ctx.fill();
        }
        for (const s of this.stars) {
          s.tw += s.sp;
          const a = twAlpha(s, 0.55);
          ctx.fillStyle = O.colorful ? `hsla(${s.hue},85%,75%,${a})` : `rgba(255,255,255,${a})`;
          ctx.fillRect(s.x, s.y, s.r * O.size, s.r * O.size);
        }
        ctx.globalCompositeOperation = 'source-over';
      },
    },

    // Rotating spiral galaxy — stars orbit a bright core, tinted by the color.
    galaxy: {
      reset() {
        const count = Math.round((G.w * G.h) / 1600 * O.density);
        const arms = 3, maxR = Math.max(G.w, G.h) * 0.7;
        this.stars = Array.from({ length: count }, () => {
          const arm = Math.floor(Math.random() * arms);
          const dist = Math.pow(Math.random(), 0.6) * maxR;
          const ang = (arm / arms) * TAU + dist * 0.012 + rand(-0.25, 0.25);
          return {
            dist, ang, r: rand(0.4, 1.6),
            hue: (O.hue + rand(-35, 35) + 360) % 360,
            spin: (1 - dist / maxR) * 0.0009 + 0.0002,
          };
        });
      },
      draw(ctx, G, speed) {
        ctx.fillStyle = '#03030a'; ctx.fillRect(0, 0, G.w, G.h);
        const core = ctx.createRadialGradient(G.cx, G.cy, 0, G.cx, G.cy, G.w * 0.12);
        core.addColorStop(0, 'rgba(255,240,210,0.55)');
        core.addColorStop(1, 'rgba(255,240,210,0)');
        ctx.fillStyle = core; ctx.fillRect(0, 0, G.w, G.h);
        const boost = 1 + speed * 1.5;
        for (const s of this.stars) {
          s.ang += s.spin * boost;
          const px = G.cx + Math.cos(s.ang) * s.dist;
          const py = G.cy + Math.sin(s.ang) * s.dist * 0.55; // tilt the disc
          if (px < 0 || px > G.w || py < 0 || py > G.h) continue;
          ctx.fillStyle = `hsla(${s.hue},80%,80%,0.85)`;
          ctx.fillRect(px, py, s.r * O.size, s.r * O.size);
        }
      },
    },

    // Underwater: air bubbles wobble and rise toward the surface.
    ocean: {
      spawn() {
        return {
          x: Math.random() * G.w, y: G.h + Math.random() * G.h,
          r: rand(2, 9), sp: rand(0.4, 1.6),
          wob: rand(0, TAU), ws: rand(0.01, 0.04), hue: rand(0, 360),
        };
      },
      reset() {
        const count = Math.round((G.w * G.h) / 5000 * O.density);
        this.bubbles = Array.from({ length: count }, () => this.spawn());
      },
      draw(ctx, G, speed) {
        const g = ctx.createLinearGradient(0, 0, 0, G.h);
        g.addColorStop(0, '#063449'); g.addColorStop(1, '#01101c');
        ctx.fillStyle = g; ctx.fillRect(0, 0, G.w, G.h);
        const rise = 0.5 + speed * 0.5;
        for (const b of this.bubbles) {
          b.y -= b.sp * rise; b.wob += b.ws; b.x += Math.sin(b.wob) * 0.5;
          if (b.y + b.r < -2) Object.assign(b, this.spawn());
          const rr = b.r * O.size;
          ctx.fillStyle = O.colorful ? `hsla(${b.hue},80%,80%,0.12)` : `rgba(${O.rgb},0.12)`;
          ctx.beginPath(); ctx.arc(b.x, b.y, rr, 0, TAU); ctx.fill();
          ctx.strokeStyle = O.colorful ? `hsla(${b.hue},80%,80%,0.55)` : `rgba(${O.rgb},0.5)`;
          ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.beginPath(); ctx.arc(b.x - rr * 0.32, b.y - rr * 0.32, Math.max(0.6, rr * 0.18), 0, TAU); ctx.fill();
        }
      },
    },

    // Meteor shower: a static star field with streaking meteors crossing it.
    meteor: {
      reset() { this.stars = makeFlatStars(2600); this.meteors = []; this.cool = 0; },
      spawnMeteor() {
        const ang = rand(Math.PI * 0.15, Math.PI * 0.4);
        return { x: rand(-G.w * 0.1, G.w), y: rand(-G.h * 0.2, G.h * 0.25), len: rand(60, 170), vx: Math.cos(ang) * rand(5, 9), vy: Math.sin(ang) * rand(5, 9), life: 1, hue: rand(180, 280) };
      },
      draw(ctx, G, speed) {
        clearFrame();
        for (const s of this.stars) { s.tw += s.sp; drawDot(s.x, s.y, s.r * 2 * O.size, starFill(s, twAlpha(s, 0.5))); }
        this.cool -= 1;
        if (this.cool <= 0) { this.meteors.push(this.spawnMeteor()); this.cool = rand(14, 60) / Math.max(0.4, speed * 0.4 + 0.5); }
        const boost = 0.6 + speed * 0.3;
        for (const m of this.meteors) {
          m.x += m.vx * boost; m.y += m.vy * boost; m.life -= 0.008;
          const inv = 1 / Math.hypot(m.vx, m.vy);
          const tx = m.x - m.vx * inv * m.len, ty = m.y - m.vy * inv * m.len;
          const col = O.colorful ? `hsla(${m.hue},90%,78%,` : `rgba(${O.rgb},`;
          const grad = ctx.createLinearGradient(m.x, m.y, tx, ty);
          grad.addColorStop(0, col + Math.max(0, m.life) + ')'); grad.addColorStop(1, col + '0)');
          ctx.strokeStyle = grad; ctx.lineWidth = 2 * O.size; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(tx, ty); ctx.stroke();
        }
        this.meteors = this.meteors.filter((m) => m.life > 0 && m.x < G.w + 220 && m.y < G.h + 220);
      },
    },

    // Aurora: undulating curtains of light over a faint star field.
    aurora: {
      reset() {
        this.stars = makeFlatStars(3200); this.t = 0;
        this.bands = Array.from({ length: 3 }, (_, i) => ({
          y: G.h * (0.28 + i * 0.16), amp: rand(30, 70), len: rand(0.004, 0.009),
          hueOff: i * 45, ph: rand(0, TAU),
        }));
      },
      draw(ctx, G, speed) {
        ctx.fillStyle = '#02040a'; ctx.fillRect(0, 0, G.w, G.h);
        this.t += 0.01 + speed * 0.005;
        for (const s of this.stars) { s.tw += s.sp; ctx.fillStyle = `rgba(255,255,255,${twAlpha(s, 0.4)})`; ctx.fillRect(s.x, s.y, s.r, s.r); }
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round'; ctx.lineWidth = 60;
        for (const b of this.bands) {
          const hue = (O.hue + b.hueOff) % 360;
          const grad = ctx.createLinearGradient(0, b.y - 90, 0, b.y + 120);
          grad.addColorStop(0, `hsla(${hue},85%,60%,0)`);
          grad.addColorStop(0.5, `hsla(${hue},85%,62%,0.22)`);
          grad.addColorStop(1, `hsla(${hue},85%,60%,0)`);
          ctx.strokeStyle = grad; ctx.beginPath();
          for (let x = 0; x <= G.w; x += 10) {
            const y = b.y + Math.sin(x * b.len + this.t + b.ph) * b.amp + Math.sin(x * b.len * 2.3 + this.t * 1.7) * b.amp * 0.4;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      },
    },

    // Synthwave: a neon perspective grid receding to the horizon.
    grid3d: {
      reset() { this.stars = makeFlatStars(4500); this.off = 0; },
      draw(ctx, G, speed) {
        ctx.fillStyle = '#0a0014'; ctx.fillRect(0, 0, G.w, G.h);
        const horizon = G.cy;
        for (const s of this.stars) { if (s.y < horizon) { s.tw += s.sp; ctx.fillStyle = `rgba(255,255,255,${twAlpha(s, 0.4)})`; ctx.fillRect(s.x, s.y, s.r, s.r); } }
        // sun glow on the horizon
        const sun = ctx.createRadialGradient(G.cx, horizon, 0, G.cx, horizon, G.w * 0.18);
        sun.addColorStop(0, `hsla(${O.hue},90%,65%,0.5)`); sun.addColorStop(1, `hsla(${O.hue},90%,65%,0)`);
        ctx.fillStyle = sun; ctx.fillRect(0, 0, G.w, G.h);
        this.off = (this.off + speed * 0.5 + 0.35) % 1;
        const line = (a) => O.colorful ? `hsla(${(this.off * 200) % 360},90%,62%,${a})` : `hsla(${O.hue},90%,62%,${a})`;
        ctx.lineWidth = 1;
        // converging verticals
        for (let i = -10; i <= 10; i++) {
          ctx.strokeStyle = line(0.5);
          ctx.beginPath(); ctx.moveTo(G.cx, horizon); ctx.lineTo(G.cx + i * (G.w / 9), G.h); ctx.stroke();
        }
        // scrolling horizontals (perspective spacing)
        for (let i = 0; i < 20; i++) {
          const p = (i + this.off) / 20;
          const y = horizon + p * p * (G.h - horizon);
          ctx.strokeStyle = line(Math.min(0.9, p * 1.4));
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(G.w, y); ctx.stroke();
        }
      },
    },

    // Pulsar / black hole: stars spiral inward into a pulsing bright core.
    pulsar: {
      reset() {
        const count = Math.round((G.w * G.h) / 3000 * O.density);
        const maxR = Math.max(G.w, G.h) * 0.7;
        this.maxR = maxR;
        this.stars = Array.from({ length: count }, () => ({ ang: rand(0, TAU), dist: rand(G.w * 0.07, maxR), hue: rand(0, 360) }));
        this.t = 0;
      },
      draw(ctx, G, speed) {
        ctx.fillStyle = '#01020a'; ctx.fillRect(0, 0, G.w, G.h);
        this.t += 0.02 + speed * 0.01;
        const pulse = 0.5 + 0.5 * Math.sin(this.t * 2.2);
        const glow = ctx.createRadialGradient(G.cx, G.cy, 0, G.cx, G.cy, G.w * 0.26);
        glow.addColorStop(0, `hsla(${O.hue},90%,78%,${0.45 + pulse * 0.3})`);
        glow.addColorStop(0.3, `hsla(${O.hue},90%,55%,0.22)`);
        glow.addColorStop(1, `hsla(${O.hue},90%,55%,0)`);
        ctx.fillStyle = glow; ctx.fillRect(0, 0, G.w, G.h);
        const coreR = G.w * 0.05 * (1 + pulse * 0.3);
        const pull = 0.6 + speed * 0.5;
        for (const s of this.stars) {
          s.dist -= pull; s.ang += (28 / Math.max(20, s.dist)) * (0.4 + speed * 0.2);
          if (s.dist < coreR) { s.dist = this.maxR; s.ang = rand(0, TAU); }
          const px = G.cx + Math.cos(s.ang) * s.dist;
          const py = G.cy + Math.sin(s.ang) * s.dist * 0.85;
          if (px < 0 || px > G.w || py < 0 || py > G.h) continue;
          const t = 1 - s.dist / this.maxR;
          const fill = O.colorful ? `hsla(${s.hue},85%,75%,${0.3 + t * 0.6})` : `rgba(${O.rgb},${0.3 + t * 0.6})`;
          ctx.fillStyle = fill; ctx.fillRect(px, py, (0.6 + t * 1.8) * O.size, (0.6 + t * 1.8) * O.size);
        }
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(G.cx, G.cy, coreR, 0, TAU); ctx.fill();
      },
    },
  };
  window.__starStyles = Object.keys(STYLES);

  let current = 'warp';
  // Vanishing-point parallax: eased offset toward the mouse position.
  let pTargetX = 0, pTargetY = 0, pX = 0, pY = 0;
  window.addEventListener('pointermove', (e) => {
    pTargetX = (e.clientX / Math.max(1, G.w) - 0.5);
    pTargetY = (e.clientY / Math.max(1, G.h) - 0.5);
  });

  let cx0 = 0, cy0 = 0;
  function resize() {
    G.w = cv.width = window.innerWidth;
    G.h = cv.height = window.innerHeight;
    cx0 = G.w / 2; cy0 = G.h * O.vpY;        // vanishing point (Y is tunable)
    G.cx = cx0; G.cy = cy0;
    G.depth = Math.max(G.w, G.h);
    STYLES[current].reset();
  }
  resize();
  window.addEventListener('resize', resize);

  let warp = 1.4;
  window.__setWarp = (s) => { warp = s; };
  window.__setStarStyle = (name) => {
    if (!STYLES[name] || name === current) return current;
    current = name;
    STYLES[current].reset();
    return current;
  };
  window.__getStarStyle = () => current;

  // Apply a patch of options. Color/density/vpY changes that are baked into a
  // style at reset() re-seed it; everything else takes effect on the next frame.
  window.__setStarOpts = (patch) => {
    const reseedDensity = patch.density != null && patch.density !== O.density;
    Object.assign(O, patch);
    if (patch.color) { O.rgb = hexToRgb(patch.color); O.hue = hexToHue(patch.color); }
    if (patch.bgColor) O.bgRgb = hexToRgb(patch.bgColor);
    if (patch.vpY != null) { cy0 = G.h * O.vpY; }
    if (reseedDensity) STYLES[current].reset();
    // Hue/color is baked into nebula/galaxy/aurora/grid3d/pulsar at reset().
    if (patch.color && ['nebula', 'galaxy', 'aurora', 'grid3d', 'pulsar'].includes(current)) STYLES[current].reset();
    return { ...O };
  };

  function frame() {
    // Ease the parallax offset; apply it to the vanishing point each frame.
    pX += (pTargetX - pX) * 0.06; pY += (pTargetY - pY) * 0.06;
    if (O.parallax) { G.cx = cx0 + pX * 40; G.cy = cy0 + pY * 30; }
    else { G.cx = cx0; G.cy = cy0; }
    const speed = (O.reactive ? warp : 1.4) * O.speedMul;
    if (O.show) STYLES[current].draw(ctx, G, speed);
    else ctx.clearRect(0, 0, G.w, G.h);
    requestAnimationFrame(frame);
  }
  frame();
})();

// ----- Clock + coords -----
function tick() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString('en-GB');
}
setInterval(tick, 1000);
tick();

// ----- Telemetry (simulated; swap for real metrics via IPC later) -----
function jitter(base, spread) {
  return Math.max(0, Math.min(100, base + (Math.random() - 0.5) * spread));
}
function setGauge(id, val) {
  const g = $(id);
  g.querySelector('.bar span').style.width = val + '%';
  g.querySelector('b').textContent = Math.round(val) + '%';
}
let cpu = 24, mem = 47, net = 12, thr = 68, speed = 88, hull = 100;
let coordX = 1284, coordY = -730, coordZ = 9921;

setInterval(() => {
  cpu = jitter(cpu, 14); mem = jitter(mem, 6); net = jitter(net, 20);
  setGauge('g-cpu', cpu); setGauge('g-mem', mem); setGauge('g-net', net);

  // Round dials track the three loads (-90deg..+90deg sweep).
  $('d1').style.transform = `rotate(${(cpu / 100) * 180 - 90}deg)`;
  $('d2').style.transform = `rotate(${(mem / 100) * 180 - 90}deg)`;
  $('d3').style.transform = `rotate(${(net / 100) * 180 - 90}deg)`;

  // Throttle drifts; warp speed + SPEED readout follow it.
  thr = jitter(thr, 8);
  $('thrFill').style.width = thr + '%';
  $('thrVal').textContent = Math.round(thr) + '%';
  if (window.__setWarp) window.__setWarp(0.4 + (thr / 100) * 5);

  speed = Math.round(thr + (Math.random() - 0.5) * 6);
  $('speedVal').textContent = speed;
  $('speedFill').style.width = thr + '%';

  // Drifting coordinates
  coordX += Math.round((Math.random() - 0.5) * 8);
  coordY += Math.round((Math.random() - 0.5) * 8);
  coordZ += Math.round((Math.random() - 0.3) * 6);
  $('coords').textContent = `X ${coordX} Y ${coordY} Z ${coordZ}`;
}, 1500);

// ----- Quit -----
$('quit').addEventListener('click', () => window.cockpit.quit());

// ----- Always-on-top (PIN) toggle -----
// Pin keeps the cockpit floating above everything; unpin lets other windows
// surface above it. Independent of click-through, so clicks can keep passing
// through while the cockpit stays pinned on top.
let pinned = false; // default: cockpit sits behind every other window
function applyPin(enabled) {
  pinned = enabled;
  $('pinState').textContent = enabled ? 'ON' : 'OFF';
  $('pin').classList.toggle('off', !enabled);
}
$('pin').addEventListener('click', () => window.cockpit.setAlwaysOnTop(!pinned));
window.cockpit.onAlwaysOnTopChanged(applyPin);

// ----- Terminal (real shell via node-pty + xterm.js) -----
(function terminal() {
  const panel = $('console');
  const screenEl = $('termScreen');
  const tabsEl = $('termTabs');

  // Each tab owns its own xterm instance, fit addon, host <div> and PTY
  // session in the main process (all keyed by the same id).
  const tabs = new Map();
  let activeId = null;
  let nextId = 1;

  window.cockpit.term.onData((id, d) => {
    const t = tabs.get(id);
    if (t) t.term.write(d);
  });
  window.cockpit.term.onExit((id) => {
    const t = tabs.get(id);
    if (t) t.term.write('\r\n\x1b[31m[ shell exited ]\x1b[0m\r\n');
  });

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const [id, t] of tabs) {
      const btn = document.createElement('button');
      btn.className = 'console-tab' + (id === activeId ? ' active' : '');
      btn.textContent = t.label;
      btn.addEventListener('click', () => activate(id));
      if (tabs.size > 1) {
        const x = document.createElement('span');
        x.className = 'console-tab-x';
        x.textContent = '×';
        x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(id); });
        btn.appendChild(x);
      }
      tabsEl.appendChild(btn);
    }
  }

  function activate(id) {
    activeId = id;
    for (const [tid, t] of tabs) t.host.hidden = tid !== id;
    renderTabs();
    requestAnimationFrame(() => { syncSize(); tabs.get(id)?.term.focus(); });
  }

  function addTab() {
    const id = String(nextId++);
    const host = document.createElement('div');
    host.className = 'console-tab-screen';
    screenEl.appendChild(host);
    const term = new Terminal({
      fontFamily: '"SF Mono", "JetBrains Mono", ui-monospace, monospace',
      fontSize: 12, cursorBlink: true, allowTransparency: true,
      theme: {
        background: 'rgba(0,0,0,0)', foreground: '#aee9ff', cursor: '#6effb0',
        selectionBackground: 'rgba(174,233,255,0.25)',
        black: '#04121a', brightBlack: '#3a4a55',
        green: '#6effb0', yellow: '#ffb24d', red: '#ff5470', cyan: '#aee9ff',
      },
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    tabs.set(id, { term, fit, host, label: `T${id}` });

    window.cockpit.term.start(id, { cols: term.cols, rows: term.rows });
    term.onData((d) => window.cockpit.term.input(id, d));
    activate(id);
  }

  function closeTab(id) {
    const t = tabs.get(id);
    if (!t || tabs.size <= 1) return; // keep at least one tab alive
    window.cockpit.term.kill(id);
    t.term.dispose();
    t.host.remove();
    tabs.delete(id);
    if (activeId === id) activate(tabs.keys().next().value);
    else renderTabs();
  }

  function syncSize() {
    const t = tabs.get(activeId);
    if (!t) return;
    t.fit.fit();
    window.cockpit.term.resize(activeId, { cols: t.term.cols, rows: t.term.rows });
  }

  const OPEN_KEY = 'cockpit.term.open.v1';
  function open() {
    panel.hidden = false;
    localStorage.setItem(OPEN_KEY, '1');
    if (!tabs.size) addTab();
    else requestAnimationFrame(() => { syncSize(); tabs.get(activeId)?.term.focus(); });
    $('termToggle').textContent = '▼ TERMINAL';
  }
  function close() {
    panel.hidden = true;
    localStorage.setItem(OPEN_KEY, '0');
    $('termToggle').textContent = '▶ TERMINAL';
  }
  $('termToggle').addEventListener('click', () => panel.hidden ? open() : close());
  $('termTabAdd').addEventListener('click', () => {
    const had = tabs.size;
    if (panel.hidden) open(); // creates the first tab when none exist yet
    if (tabs.size === had) addTab();
  });
  $('termClose').addEventListener('click', close);
  window.addEventListener('resize', () => { if (!panel.hidden) syncSize(); });

  // Register with the panel system (drag by title bar, resize from the grip)
  // and refit the terminal whenever the panel is resized. Registration also
  // restores the saved geometry, so it must happen before reopening below.
  window.CockpitPanels.make(panel, { minW: 280, minH: 160 });
  panel.addEventListener('panelresize', () => { if (!panel.hidden) syncSize(); });

  // Pick up where we left off: if the terminal was open when the app quit,
  // reopen it in place (spawning its shell); otherwise start closed — the
  // shell only spins up when the user opens the panel via the toggle.
  if (localStorage.getItem(OPEN_KEY) === '1') open();
  else { panel.hidden = true; $('termToggle').textContent = '▶ TERMINAL'; }
})();

// ----- Monitor / viewport selector -----
async function refreshDisplays() {
  const displays = await window.cockpit.listDisplays();
  const sel = $('display');
  sel.innerHTML = '';
  for (const d of displays) {
    const opt = document.createElement('option');
    opt.value = d.index;
    opt.textContent = `⧉ ${d.label} ${d.width}×${d.height}${d.primary ? ' ★' : ''}`;
    if (d.active) opt.selected = true;
    sel.appendChild(opt);
  }
}
$('display').addEventListener('change', (e) =>
  window.cockpit.setDisplay(parseInt(e.target.value, 10)));
window.cockpit.onDisplayChanged(() => refreshDisplays());
refreshDisplays();

// ----- Canopy lift (raise/lower the cockpit to expose more screen) -----
(function canopy() {
  const root = document.documentElement.style;
  const tab = $('canopyTab');
  const label = tab.querySelector('.canopy-label');
  // How far the whole cockpit (hull + panels) slides up when raised.
  const LIFT_VH = 42;
  let raised = false;
  // Current lift in px (negative when raised). The panel system reads this to
  // keep stored geometry in unlifted/base space, so panels stay glued to the
  // cockpit as it moves and never drift when raised/lowered repeatedly.
  window.__cockpitLiftPx = () => (raised ? -window.innerHeight * (LIFT_VH / 100) : 0);
  function toggle() {
    raised = !raised;
    document.body.classList.toggle('raised', raised);
    root.setProperty('--bg-lift', raised ? `-${LIFT_VH}vh` : '0px');
    label.textContent = raised ? 'LOWER COCKPIT' : 'RAISE COCKPIT';
  }
  tab.addEventListener('click', toggle);
})();

// ----- Settings (background image / fill color / grid) -----
(function settings() {
  const panel = $('settings');
  const SKEY = 'cockpit.settings.v1';
  const root = document.documentElement.style;
  const fill = $('bgFill');

  // Factory defaults for the universe block — also used by the Reset button.
  const STAR_DEFAULTS = {
    starShow: true,
    starPreset: 'custom',
    starStyle: 'warp', starShape: 'square',
    starColor: '#beeeff', starColorful: false,
    starSpeed: 100, starDensity: 100, starSize: 100,
    starTwinkle: 60, starVp: 46,
    starBgColor: '#02040a', starBgAlpha: 0,
    starTrails: false, starParallax: false, starReactive: true,
  };
  const S = Object.assign({
    bgZoom: 100, bgY: 0, cockpitShow: true,
    bgFill: false, bgColor: '#040a0e', bgAlpha: 100,
    snap: true, gridSize: 16, gridShow: false,
    appOpacity: 100,
  }, STAR_DEFAULTS, (() => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch { return {}; } })());

  const persist = () => localStorage.setItem(SKEY, JSON.stringify(S));
  const hexToRgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a / 100})`;
  };

  function applyBg() {
    root.setProperty('--bg-zoom', (S.bgZoom / 100).toFixed(3));
    root.setProperty('--bg-y', S.bgY + '%');
    fill.style.background = S.bgFill ? hexToRgba(S.bgColor, S.bgAlpha) : 'transparent';
    $('bgFillToggle').textContent = S.bgFill ? 'ON' : 'OFF';
    $('bgFillToggle').classList.toggle('off', !S.bgFill);
    document.querySelector('.cockpit-img').hidden = !S.cockpitShow;
    $('cockpitShowToggle').textContent = S.cockpitShow ? 'ON' : 'OFF';
    $('cockpitShowToggle').classList.toggle('off', !S.cockpitShow);
  }
  function applyStars() {
    if (window.__setStarStyle) window.__setStarStyle(S.starStyle);
    if (window.__setStarOpts) window.__setStarOpts({
      color: S.starColor,
      speedMul: S.starSpeed / 100,
      density: S.starDensity / 100,
      size: S.starSize / 100,
      twinkle: S.starTwinkle,
      vpY: S.starVp / 100,
      shape: S.starShape,
      bgColor: S.starBgColor,
      bgAlpha: S.starBgAlpha / 100,
      colorful: S.starColorful, trails: S.starTrails,
      parallax: S.starParallax, reactive: S.starReactive,
      show: S.starShow,
    });
    const sw = (id, on) => { $(id).textContent = on ? 'ON' : 'OFF'; $(id).classList.toggle('off', !on); };
    sw('starShowToggle', S.starShow);
    $('starOpts').style.display = S.starShow ? '' : 'none';
    sw('starColorfulToggle', S.starColorful);
    sw('starTrailsToggle', S.starTrails);
    sw('starParallaxToggle', S.starParallax);
    sw('starReactiveToggle', S.starReactive);
  }
  function applyGrid() {
    window.CockpitPanels.setSnap(S.snap);
    window.CockpitPanels.setGridSize(S.gridSize);
    window.CockpitPanels.setGridShow(S.gridShow);
    $('snapToggle').textContent = S.snap ? 'ON' : 'OFF';
    $('snapToggle').classList.toggle('off', !S.snap);
    $('gridShowToggle').textContent = S.gridShow ? 'ON' : 'OFF';
    $('gridShowToggle').classList.toggle('off', !S.gridShow);
  }
  function applyWindow() {
    if (window.cockpit && window.cockpit.setOpacity) window.cockpit.setOpacity(S.appOpacity / 100);
  }
  function reflectInputs() {
    $('bgZoom').value = S.bgZoom; $('bgZoomVal').textContent = S.bgZoom + '%';
    $('bgY').value = S.bgY; $('bgYVal').textContent = S.bgY;
    $('bgColor').value = S.bgColor;
    $('bgAlpha').value = S.bgAlpha; $('bgAlphaVal').textContent = S.bgAlpha + '%';
    $('gridSize').value = S.gridSize; $('gridVal').textContent = S.gridSize + 'px';
    $('starColor').value = S.starColor;
    $('starSpeed').value = S.starSpeed; $('starSpeedVal').textContent = S.starSpeed + '%';
    $('starDensity').value = S.starDensity; $('starDensityVal').textContent = S.starDensity + '%';
    $('starSize').value = S.starSize; $('starSizeVal').textContent = S.starSize + '%';
    $('starTwinkle').value = S.starTwinkle; $('starTwinkleVal').textContent = S.starTwinkle + '%';
    $('starVp').value = S.starVp; $('starVpVal').textContent = S.starVp + '%';
    $('starBgColor').value = S.starBgColor;
    $('starBgAlpha').value = S.starBgAlpha; $('starBgAlphaVal').textContent = S.starBgAlpha + '%';
    $('appOpacity').value = S.appOpacity; $('appOpacityVal').textContent = S.appOpacity + '%';
  }

  // --- wire controls ---
  $('bgZoom').addEventListener('input', (e) => {
    S.bgZoom = +e.target.value; $('bgZoomVal').textContent = S.bgZoom + '%'; applyBg(); persist();
  });
  $('bgY').addEventListener('input', (e) => {
    S.bgY = +e.target.value; $('bgYVal').textContent = S.bgY; applyBg(); persist();
  });
  $('bgFillToggle').addEventListener('click', () => { S.bgFill = !S.bgFill; applyBg(); persist(); });
  $('cockpitShowToggle').addEventListener('click', () => { S.cockpitShow = !S.cockpitShow; applyBg(); persist(); });
  $('bgColor').addEventListener('input', (e) => { S.bgColor = e.target.value; applyBg(); persist(); });
  $('bgAlpha').addEventListener('input', (e) => {
    S.bgAlpha = +e.target.value; $('bgAlphaVal').textContent = S.bgAlpha + '%'; applyBg(); persist();
  });
  $('snapToggle').addEventListener('click', () => { S.snap = !S.snap; applyGrid(); persist(); });
  $('gridSize').addEventListener('input', (e) => {
    S.gridSize = +e.target.value; $('gridVal').textContent = S.gridSize + 'px'; applyGrid(); persist();
  });
  $('gridShowToggle').addEventListener('click', () => { S.gridShow = !S.gridShow; applyGrid(); persist(); });
  $('appOpacity').addEventListener('input', (e) => {
    S.appOpacity = +e.target.value; $('appOpacityVal').textContent = S.appOpacity + '%'; applyWindow(); persist();
  });
  $('resetLayout').addEventListener('click', () => window.CockpitPanels.reset());

  // --- universe controls ---
  // Any manual tweak drops the preset selector back to "Custom".
  function markCustom() {
    if (S.starPreset !== 'custom') { S.starPreset = 'custom'; buildStarPresets(); }
  }
  $('starColor').addEventListener('input', (e) => { S.starColor = e.target.value; markCustom(); applyStars(); persist(); });
  $('starSpeed').addEventListener('input', (e) => {
    S.starSpeed = +e.target.value; $('starSpeedVal').textContent = S.starSpeed + '%'; markCustom(); applyStars(); persist();
  });
  $('starDensity').addEventListener('input', (e) => {
    S.starDensity = +e.target.value; $('starDensityVal').textContent = S.starDensity + '%'; markCustom(); applyStars(); persist();
  });
  $('starSize').addEventListener('input', (e) => {
    S.starSize = +e.target.value; $('starSizeVal').textContent = S.starSize + '%'; markCustom(); applyStars(); persist();
  });
  $('starTwinkle').addEventListener('input', (e) => {
    S.starTwinkle = +e.target.value; $('starTwinkleVal').textContent = S.starTwinkle + '%'; markCustom(); applyStars(); persist();
  });
  $('starVp').addEventListener('input', (e) => {
    S.starVp = +e.target.value; $('starVpVal').textContent = S.starVp + '%'; markCustom(); applyStars(); persist();
  });
  $('starBgColor').addEventListener('input', (e) => { S.starBgColor = e.target.value; markCustom(); applyStars(); persist(); });
  $('starBgAlpha').addEventListener('input', (e) => {
    S.starBgAlpha = +e.target.value; $('starBgAlphaVal').textContent = S.starBgAlpha + '%'; markCustom(); applyStars(); persist();
  });
  $('starShowToggle').addEventListener('click', () => { S.starShow = !S.starShow; applyStars(); persist(); });
  $('starColorfulToggle').addEventListener('click', () => { S.starColorful = !S.starColorful; markCustom(); applyStars(); persist(); });
  $('starTrailsToggle').addEventListener('click', () => { S.starTrails = !S.starTrails; markCustom(); applyStars(); persist(); });
  $('starParallaxToggle').addEventListener('click', () => { S.starParallax = !S.starParallax; markCustom(); applyStars(); persist(); });
  $('starReactiveToggle').addEventListener('click', () => { S.starReactive = !S.starReactive; markCustom(); applyStars(); persist(); });
  $('starReset').addEventListener('click', () => {
    Object.assign(S, STAR_DEFAULTS); reflectInputs(); applyStars(); persist();
    buildStarStyles(); buildStarShapes(); buildStarPresets();
  });

  // --- open/close (persisted; settings is the one panel that opens on a fresh
  // install, when no panel state has been saved yet) ---
  const OPEN_KEY = 'cockpit.settings.open.v1';
  // First launch is detected once, here, and shared via this flag so other
  // panels can default themselves closed on a brand-new install.
  const FIRST_RUN = localStorage.getItem('cockpit.launched.v1') == null;
  localStorage.setItem('cockpit.launched.v1', '1');
  window.__cockpitFirstRun = FIRST_RUN;

  let registered = false;
  function setPanelOpen(on) {
    if (on && !registered) { window.CockpitPanels.make(panel, { minW: 240, minH: 200 }); registered = true; }
    panel.hidden = !on;
    $('settingsToggle').classList.toggle('active', on);
    localStorage.setItem(OPEN_KEY, on ? '1' : '0');
  }
  $('settingsToggle').addEventListener('click', () => setPanelOpen(panel.hidden));
  $('settingsClose').addEventListener('click', () => setPanelOpen(false));

  // Settings tabs — show only the groups belonging to the active tab.
  (function settingsTabs() {
    const TKEY = 'cockpit.settings.tab';
    const tabs = [...document.querySelectorAll('.set-tab')];
    const groups = [...document.querySelectorAll('.set-group[data-tab]')];
    function select(name) {
      tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
      groups.forEach((g) => g.classList.toggle('hidden-tab', g.dataset.tab !== name));
      localStorage.setItem(TKEY, name);
    }
    tabs.forEach((t) => t.addEventListener('click', () => select(t.dataset.tab)));
    select(localStorage.getItem(TKEY) || 'bg');
  })();

  // Universe style selector — labels for each registered style. Built once
  // CockpitUI (makeDropdown) is available from holo.js.
  const STAR_LABELS = {
    warp: 'Warp drive', hyperspace: 'Hyperspace', calm: 'Calm field',
    nebula: 'Nebula', galaxy: 'Galaxy', ocean: 'Ocean (bubbles)',
    meteor: 'Meteor shower', aurora: 'Aurora', grid3d: 'Synthwave grid',
    pulsar: 'Pulsar',
  };
  function buildStarStyles() {
    if (!window.CockpitUI) return;
    const names = window.__starStyles || Object.keys(STAR_LABELS);
    const items = names.map((n) => ({ value: n, label: STAR_LABELS[n] || n }));
    window.CockpitUI.makeDropdown($('starStyleSelect'), items, S.starStyle, (v) => {
      S.starStyle = v; markCustom(); applyStars(); persist(); buildStarStyles();
    });
  }

  // Star-shape selector.
  function buildStarShapes() {
    if (!window.CockpitUI) return;
    const items = [
      { value: 'square', label: 'Square' },
      { value: 'circle', label: 'Round' },
      { value: 'cross', label: 'Cross' },
    ];
    window.CockpitUI.makeDropdown($('starShapeSelect'), items, S.starShape, (v) => {
      S.starShape = v; markCustom(); applyStars(); persist(); buildStarShapes();
    });
  }

  // Presets — one-tap combinations of options that go *beyond* a single style
  // switch (those would just duplicate the Style selector). Each tunes several
  // options at once. Picking the bare style is left to the Style dropdown.
  const STAR_PRESETS = {
    custom: null,
    deepspace: { starStyle: 'warp', starColor: '#beeeff', starColorful: false, starSpeed: 100, starDensity: 100, starSize: 100, starTwinkle: 40, starShape: 'square', starBgAlpha: 0, starTrails: false, starParallax: true },
    hyperjump: { starStyle: 'hyperspace', starColor: '#cfe6ff', starColorful: false, starSpeed: 240, starDensity: 130, starSize: 110, starTrails: true },
    rainbow:   { starStyle: 'warp', starColorful: true, starSpeed: 120, starDensity: 150, starSize: 120, starShape: 'circle', starTwinkle: 70, starTrails: true },
    synthwave: { starStyle: 'grid3d', starColor: '#ff3df0', starColorful: false, starSpeed: 90, starBgAlpha: 100, starVp: 55 },
  };
  const PRESET_LABELS = {
    custom: 'Custom', deepspace: 'Deep space', hyperjump: 'Hyper jump',
    rainbow: 'Rainbow rush', synthwave: 'Synthwave',
  };
  function applyPreset(name) {
    const p = STAR_PRESETS[name];
    if (!p) return;
    Object.assign(S, p);
    S.starPreset = name;
    reflectInputs(); applyStars(); persist();
    buildStarStyles(); buildStarShapes(); buildStarPresets();
  }
  function buildStarPresets() {
    if (!window.CockpitUI) return;
    const items = Object.keys(STAR_PRESETS).map((k) => ({ value: k, label: PRESET_LABELS[k] }));
    window.CockpitUI.makeDropdown($('starPresetSelect'), items, S.starPreset, (v) => {
      if (v === 'custom') { S.starPreset = 'custom'; persist(); buildStarPresets(); }
      else applyPreset(v);
    });
  }

  // Cycle to the next style — exposed for the hotbar shortcut.
  window.__cycleStarStyle = () => {
    const names = window.__starStyles || [];
    const i = names.indexOf(S.starStyle);
    S.starStyle = names[(i + 1) % names.length] || S.starStyle;
    markCustom(); applyStars(); persist(); buildStarStyles();
    return S.starStyle;
  };

  function buildUniverseUI() { buildStarStyles(); buildStarShapes(); buildStarPresets(); }
  window.addEventListener('DOMContentLoaded', buildUniverseUI);

  reflectInputs(); applyBg(); applyStars(); applyGrid(); applyWindow();

  // Restore the saved open state; on a fresh install, default to open.
  const savedOpen = localStorage.getItem(OPEN_KEY);
  setPanelOpen(savedOpen === '1' || (savedOpen === null && FIRST_RUN));

  // --- WINDOW group: app-level toggles mirrored from the tray ---
  // Pin on top.
  let pinOn = false;
  const pinBtn = $('pinToggle');
  function reflectPin(on) {
    pinOn = on;
    pinBtn.textContent = on ? 'ON' : 'OFF';
    pinBtn.classList.toggle('off', !on);
  }
  pinBtn.addEventListener('click', () => window.cockpit.setAlwaysOnTop(!pinOn));
  window.cockpit.onAlwaysOnTopChanged(reflectPin);

  // Click-through.
  let ctOn = false;
  const ctBtn = $('clickThroughToggle');
  function reflectCt(on) {
    ctOn = on;
    ctBtn.textContent = on ? 'ON' : 'OFF';
    ctBtn.classList.toggle('off', !on);
  }
  ctBtn.addEventListener('click', () => window.cockpit.setClickThrough(!ctOn));
  window.cockpit.onClickThroughChanged(reflectCt);

  // Display selector (custom dropdown — native popups don't open in this
  // unfocused widget window).
  const dispSel = $('displaySelect');
  async function buildDisplays() {
    const displays = await window.cockpit.listDisplays();
    const items = displays.map((d) => ({
      value: d.index,
      label: `${d.label} (${d.width}×${d.height})${d.primary ? ' ★' : ''}`,
    }));
    const active = (displays.find((d) => d.active) || displays[0] || {}).index ?? 0;
    if (!window.CockpitUI) return; // holo.js loads after this script
    window.CockpitUI.makeDropdown(dispSel, items, active, (v) => window.cockpit.setDisplay(+v));
  }
  // CockpitUI (makeDropdown) comes from holo.js, which loads after renderer.js —
  // build once everything has parsed.
  window.addEventListener('DOMContentLoaded', buildDisplays);
  window.cockpit.onDisplayChanged(buildDisplays);

  // Expose a small API so external drivers (the tray menu via the control
  // channel) can read and flip settings without touching the private state.
  window.CockpitSettings = {
    state: () => ({
      bgFill: S.bgFill, bgColor: S.bgColor, bgAlpha: S.bgAlpha,
      gridShow: S.gridShow, snap: S.snap, panelOpen: !panel.hidden,
      starStyle: S.starStyle,
    }),
    setStarStyle: (name) => {
      if (!(window.__starStyles || []).includes(name)) return S.starStyle;
      S.starStyle = name; applyStars(); persist(); buildStarStyles(); return S.starStyle;
    },
    toggleBgFill: () => { S.bgFill = !S.bgFill; applyBg(); persist(); return S.bgFill; },
    toggleGrid: () => { S.gridShow = !S.gridShow; applyGrid(); persist(); return S.gridShow; },
    toggleSnap: () => { S.snap = !S.snap; applyGrid(); persist(); return S.snap; },
    setBgColor: (hex) => { S.bgColor = hex; reflectInputs(); applyBg(); persist(); return S.bgColor; },
    setBgAlpha: (a) => { S.bgAlpha = Math.max(0, Math.min(100, +a)); reflectInputs(); applyBg(); persist(); return S.bgAlpha; },
    setPanelOpen: (on) => { setPanelOpen(!!on); return !panel.hidden; },
    resetLayout: () => { window.CockpitPanels.reset(); return true; },
  };
})();
