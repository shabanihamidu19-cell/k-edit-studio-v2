'use strict';
/* K-EDIT STUDIO - playback engine, compositor and realtime audio graph.
   The same compositor (Engine.drawProject) renders the preview canvas and the export canvas.
   Video decoding stays inside pooled <video>/<audio> elements (never loaded into JS memory). */

const Engine = {
  canvas: null, ctx: null, W: 960, H: 540, t: 0, playing: false, exporting: false,
  actx: null, master: null, monitor: null, exportDest: null,
  pool: { video: [], audio: [] }, onFrame: null, ckc: null,

  init(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
    Bus.on('change', e => { if (!this.playing && !this.exporting) this.refresh(); });
    this.requestRender = U.raf(() => this.render());
  },
  previewShort() { const q = Settings.get('previewQ', 'auto'); return q === 'auto' ? (U.isLowEnd() ? 480 : 720) : +q; },
  setSize() {
    const p = Store.project; if (!p) return;
    const d = Model.dims(p, this.previewShort());
    this.W = d.w; this.H = d.h;
    if (this.canvas.width !== d.w || this.canvas.height !== d.h) { this.canvas.width = d.w; this.canvas.height = d.h; }
    this.requestRender();
  },
  get duration() { return Store.project ? Store.project.duration : 0; },

  /* ---------------- audio graph ---------------- */
  audioInit() {
    if (this.actx) { if (this.actx.state === 'suspended') this.actx.resume().catch(() => { }); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.actx = new AC();
      this.master = this.actx.createGain(); this.monitor = this.actx.createGain();
      this.exportDest = this.actx.createMediaStreamDestination();
      this.master.connect(this.monitor); this.monitor.connect(this.actx.destination); this.master.connect(this.exportDest);
      this.actx.resume().catch(() => { });
    } catch (e) { console.warn('WebAudio unavailable', e); this.actx = null; }
  },
  setMonitor(on) { if (this.monitor) this.monitor.gain.value = on ? 1 : 0; },
  wireFx(el, id) {
    if (!this.actx || !el._src) return;
    if (el._afx === id && el._fx) return;
    try { el._src.disconnect(); } catch (e) { }
    if (el._fx) { try { el._fx.output.disconnect(); } catch (e) { } }
    el._fx = AudioUtil.buildFx(this.actx, id || 'none'); el._afx = id;
    el._src.connect(el._fx.input); el._fx.output.connect(el._g);
  },
  makeEl(kind) {
    const el = document.createElement(kind);
    el.preload = 'auto'; el.playsInline = true; el.setAttribute('playsinline', ''); el.setAttribute('webkit-playsinline', '');
    el.addEventListener('seeked', () => this.requestRender());
    el.addEventListener('loadeddata', () => this.requestRender());
    this.audioInit();
    if (this.actx) {
      try { el._src = this.actx.createMediaElementSource(el); el._g = this.actx.createGain(); el._g.connect(this.master); this.wireFx(el, 'none'); } catch (e) { console.warn('mediaElementSource', e); el._src = null; }
    }
    return el;
  },
  acquire(kind, mid) {
    const arr = this.pool[kind];
    let e = arr.find(x => !x._used && x._mid === mid) || arr.find(x => !x._used);
    if (!e && arr.length < (kind === 'video' ? 6 : 6)) { e = this.makeEl(kind); arr.push(e); }
    if (e) e._used = true;
    return e;
  },
  release(el) { try { el.pause(); } catch (e) { } el._used = false; el._iid = null; if (el._g) el._g.gain.value = 0; },
  bound(it) { for (const k of ['video', 'audio']) { const e = this.pool[k].find(x => x._used && x._iid === it.id); if (e) return e; } return null; },
  volAt(it, lt) {
    let v = it.mute ? 0 : it.vol;
    if (it.fadeIn > 0 && lt < it.fadeIn) v *= U.clamp(lt / it.fadeIn, 0, 1);
    const rem = it.dur - lt; if (it.fadeOut > 0 && rem < it.fadeOut) v *= U.clamp(rem / it.fadeOut, 0, 1);
    return v;
  },

  /* ---------------- sync elements to time ---------------- */
  sync(t, playing, hard) {
    const p = Store.project; if (!p) return;
    const need = new Set();
    p.items.forEach(it => {
      if (it.type !== 'video' && it.type !== 'audio') return;
      const live = t >= it.start - 1e-6 && t < it.start + it.dur - 1e-6;
      const soon = !live && t < it.start && it.start - t < (playing ? 1.4 : 0.05);
      if (live || soon) need.add(it);
    });
    const ids = new Set([...need].map(i => i.id));
    for (const k of ['video', 'audio']) this.pool[k].forEach(e => { if (e._used && !ids.has(e._iid)) this.release(e); });
    need.forEach(it => {
      if (it.type === 'video' && it.reverse && it.rev && Reverser.has(it.rev.key)) { const old = this.bound(it); if (old) this.release(old); return; }
      const media = Library.get(it.mediaId); if (!media) return;
      let el = this.bound(it);
      if (!el) { el = this.acquire(it.type === 'audio' ? 'audio' : 'video', media.id); if (!el) return; el._iid = it.id; hard = true; }
      if (el._mid !== media.id) { el.src = media.url; el._mid = media.id; }
      if (el._g) this.wireFx(el, it.afx);
      const live = t >= it.start - 1e-6 && t < it.start + it.dur - 1e-6;
      const lt = U.clamp(t - it.start, 0, Math.max(0, it.dur - 1e-3));
      const want = Model.srcAt(it, live ? lt : 0);
      const vol = live && !(it.reverse && it.type === 'video') ? this.volAt(it, lt) : 0;
      if (el._g) el._g.gain.value = vol; else el.volume = U.clamp(vol, 0, 1);
      if (live && playing) {
        const sp = U.clamp(Model.speedAt(it, lt), 0.0625, 16);
        if (el.playbackRate !== sp) el.playbackRate = sp;
        if (it.reverse) { if (!el.paused) el.pause(); if (Math.abs(el.currentTime - want) > .04) el.currentTime = want; return; }
        if (hard || Math.abs(el.currentTime - want) > .3) { try { el.currentTime = want; } catch (e) { } }
        if (el.paused) { const pr = el.play(); if (pr && pr.catch) pr.catch(() => { }); }
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - want) > .03) { try { el.currentTime = want; } catch (e) { } }
      }
    });
  },
  refresh() { this.setSize(); this.t = U.clamp(this.t, 0, this.duration); this.sync(this.t, false); this.requestRender(); Bus.emit('time', this.t); },

  /* ---------------- transport ---------------- */
  play() {
    if (this.playing || !Store.project || !Store.project.items.length) return;
    this.audioInit();
    if (this.t >= this.duration - .03) this.t = 0;
    this.playing = true; this.w0 = performance.now(); this.t0 = this.t;
    this.sync(this.t, true, true);
    Bus.emit('play');
    this.raf = requestAnimationFrame(() => this.loop());
  },
  pause() {
    if (!this.playing) return;
    this.playing = false; cancelAnimationFrame(this.raf);
    this.sync(this.t, false); this.requestRender(); Bus.emit('pause');
  },
  toggle() { this.playing ? this.pause() : this.play(); },
  loop() {
    if (!this.playing) return;
    let t = this.t0 + (performance.now() - this.w0) / 1000;
    const d = this.duration;
    if (t >= d) { this.t = d; this.sync(d, true); if (!this.exporting) this.render(); this.onFrame && this.onFrame(d); Bus.emit('time', d); this.playing = false; this.sync(d, false); Bus.emit('pause'); Bus.emit('ended'); return; }
    this.t = t; this.sync(t, true);
    if (!this.exporting) this.render();
    if (this.onFrame) this.onFrame(t);
    Bus.emit('time', t);
    this.raf = requestAnimationFrame(() => this.loop());
  },
  seek(t) {
    this.t = U.clamp(t, 0, this.duration);
    if (this.playing) { this.w0 = performance.now(); this.t0 = this.t; this.sync(this.t, true, true); }
    else { this.sync(this.t, false); this.requestRender(); }
    Bus.emit('time', this.t);
  },
  async settle(ms = 1500) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const busy = [...this.pool.video, ...this.pool.audio].some(e => e._used && (e.seeking || e.readyState < 2));
      if (!busy) break; await U.sleep(30);
    }
  },
  render() {
    if (!Store.project) return;
    this.drawProject(this.ctx, this.W, this.H, this.t, {});
    Bus.emit('rendered');
  },

  /* ---------------- sources & layout ---------------- */
  srcFor(it, t) {
    if (it.type === 'image') { const m = Library.get(it.mediaId); return m && m.img ? { d: m.img, w: m.img.width, h: m.img.height } : null; }
    if (it.type === 'video') {
      const m = Library.get(it.mediaId); if (!m) return null;
      if (it.reverse && it.rev && Reverser.has(it.rev.key)) {
        const bm = Reverser.frame(it.rev.key, Model.srcAt(it, U.clamp(t - it.start, 0, it.dur)));
        return bm ? { d: bm, w: bm.width, h: bm.height } : null;
      }
      const el = this.bound(it);
      if (el && el.readyState >= 2 && el.videoWidth) return { d: el, w: el.videoWidth, h: el.videoHeight };
      if (el && el._last) return { d: el._last, w: el._last.width, h: el._last.height };
      return null;
    }
    return null;
  },
  box(it, lt, W, H) {
    const tf = Anim.transformAt(it, lt);
    let bw, bh;
    if (it.type === 'text') { const L = TextR.layout(it, W, H); bw = L.w; bh = L.h; tf._L = L; }
    else if (it.type === 'sticker') { bw = bh = Stickers.baseSize(W, H); }
    else if (it.type === 'color') { bw = W; bh = H; }
    else {
      const m = Library.get(it.mediaId); if (!m) return null;
      const c = it.crop; let sw = m.w * (1 - c.l - c.r), sh = m.h * (1 - c.t - c.b);
      if ((it.rot90 || 0) % 2) { const q = sw; sw = sh; sh = q; }
      const k = it.fit === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
      bw = sw * k; bh = sh * k;
    }
    return { cx: W / 2 + tf.x * W, cy: H / 2 + tf.y * H, w: bw * tf.s, h: bh * tf.s, rot: tf.r, tf, bw, bh };
  },
  itemBox(it, t) { if (it.type === 'fxlayer' || it.type === 'audio') return null; return this.box(it, U.clamp(t - it.start, 0, it.dur), this.W, this.H); },
  visualAt(t) {
    const p = Store.project, out = [];
    const m = Model.mainAt(p, t);
    if (m.a) out.push(m.a); if (m.b) out.push(m.b);
    p.items.filter(i => i.track === 'ovl' && t >= i.start && t < i.start + i.dur && i.type !== 'fxlayer').sort((a, b) => (a.lane - b.lane) || (a.start - b.start)).forEach(i => out.push(i));
    return out;
  },
  hitTest(x, y) {
    const list = this.visualAt(this.t).reverse();
    for (const it of list) {
      const b = this.itemBox(it, this.t); if (!b) continue;
      const a = -b.rot * Math.PI / 180, dx = x - b.cx, dy = y - b.cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) { if (it.track === 'main' && list.length > 1 && it.type !== 'text') { /* main only if nothing else hit */ } return it; }
    }
    return null;
  },

  chromaKey(src, it, hq) {
    const k = it.chroma, maxD = hq ? 960 : 480, sc = Math.min(1, maxD / Math.max(src.w, src.h));
    const cw = Math.max(2, Math.round(src.w * sc)), ch = Math.max(2, Math.round(src.h * sc));
    if (!this.ckc) { this.ckc = document.createElement('canvas'); this.ckx = this.ckc.getContext('2d', { willReadFrequently: true }); }
    if (this.ckc.width !== cw || this.ckc.height !== ch) { this.ckc.width = cw; this.ckc.height = ch; }
    const x = this.ckx; x.clearRect(0, 0, cw, ch); x.drawImage(src.d, 0, 0, cw, ch);
    const im = x.getImageData(0, 0, cw, ch), d = im.data, [kr, kg, kb] = U.hex2rgb(k.color);
    const sim = k.sim * .8, sm = Math.max(.01, k.smooth * .5), dom = (kg >= kr && kg >= kb) ? 1 : (kb >= kr && kb >= kg) ? 2 : 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const dist = Math.sqrt((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2) / 441.7;
      let a = (dist - sim) / sm; a = a < 0 ? 0 : a > 1 ? 1 : a; a = a * a * (3 - 2 * a);
      d[i + 3] = d[i + 3] * a;
      if (a > 0 && a < 1.01) { // spill suppression
        if (dom === 1) { const m = Math.max(r, b); if (g > m) d[i + 1] = m; }
        else if (dom === 2) { const m = Math.max(r, g); if (b > m) d[i + 2] = m; }
        else { const m = Math.max(g, b); if (r > m) d[i] = m; }
      }
    }
    x.putImageData(im, 0, 0);
    return { d: this.ckc, w: cw, h: ch };
  },

  /* ---------------- compositor ---------------- */
  drawProject(ctx, W, H, t, o) {
    const p = Store.project;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.fillStyle = (p.bg && p.bg.color) || '#000'; ctx.fillRect(0, 0, W, H);
    const m = Model.mainAt(p, t);
    if (m.a && p.bg && p.bg.mode === 'blur') this.drawBlurBg(ctx, W, H, m.b && m.prog > .5 ? m.b : m.a, t);
    if (m.a) {
      if (m.b) {
        const id = (m.a.trans && m.a.trans.id) || 'fade';
        Trans.draw(ctx, W, H, m.prog, id, c => this.drawItem(c, W, H, m.a, t, o), c => this.drawItem(c, W, H, m.b, t, o));
      } else if (m.hold) this.drawItem(ctx, W, H, m.a, m.a.start + m.a.dur - 0.002, o);
      else this.drawItem(ctx, W, H, m.a, t, o);
    }
    p.items.filter(i => i.track === 'ovl' && t >= i.start && t < i.start + i.dur).sort((a, b) => (a.lane - b.lane) || (a.start - b.start))
      .forEach(i => this.drawItem(ctx, W, H, i, t, o));
  },
  drawBlurBg(ctx, W, H, it, t) {
    if (it.type !== 'video' && it.type !== 'image') return;
    const s = this.srcFor(it, t); if (!s) return;
    const k = Math.max(W / s.w, H / s.h);
    ctx.save(); ctx.filter = `blur(${Math.round(28 * W / 1080)}px)`; ctx.drawImage(s.d, (W - s.w * k) / 2, (H - s.h * k) / 2, s.w * k, s.h * k); ctx.filter = 'none';
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(0, 0, W, H); ctx.restore();
  },
  drawFxLayer(ctx, W, H, it, lt) {
    const tf = Anim.transformAt(it, lt);
    const snap = Fx.get('snap', W, H); const sx = snap.getContext('2d'); sx.setTransform(1, 0, 0, 1, 0, 0); sx.globalCompositeOperation = 'source-over'; sx.clearRect(0, 0, W, H); sx.drawImage(ctx.canvas, 0, 0, W, H);
    let R = snap;
    if (Model.hasGrade(it)) { R = ColorGL.process(snap, W, H, W, H, ColorGL.params(it.adj, it.flt, lt * 60)); }
    const px = Fx.pixel(it.fx, R, 0, 0, W, H, W, H, lt); if (px) R = px;
    const g = Fx.geo(it.fx, lt, it.dur);
    ctx.save(); ctx.globalAlpha = U.clamp(tf.op, 0, 1);
    ctx.translate(W / 2 + g.dx * W, H / 2 + g.dy * H); ctx.scale(g.sc, g.sc);
    const bl = Math.max(g.blur, (it.adj && it.adj.blur) ? it.adj.blur * .3 : 0); if (bl > 0) ctx.filter = `blur(${bl * W / 1080}px)`;
    ctx.drawImage(R, -W / 2, -H / 2, W, H); ctx.restore();
  },
  drawItem(ctx, W, H, it, t, o) {
    o = o || {};
    const lt = U.clamp(t - it.start, 0, it.dur);
    if (it.type === 'fxlayer') return this.drawFxLayer(ctx, W, H, it, lt);
    const isMedia = it.type === 'video' || it.type === 'image';
    let src = null;
    if (isMedia) { src = this.srcFor(it, t); if (!src) return; }
    const b = this.box(it, lt, W, H); if (!b) return;
    const tf = b.tf; if (tf.op <= .002) return;
    const g = Fx.geo(it.fx, lt, it.dur);
    ctx.save();
    ctx.globalAlpha *= tf.op; if (it.blend && it.blend !== 'source-over') ctx.globalCompositeOperation = it.blend;
    ctx.translate(b.cx + g.dx * b.w, b.cy + g.dy * b.h); ctx.rotate(tf.r * Math.PI / 180);
    ctx.scale((tf.fx ? -1 : 1) * g.sc, (tf.fy ? -1 : 1) * g.sc);
    const dw = b.w, dh = b.h;
    if (it.mask && it.mask.shape) { const pth = new Path2D(); pth.addPath(Shapes.get(it.mask.shape), new DOMMatrix([dw, 0, 0, dh, 0, 0])); ctx.clip(pth); }
    const blur = Math.max(tf.blur, g.blur) * W / 1080;
    if (blur > .1) ctx.filter = `blur(${blur}px)`;
    if (it.type === 'text') { ctx.scale(tf.s, tf.s); TextR.draw(ctx, it, lt, W, H, tf._L); }
    else if (it.type === 'sticker') Stickers.draw(ctx, it.sticker, Stickers.baseSize(W, H) * tf.s);
    else if (it.type === 'color') { ctx.fillStyle = it.color; ctx.fillRect(-dw / 2, -dh / 2, dw, dh); }
    else {
      let s = src;
      if (it.chroma && it.chroma.on) s = this.chromaKey(s, it, o.hq);
      const c = it.crop; let sx = s.w * c.l, sy = s.h * c.t, sw = s.w * (1 - c.l - c.r), sh = s.h * (1 - c.t - c.b);
      let dr = s.d;
      if (Model.hasGrade(it)) {
        const ow = Math.max(2, Math.round(dw)), oh = Math.max(2, Math.round(dh));
        let gsrc = dr, gw = s.w, gh = s.h;
        if (c.l || c.r || c.t || c.b) { const tc = Fx.get('crop', ow, oh); const tx = tc.getContext('2d'); tx.clearRect(0, 0, ow, oh); tx.drawImage(dr, sx, sy, sw, sh, 0, 0, ow, oh); gsrc = tc; gw = ow; gh = oh; }
        dr = ColorGL.process(gsrc, gw, gh, ow, oh, ColorGL.params(it.adj, it.flt, lt * 60));
        sx = 0; sy = 0; sw = dr.width; sh = dr.height;
      }
      const px = Fx.pixel(it.fx, dr, sx, sy, sw, sh, dw, dh, lt);
      if (px) { dr = px; sx = 0; sy = 0; sw = px.width; sh = px.height; }
      if (!blur && it.adj && it.adj.blur > 0) ctx.filter = `blur(${it.adj.blur * .3 * W / 1080}px)`;
      const q90 = it.rot90 || 0;
      if (q90) { ctx.rotate(q90 * Math.PI / 2); if (q90 % 2) ctx.drawImage(dr, sx, sy, sw, sh, -dh / 2, -dw / 2, dh, dw); else ctx.drawImage(dr, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh); }
      else ctx.drawImage(dr, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
    }
    ctx.restore();
  },
  /* keep a copy of the last good frame so decoding hiccups don't flash black */
  rememberFrames() {
    this.pool.video.forEach(el => { if (el._used && el.readyState >= 2 && el.videoWidth && !el.seeking) { const c = el._last || (el._last = document.createElement('canvas')); const k = Math.min(1, 640 / el.videoWidth); const w = Math.round(el.videoWidth * k), h = Math.round(el.videoHeight * k); if (c.width !== w) { c.width = w; c.height = h; } c.getContext('2d').drawImage(el, 0, 0, w, h); } });
  },
  /* grab the source frame of a video item at its current time (for freeze frame / AI stills) */
  async frameOf(it, maxDim = 1920) {
    await this.settle();
    const s = this.srcFor(it, this.t); if (!s) throw new Error('Frame not ready');
    const k = Math.min(1, maxDim / Math.max(s.w, s.h)); const c = U.canvas(s.w * k, s.h * k);
    c.getContext('2d').drawImage(s.d, 0, 0, c.width, c.height); return c;
  },
  snapshot(w = 320) {
    const c = U.canvas(w, w * this.H / this.W); this.drawProject(c.getContext('2d'), c.width, c.height, this.t, {}); return c;
  },
};
window.Engine = Engine;
