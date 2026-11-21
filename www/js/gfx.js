'use strict';
/* K-EDIT STUDIO - shared drawing: text, stickers, masks, animations, transitions, pixel effects, gizmo */

const FONTS = {
  sans: { name: 'Sans', css: 'Roboto, "Segoe UI", "Helvetica Neue", Arial, sans-serif' },
  serif: { name: 'Serif', css: '"Noto Serif", Georgia, "Times New Roman", serif' },
  mono: { name: 'Mono', css: '"Roboto Mono", "Courier New", monospace' },
  display: { name: 'Impact', css: 'Impact, "Arial Black", "Roboto Condensed", sans-serif' },
  hand: { name: 'Hand', css: '"Comic Sans MS", "Segoe Script", "Chalkboard SE", cursive' },
  round: { name: 'Round', css: '"Varela Round", Nunito, ui-rounded, "Arial Rounded MT Bold", sans-serif' },
};

const TextR = {
  mctx: null,
  ctx() { return this.mctx || (this.mctx = U.canvas(4, 4).getContext('2d')); },
  fontStr(t, fs) {
    const fam = (FONTS[t.font] && FONTS[t.font].css) || t.font || FONTS.sans.css;
    return `${t.italic ? 'italic ' : ''}${t.bold ? '700' : '400'} ${fs}px ${fam}`;
  },
  layout(it, W, H) {
    const t = it.text, fs = Math.max(6, t.size * H), c = this.ctx();
    c.font = this.fontStr(t, fs);
    if ('letterSpacing' in c) c.letterSpacing = (t.ls * fs) + 'px';
    let str = t.upper ? String(t.str).toUpperCase() : String(t.str);
    const maxW = W * .86;
    const lines = [];
    str.split('\n').forEach(par => {
      const words = par.split(' '); let cur = '';
      words.forEach(w => {
        const test = cur ? cur + ' ' + w : w;
        if (c.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
      });
      lines.push(cur);
    });
    const ws = lines.map(l => c.measureText(l).width);
    const padX = (t.bg.op > 0 ? t.bg.pad * fs * 1.3 : fs * .15) + t.stroke.w * fs, padY = (t.bg.op > 0 ? t.bg.pad * fs * .8 : fs * .1);
    const lh = t.lh * fs;
    return { lines, ws, fs, lh, padX, padY, w: Math.max(...ws, 1) + padX * 2, h: lines.length * lh + padY * 2, str };
  },
  /* draws centred at (0,0) in current transform */
  draw(ctx, it, lt, W, H, L) {
    const t = it.text; L = L || this.layout(it, W, H);
    ctx.save();
    ctx.font = this.fontStr(t, L.fs);
    if ('letterSpacing' in ctx) ctx.letterSpacing = (t.ls * L.fs) + 'px';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    if (t.bg.op > 0) {
      ctx.save(); ctx.globalAlpha *= t.bg.op; ctx.fillStyle = t.bg.c;
      const r = Math.min(L.h / 2, t.bg.rad * L.fs * 1.2);
      ctx.beginPath(); ctx.roundRect(-L.w / 2, -L.h / 2, L.w, L.h, r); ctx.fill(); ctx.restore();
    }
    // typewriter animation
    let reveal = Infinity;
    const ain = it.anim && it.anim.in;
    if (ain && ain.id === 'type') { const total = L.lines.join('').length; reveal = Math.ceil(total * U.clamp(lt / (ain.dur || 1), 0, 1)); }
    let used = 0;
    const words = it.words;
    L.lines.forEach((ln, i) => {
      const y = -L.h / 2 + L.padY + L.lh * (i + .5);
      const lw = L.ws[i];
      const x0 = t.align === 'left' ? -L.w / 2 + L.padX : t.align === 'right' ? L.w / 2 - L.padX - lw : -lw / 2;
      let txt = ln;
      if (used + ln.length > reveal) txt = ln.slice(0, Math.max(0, reveal - used));
      used += ln.length;
      if (!txt) return;
      if (t.shadow.b > 0 || t.shadow.x || t.shadow.y) { ctx.shadowColor = t.shadow.c; ctx.shadowBlur = t.shadow.b * L.fs; ctx.shadowOffsetX = t.shadow.x * L.fs; ctx.shadowOffsetY = t.shadow.y * L.fs; }
      if (words && t.hl && words.length) {
        // karaoke: draw word by word
        let x = x0; const tokens = txt.split(/(\s+)/);
        let wi = 0; for (let k = 0; k < i; k++) wi += L.lines[k].split(/\s+/).filter(Boolean).length;
        tokens.forEach(tk => {
          const wd = ctx.measureText(tk).width;
          if (tk.trim()) {
            const w = words[wi++]; const on = w && lt >= w.s;
            ctx.fillStyle = on ? t.hl : t.color;
            if (t.stroke.w > 0) { ctx.lineWidth = t.stroke.w * L.fs * 2; ctx.lineJoin = 'round'; ctx.strokeStyle = t.stroke.c; ctx.strokeText(tk, x, y); }
            ctx.fillText(tk, x, y);
          }
          x += wd;
        });
      } else {
        if (t.stroke.w > 0) { ctx.lineWidth = t.stroke.w * L.fs * 2; ctx.lineJoin = 'round'; ctx.strokeStyle = t.stroke.c; ctx.strokeText(txt, x0, y); }
        ctx.fillStyle = t.color; ctx.fillText(txt, x0, y);
      }
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      if (t.underline) { ctx.fillStyle = t.color; ctx.fillRect(x0, y + L.fs * .45, ctx.measureText(txt).width, Math.max(1, L.fs * .06)); }
    });
    ctx.restore();
    return L;
  },
};

/* ---------- stickers & masks ---------- */
const Shapes = {
  _c: {},
  poly(pts) { const p = new Path2D(); pts.forEach((q, i) => i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])); p.closePath(); return p; },
  starPts(n, ro, ri) { const a = []; for (let i = 0; i < n * 2; i++) { const r = i % 2 ? ri : ro, th = -Math.PI / 2 + i * Math.PI / n; a.push([Math.cos(th) * r, Math.sin(th) * r]); } return a; },
  get(id) {
    if (this._c[id]) return this._c[id];
    let p;
    switch (id) {
      case 'circle': p = new Path2D(); p.arc(0, 0, .5, 0, Math.PI * 2); break;
      case 'rect': p = new Path2D(); p.roundRect(-.5, -.5, 1, 1, .08); break;
      case 'rounded': p = new Path2D(); p.roundRect(-.5, -.5, 1, 1, .22); break;
      case 'heart': p = new Path2D(); p.moveTo(0, .4); p.bezierCurveTo(-.55, -.02, -.5, -.46, -.25, -.46); p.bezierCurveTo(-.1, -.46, 0, -.36, 0, -.25); p.bezierCurveTo(0, -.36, .1, -.46, .25, -.46); p.bezierCurveTo(.5, -.46, .55, -.02, 0, .4); p.closePath(); break;
      case 'star': p = this.poly(this.starPts(5, .5, .22)); break;
      case 'burst': p = this.poly(this.starPts(12, .5, .36)); break;
      case 'triangle': p = this.poly([[0, -.5], [.5, .4], [-.5, .4]]); break;
      case 'diamond': p = this.poly([[0, -.5], [.4, 0], [0, .5], [-.4, 0]]); break;
      case 'hexagon': p = this.poly(Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3) * .5, Math.sin(i * Math.PI / 3) * .5])); break;
      case 'arrow': p = this.poly([[-.5, -.14], [.1, -.14], [.1, -.32], [.5, 0], [.1, .32], [.1, .14], [-.5, .14]]); break;
      case 'plus': p = this.poly([[-.15, -.5], [.15, -.5], [.15, -.15], [.5, -.15], [.5, .15], [.15, .15], [.15, .5], [-.15, .5], [-.15, .15], [-.5, .15], [-.5, -.15], [-.15, -.15]]); break;
      case 'bubble': p = new Path2D(); p.roundRect(-.5, -.42, 1, .68, .16); p.moveTo(-.2, .24); p.lineTo(-.32, .48); p.lineTo(.02, .24); p.closePath(); break;
      case 'bars': p = new Path2D(); p.rect(-.5, -.3, 1, .6); break;
      default: p = new Path2D(); p.rect(-.5, -.5, 1, 1);
    }
    return this._c[id] = p;
  },
  list: ['heart', 'star', 'burst', 'circle', 'rounded', 'triangle', 'diamond', 'hexagon', 'arrow', 'plus', 'bubble'],
  maskList: ['circle', 'rounded', 'heart', 'star', 'triangle', 'diamond', 'hexagon', 'bars'],
};
const EMOJI = {
  'Faces': '😀😂🤣😍🥰😎🤩😜🤪😇🥳😭😡🥺🤔😴🤯😱🙄😏😅'.match(/./gu),
  'Love': '❤️🧡💛💚💙💜🖤🤍💖💘💝💕💞💋🌹'.match(/\p{Extended_Pictographic}️?/gu),
  'Hands': '👍👎👏🙌🙏🤝✌️🤞🤟🤘👌👊💪👋🫶'.match(/\p{Extended_Pictographic}️?/gu),
  'Party': '🎉🎊🎈🎁🎂🥂🍾✨🌟💫⭐🔥💥💯🏆👑🎵🎶🎤🎧'.match(/\p{Extended_Pictographic}️?/gu),
  'Nature': '🌴🌺🌸🌻🌈☀️🌙⛅🌊🔥❄️🍃🦁🐘🦒🦓🐒🐢🦋🐬'.match(/\p{Extended_Pictographic}️?/gu),
  'Food': '🍕🍔🍟🌮🍩🍦🍉🍓🥭🍌☕🍺🥥🍗🍚🍰'.match(/\p{Extended_Pictographic}️?/gu),
  'Symbols': '✅❌⚠️❗❓💬📍📌🔔🚀⚡💡🎯🔒📷🎬🇹🇿'.match(/\p{Extended_Pictographic}️?|🇹🇿/gu),
};
const Stickers = {
  baseSize: (W, H) => .26 * Math.min(W, H),
  draw(ctx, st, size) {
    if (st.kind === 'emoji') {
      ctx.save(); ctx.font = `${size * .8}px "Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(st.v, 0, size * .04); ctx.restore();
    } else {
      ctx.save(); ctx.scale(size, size); const p = Shapes.get(st.v);
      ctx.fillStyle = st.color || '#ffd60a'; ctx.fill(p);
      ctx.lineWidth = .03; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke(p); ctx.restore();
    }
  },
};

/* ---------- animation catalogue ---------- */
const ANIMS = {
  in: [['none', 'None'], ['fade', 'Fade'], ['zoom', 'Zoom'], ['pop', 'Pop'], ['slider', 'Slide ←'], ['slidel', 'Slide →'], ['slideu', 'Slide ↑'], ['slided', 'Slide ↓'], ['spin', 'Spin'], ['drop', 'Drop'], ['blur', 'Blur'], ['type', 'Typewriter']],
  out: [['none', 'None'], ['fade', 'Fade'], ['zoom', 'Zoom'], ['slider', 'Slide ←'], ['slidel', 'Slide →'], ['slideu', 'Slide ↑'], ['slided', 'Slide ↓'], ['spin', 'Spin'], ['blur', 'Blur']],
  loop: [['none', 'None'], ['pulse', 'Pulse'], ['bounce', 'Bounce'], ['shake', 'Shake'], ['swing', 'Swing'], ['float', 'Float'], ['spin', 'Rotate'], ['flash', 'Blink'], ['heart', 'Heartbeat']],
};
const Anim = {
  transformAt(it, lt) {
    const b = it.tf;
    let x = b.x, y = b.y, s = b.s, r = b.r, op = b.op, blur = 0;
    const kf = it.kf;
    if (kf && kf.length) {
      const ks = kf.slice().sort((a, c) => a.t - c.t);
      let v;
      if (lt <= ks[0].t) v = ks[0];
      else if (lt >= ks[ks.length - 1].t) v = ks[ks.length - 1];
      else {
        let i = 0; while (lt > ks[i + 1].t) i++;
        const a = ks[i], c = ks[i + 1], f = U.ease.inOut((lt - a.t) / ((c.t - a.t) || 1));
        v = { x: U.lerp(a.x, c.x, f), y: U.lerp(a.y, c.y, f), s: U.lerp(a.s, c.s, f), r: U.lerp(a.r, c.r, f), op: U.lerp(a.op, c.op, f) };
      }
      x = v.x; y = v.y; s = v.s; r = v.r; op = v.op;
    }
    const an = it.anim || {};
    const phase = (a, p, dir) => {
      const q = 1 - p; // q: 1 at hidden state
      switch (a.id) {
        case 'fade': op *= p; break;
        case 'zoom': s *= .35 + .65 * p; op *= p; break;
        case 'pop': s *= Math.max(0.001, U.ease.back(p)); op *= Math.min(1, p * 4); break;
        case 'slider': x += dir * q * .6; break;
        case 'slidel': x -= dir * q * .6; break;
        case 'slideu': y += dir * q * .6; break;
        case 'slided': y -= dir * q * .6; break;
        case 'spin': r += dir * -q * 180; s *= Math.max(.01, p); op *= p; break;
        case 'drop': y -= dir * q * .5; op *= Math.min(1, p * 3); break;
        case 'blur': blur = q * 22; op *= p; break;
      }
    };
    if (an.in && an.in.id !== 'none' && an.in.id !== 'type') { const d = an.in.dur || .5; if (lt < d) phase(an.in, U.ease.out(U.clamp(lt / d, 0, 1)), 1); }
    if (an.out && an.out.id !== 'none') { const d = an.out.dur || .5, rem = it.dur - lt; if (rem < d) phase(an.out, U.ease.out(U.clamp(rem / d, 0, 1)), -1); }
    if (an.loop && an.loop.id !== 'none') {
      const t = lt, sp = an.loop.speed || 1;
      switch (an.loop.id) {
        case 'pulse': s *= 1 + .08 * Math.sin(2 * Math.PI * 1.5 * sp * t); break;
        case 'bounce': y -= Math.abs(Math.sin(Math.PI * 1.5 * sp * t)) * .05; break;
        case 'shake': x += Math.sin(t * 45 * sp) * .008; break;
        case 'swing': r += Math.sin(2 * Math.PI * .8 * sp * t) * 9; break;
        case 'float': y += Math.sin(2 * Math.PI * .5 * sp * t) * .02; break;
        case 'spin': r += t * 90 * sp; break;
        case 'flash': op *= .35 + .65 * Math.abs(Math.sin(Math.PI * 1.2 * sp * t)); break;
        case 'heart': { const k = (t * 1.3 * sp) % 1; s *= 1 + .12 * (Math.exp(-k * 8) * Math.sin(k * 20) ** 2 + Math.exp(-Math.abs(k - .25) * 10) * .6); break; }
      }
    }
    return { x, y, s, r, op: U.clamp(op, 0, 1), fx: b.fx, fy: b.fy, blur };
  },
};

/* ---------- transitions ---------- */
const TRANSITIONS = [
  ['none', 'None'], ['fade', 'Fade'], ['dip', 'Dip to black'], ['flash', 'Flash'], ['slidel', 'Slide ←'], ['slider', 'Slide →'], ['slideu', 'Slide ↑'], ['slided', 'Slide ↓'],
  ['pushl', 'Push ←'], ['pushr', 'Push →'], ['wipel', 'Wipe ←'], ['wiper', 'Wipe →'], ['wipeu', 'Wipe ↑'], ['wiped', 'Wipe ↓'],
  ['zoom', 'Zoom'], ['spin', 'Spin'], ['circle', 'Iris'], ['blur', 'Blur'], ['glitch', 'Glitch'],
];
const Trans = {
  tmp: [],
  getTmp(i, W, H) { let c = this.tmp[i]; if (!c) c = this.tmp[i] = document.createElement('canvas'); if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H); return c; },
  mod(ctx, W, H, m, fn) {
    ctx.save();
    if (m.clip) m.clip(ctx);
    ctx.translate(W / 2 + (m.dx || 0), H / 2 + (m.dy || 0));
    if (m.rot) ctx.rotate(m.rot);
    const sc = m.sc == null ? 1 : m.sc; ctx.scale(sc, sc); ctx.translate(-W / 2, -H / 2);
    ctx.globalAlpha *= (m.alpha == null ? 1 : m.alpha);
    fn(ctx);
    ctx.restore();
  },
  /* dA(ctx), dB(ctx) draw the two clips onto the given context */
  draw(ctx, W, H, p, id, dA, dB) {
    const M = (m, f) => this.mod(ctx, W, H, m, f);
    const rect = (x, y, w, h) => c => { c.beginPath(); c.rect(x, y, w, h); c.clip(); };
    switch (id) {
      case 'dip': if (p < .5) M({ alpha: 1 - 2 * p }, dA); else M({ alpha: 2 * p - 1 }, dB); break;
      case 'flash': { if (p < .5) dA(ctx); else dB(ctx); ctx.save(); ctx.globalAlpha = 1 - Math.abs(2 * p - 1); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore(); break; }
      case 'slidel': dA(ctx); M({ dx: (1 - p) * W }, dB); break;
      case 'slider': dA(ctx); M({ dx: -(1 - p) * W }, dB); break;
      case 'slideu': dA(ctx); M({ dy: (1 - p) * H }, dB); break;
      case 'slided': dA(ctx); M({ dy: -(1 - p) * H }, dB); break;
      case 'pushl': M({ dx: -p * W }, dA); M({ dx: (1 - p) * W }, dB); break;
      case 'pushr': M({ dx: p * W }, dA); M({ dx: -(1 - p) * W }, dB); break;
      case 'wipel': dA(ctx); M({ clip: rect(W * (1 - p), 0, W * p, H) }, dB); break;
      case 'wiper': dA(ctx); M({ clip: rect(0, 0, W * p, H) }, dB); break;
      case 'wipeu': dA(ctx); M({ clip: rect(0, H * (1 - p), W, H * p) }, dB); break;
      case 'wiped': dA(ctx); M({ clip: rect(0, 0, W, H * p) }, dB); break;
      case 'zoom': M({ sc: 1 + p * .6, alpha: 1 - p }, dA); M({ sc: 1.35 - .35 * p, alpha: p }, dB); break;
      case 'spin': M({ alpha: 1 - p }, dA); M({ rot: (1 - p) * 1.4, sc: .3 + .7 * p, alpha: p }, dB); break;
      case 'circle': dA(ctx); M({ clip: c => { c.beginPath(); c.arc(W / 2, H / 2, p * Math.hypot(W, H) / 2, 0, Math.PI * 2); c.clip(); } }, dB); break;
      case 'blur': {
        const a = this.getTmp(0, W, H), b = this.getTmp(1, W, H);
        dA(a.getContext('2d')); dB(b.getContext('2d'));
        ctx.save(); ctx.filter = `blur(${p * 24}px)`; ctx.globalAlpha = 1 - p; ctx.drawImage(a, 0, 0); ctx.filter = `blur(${(1 - p) * 24}px)`; ctx.globalAlpha = p; ctx.drawImage(b, 0, 0); ctx.restore();
        break;
      }
      case 'glitch': {
        const a = this.getTmp(0, W, H), b = this.getTmp(1, W, H);
        dA(a.getContext('2d')); dB(b.getContext('2d'));
        const src = p < .5 ? a : b, seed = Math.floor(p * 18);
        const rnd = i => { const x = Math.sin(seed * 91.7 + i * 12.3) * 43758.5453; return x - Math.floor(x); };
        const strips = 14, sh = H / strips, amt = Math.sin(p * Math.PI) * W * .12;
        for (let i = 0; i < strips; i++) ctx.drawImage(src, 0, i * sh, W, sh, (rnd(i) - .5) * 2 * amt, i * sh, W, sh);
        break;
      }
      case 'fade': default: dA(ctx); M({ alpha: p }, dB);
    }
  },
};

/* ---------- pixel effects ---------- */
const EFFECTS = [
  ['shake', 'Shake'], ['zoomin', 'Zoom in'], ['zoomout', 'Zoom out'], ['pulse', 'Pulse'], ['blur', 'Blur'],
  ['rgb', 'RGB split'], ['glitch', 'Glitch'], ['vhs', 'VHS'], ['flash', 'Flash'], ['mirror', 'Mirror'], ['mosaic', 'Mosaic'],
];
const Fx = {
  tmp: {},
  get(k, w, h) { let c = this.tmp[k]; if (!c) c = this.tmp[k] = document.createElement('canvas'); w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h)); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return c; },
  rnd(seed) { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); },
  /* geometry modifiers from effects: returns {dx,dy,sc,blur} (dx/dy as fraction of size) */
  geo(fxs, lt, dur) {
    const o = { dx: 0, dy: 0, sc: 1, blur: 0 };
    (fxs || []).forEach(f => {
      const a = f.amt == null ? .5 : f.amt;
      switch (f.id) {
        case 'shake': { const k = Math.floor(lt * 24); o.dx += (this.rnd(k) - .5) * .05 * a * 2; o.dy += (this.rnd(k + 99) - .5) * .05 * a * 2; o.sc *= 1 + .03 * a; break; }
        case 'zoomin': o.sc *= 1 + a * .6 * U.clamp(lt / (dur || 1), 0, 1); break;
        case 'zoomout': o.sc *= 1 + a * .6 * (1 - U.clamp(lt / (dur || 1), 0, 1)); break;
        case 'pulse': o.sc *= 1 + a * .1 * Math.abs(Math.sin(lt * Math.PI * 1.6)); break;
        case 'blur': o.blur += a * 24; break;
      }
    });
    return o;
  },
  /* pixel-level effects: returns a canvas to draw or null if none applies */
  pixel(fxs, src, sx, sy, sw, sh, dw, dh, lt) {
    const list = (fxs || []).filter(f => ['rgb', 'glitch', 'vhs', 'flash', 'mirror', 'mosaic'].includes(f.id));
    if (!list.length) return null;
    dw = Math.max(2, Math.round(dw)); dh = Math.max(2, Math.round(dh));
    let cur = this.get('p0', dw, dh); let cx = cur.getContext('2d'); cx.clearRect(0, 0, dw, dh); cx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
    let flip = 1;
    list.forEach(f => {
      const a = f.amt == null ? .5 : f.amt;
      const nxt = this.get(flip ? 'p1' : 'p0', dw, dh); const nx = nxt.getContext('2d'); nx.setTransform(1, 0, 0, 1, 0, 0); nx.clearRect(0, 0, dw, dh);
      if (f.id === 'mosaic') {
        const bs = Math.max(2, Math.round(a * 40 + 4)), sm = this.get('m', Math.ceil(dw / bs), Math.ceil(dh / bs));
        sm.getContext('2d').drawImage(cur, 0, 0, sm.width, sm.height); nx.imageSmoothingEnabled = false; nx.drawImage(sm, 0, 0, dw, dh); nx.imageSmoothingEnabled = true;
      } else if (f.id === 'mirror') {
        nx.drawImage(cur, 0, 0); nx.save(); nx.translate(dw, 0); nx.scale(-1, 1); nx.beginPath(); nx.rect(0, 0, dw / 2, dh); nx.clip(); nx.drawImage(cur, 0, 0); nx.restore();
      } else if (f.id === 'rgb' || f.id === 'vhs') {
        const d = (f.id === 'vhs' ? .01 : .03) * a * 2 * dw * (f.id === 'rgb' ? (.6 + .4 * Math.sin(lt * 9)) : 1);
        const ch = [['#ff0000', -d], ['#00ff00', 0], ['#0000ff', d]];
        nx.globalCompositeOperation = 'lighter';
        ch.forEach(([col, off], i) => {
          const t = this.get('c' + i, dw, dh), tx = t.getContext('2d'); tx.globalCompositeOperation = 'source-over'; tx.clearRect(0, 0, dw, dh);
          tx.drawImage(cur, 0, 0); tx.globalCompositeOperation = 'multiply'; tx.fillStyle = col; tx.fillRect(0, 0, dw, dh);
          nx.drawImage(t, off, 0);
        });
        nx.globalCompositeOperation = 'source-over';
        if (f.id === 'vhs') {
          nx.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < dh; y += 4) nx.fillRect(0, y, dw, 1.5);
          const by = ((lt * .35) % 1) * dh; nx.fillStyle = 'rgba(255,255,255,.07)'; nx.fillRect(0, by, dw, dh * .05);
        }
      } else if (f.id === 'glitch') {
        nx.drawImage(cur, 0, 0);
        const k = Math.floor(lt * 10), n = 3 + Math.floor(a * 8);
        for (let i = 0; i < n; i++) {
          if (this.rnd(k * 7 + i) > .35 + a * .4) continue;
          const y = this.rnd(k + i * 3) * dh, hh = this.rnd(k * 5 + i) * dh * .12 + 2, dx = (this.rnd(k * 11 + i) - .5) * dw * .2 * a * 2;
          nx.drawImage(cur, 0, y, dw, hh, dx, y, dw, hh);
        }
      } else if (f.id === 'flash') {
        nx.drawImage(cur, 0, 0); const k = Math.pow(Math.abs(Math.sin(lt * Math.PI * 2)), 6) * a;
        nx.fillStyle = `rgba(255,255,255,${k})`; nx.fillRect(0, 0, dw, dh);
      }
      cur = nxt; flip = flip ? 0 : 1;
    });
    return cur;
  },
};

/* ---------- gizmo: on-canvas transform handles ---------- */
class Gizmo {
  /* host: positioned element wrapping the canvas. opts: {canvas, size():{W,H}, box():{cx,cy,w,h,rot}|null, tf():{x,y,s,r}, set(tf), start(), end(), buttons:[{pos,icon,fn}], pick(x,y), tap()} */
  constructor(host, o) {
    this.host = host; this.o = o; this.ptrs = new Map(); this.mode = null;
    this.el = h('div', { class: 'gz hidden' }, h('div', { class: 'gz-body' }));
    this.hScale = h('div', { class: 'gz-h gz-br', html: Icons.get('rotate', 16) });
    this.el.append(this.hScale);
    (o.buttons || []).forEach(b => { const e = h('button', { class: 'gz-h gz-' + b.pos, html: Icons.get(b.icon, 16), onpointerdown: ev => { ev.stopPropagation(); }, onclick: ev => { ev.stopPropagation(); b.fn(); } }); this.el.append(e); });
    host.append(this.el);
    this.el.addEventListener('pointerdown', e => this.down(e, 'move'));
    this.hScale.addEventListener('pointerdown', e => { e.stopPropagation(); this.down(e, 'scale'); });
    host.addEventListener('pointerdown', e => this.hostDown(e));
    window.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    window.addEventListener('pointercancel', e => this.up(e));
  }
  metrics() {
    const c = this.o.canvas, r = c.getBoundingClientRect(), hr = this.host.getBoundingClientRect(), { W, H } = this.o.size();
    return { k: r.width / W, ox: r.left - hr.left, oy: r.top - hr.top, left: r.left, top: r.top, W, H };
  }
  refresh() {
    const b = this.o.box && this.o.box();
    if (!b) { this.el.classList.add('hidden'); return; }
    const m = this.metrics();
    this.el.classList.remove('hidden');
    Object.assign(this.el.style, { left: (m.ox + (b.cx - b.w / 2) * m.k) + 'px', top: (m.oy + (b.cy - b.h / 2) * m.k) + 'px', width: b.w * m.k + 'px', height: b.h * m.k + 'px', transform: `rotate(${b.rot || 0}deg)` });
  }
  down(e, mode) {
    if (!this.o.box || !this.o.box()) return;
    e.preventDefault(); e.stopPropagation();
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ptrs.size === 1) { this.begin(mode, e); }
    else this.beginPinch();
  }
  hostDown(e) {
    if (e.target.closest && e.target.closest('.gz')) return;
    const m = this.metrics();
    const x = (e.clientX - m.left) / m.k, y = (e.clientY - m.top) / m.k;
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ptrs.size === 2 && this.o.box && this.o.box()) { this.beginPinch(); return; }
    if (this.o.pick && x >= 0 && y >= 0 && x <= m.W && y <= m.H) {
      const hit = this.o.pick(x, y);
      if (hit) { this.o.select && this.o.select(hit); requestAnimationFrame(() => { if (this.o.box && this.o.box()) this.begin('move', e); }); }
      else { this.o.tap && this.o.tap(x, y); this.ptrs.delete(e.pointerId); }
    }
  }
  begin(mode, e) {
    this.mode = mode; this.t0 = this.o.tf(); this.p0 = { x: e.clientX, y: e.clientY }; this.moved = false;
    const m = this.metrics(), b = this.o.box();
    this.c = { x: m.left + b.cx * m.k, y: m.top + b.cy * m.k };
    this.v0 = { x: e.clientX - this.c.x, y: e.clientY - this.c.y };
    this.o.start && this.o.start();
  }
  beginPinch() {
    const ps = [...this.ptrs.values()]; if (ps.length < 2) return;
    this.mode = 'pinch'; this.t0 = this.o.tf();
    this.d0 = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1; this.a0 = Math.atan2(ps[1].y - ps[0].y, ps[1].x - ps[0].x);
    this.o.start && this.o.start();
  }
  move(e) {
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!this.mode) return;
    const m = this.metrics(); this.moved = true;
    if (this.mode === 'move' && this.ptrs.size === 1) {
      this.o.set({ ...this.t0, x: this.t0.x + (e.clientX - this.p0.x) / (m.k * m.W), y: this.t0.y + (e.clientY - this.p0.y) / (m.k * m.H) }, 'move');
    } else if (this.mode === 'scale') {
      const v = { x: e.clientX - this.c.x, y: e.clientY - this.c.y };
      const s = this.t0.s * (Math.hypot(v.x, v.y) / (Math.hypot(this.v0.x, this.v0.y) || 1));
      let r = this.t0.r + (Math.atan2(v.y, v.x) - Math.atan2(this.v0.y, this.v0.x)) * 180 / Math.PI;
      const sn = Math.round(r / 45) * 45; if (Math.abs(r - sn) < 3) r = sn;
      this.o.set({ ...this.t0, s: U.clamp(s, .05, 12), r }, 'scale');
    } else if (this.mode === 'pinch' && this.ptrs.size >= 2) {
      const ps = [...this.ptrs.values()];
      const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), a = Math.atan2(ps[1].y - ps[0].y, ps[1].x - ps[0].x);
      this.o.set({ ...this.t0, s: U.clamp(this.t0.s * d / this.d0, .05, 12), r: this.t0.r + (a - this.a0) * 180 / Math.PI }, 'pinch');
    }
  }
  up(e) {
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.delete(e.pointerId);
    if (this.mode && this.ptrs.size === 0) { const wasMoved = this.moved; this.mode = null; this.o.end && this.o.end(wasMoved); }
    else if (this.mode === 'pinch' && this.ptrs.size === 1) { this.mode = null; this.o.end && this.o.end(true); }
  }
}

window.FONTS = FONTS; window.TextR = TextR; window.Shapes = Shapes; window.EMOJI = EMOJI; window.Stickers = Stickers; window.ANIMS = ANIMS; window.Anim = Anim;
window.TRANSITIONS = TRANSITIONS; window.Trans = Trans; window.EFFECTS = EFFECTS; window.Fx = Fx; window.Gizmo = Gizmo;
