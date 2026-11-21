'use strict';
/* K-EDIT STUDIO - photo editor: non-destructive geometry + GPU grading + curves, text/stickers, drawing,
   background removal / replacement / blur (local + AI providers), heal / clone / object removal, auto enhance, transparent PNG export */

/* ---------- local image algorithms ---------- */
const ImgAlgo = {
  /* flood-fill based background removal for plain backgrounds. returns alpha-mask canvas (subject opaque) at src size */
  autoBg(src, tol) {
    const maxD = 900, k = Math.min(1, maxD / Math.max(src.width, src.height)), w = Math.max(2, Math.round(src.width * k)), h = Math.max(2, Math.round(src.height * k));
    const c = U.canvas(w, h), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    const px = (i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
    // reference colour = average of corner/edge samples (median per channel)
    const samples = []; const step = Math.max(1, Math.floor(Math.max(w, h) / 60));
    for (let i = 0; i < w; i += step) { samples.push(px(i), px((h - 1) * w + i)); }
    for (let j = 0; j < h; j += step) { samples.push(px(j * w), px(j * w + w - 1)); }
    const med = ch => { const a = samples.map(s => s[ch]).sort((p, q) => p - q); return a[a.length >> 1]; };
    const ref = [med(0), med(1), med(2)];
    const dist = (i, r) => Math.sqrt((d[i * 4] - r[0]) ** 2 + (d[i * 4 + 1] - r[1]) ** 2 + (d[i * 4 + 2] - r[2]) ** 2);
    const T = tol * 4.4; // 0..100 -> 0..440
    const bg = new Uint8Array(w * h), q = new Int32Array(w * h); let qh = 0, qt = 0;
    const push = i => { if (!bg[i]) { bg[i] = 1; q[qt++] = i; } };
    for (let i = 0; i < w; i++) { if (dist(i, ref) < T) push(i); if (dist((h - 1) * w + i, ref) < T) push((h - 1) * w + i); }
    for (let j = 0; j < h; j++) { if (dist(j * w, ref) < T) push(j * w); if (dist(j * w + w - 1, ref) < T) push(j * w + w - 1); }
    while (qh < qt) {
      const i = q[qh++], cx = i % w, cy = (i / w) | 0, pc = px(i);
      const nb = [cx > 0 ? i - 1 : -1, cx < w - 1 ? i + 1 : -1, cy > 0 ? i - w : -1, cy < h - 1 ? i + w : -1];
      for (const n of nb) { if (n < 0 || bg[n]) continue; const dr = dist(n, ref); if (dr < T || (dr < T * 2 && dist(n, pc) < T * .22)) push(n); }
    }
    const m = U.canvas(w, h), mx = m.getContext('2d'), im = mx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255; im.data[i * 4 + 3] = bg[i] ? 0 : 255; }
    mx.putImageData(im, 0, 0);
    // soften edge
    const out = U.canvas(src.width, src.height), ox = out.getContext('2d'); ox.filter = `blur(${Math.max(.6, 1.4 / k * .5)}px)`; ox.drawImage(m, 0, 0, out.width, out.height);
    return { mask: out, removed: bg.reduce((a, b) => a + b, 0) / (w * h) };
  },
  /* magic wand: remove connected region similar to tapped colour from existing mask */
  wand(src, mask, px0, py0, tol) {
    const maxD = 1000, k = Math.min(1, maxD / Math.max(src.width, src.height)), w = Math.round(src.width * k), h = Math.round(src.height * k);
    const c = U.canvas(w, h), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data;
    const sx = U.clamp(Math.round(px0 * k), 0, w - 1), sy = U.clamp(Math.round(py0 * k), 0, h - 1), si = sy * w + sx;
    const ref = [d[si * 4], d[si * 4 + 1], d[si * 4 + 2]], T = tol * 4.4, seen = new Uint8Array(w * h), q = new Int32Array(w * h); let qh = 0, qt = 0;
    q[qt++] = si; seen[si] = 1;
    while (qh < qt) { const i = q[qh++], cx = i % w, cy = (i / w) | 0; for (const n of [cx > 0 ? i - 1 : -1, cx < w - 1 ? i + 1 : -1, cy > 0 ? i - w : -1, cy < h - 1 ? i + w : -1]) { if (n < 0 || seen[n]) continue; const dd = Math.sqrt((d[n * 4] - ref[0]) ** 2 + (d[n * 4 + 1] - ref[1]) ** 2 + (d[n * 4 + 2] - ref[2]) ** 2); if (dd < T) { seen[n] = 1; q[qt++] = n; } } }
    const cut = U.canvas(w, h), cx2 = cut.getContext('2d'), im = cx2.createImageData(w, h);
    for (let i = 0; i < w * h; i++) if (seen[i]) { im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255; im.data[i * 4 + 3] = 255; }
    cx2.putImageData(im, 0, 0);
    const out = mask ? ImgAlgo.cloneCv(mask) : (() => { const f = U.canvas(src.width, src.height), fx = f.getContext('2d'); fx.fillStyle = '#fff'; fx.fillRect(0, 0, f.width, f.height); return f; })();
    const ox = out.getContext('2d'); ox.globalCompositeOperation = 'destination-out'; ox.filter = 'blur(1px)'; ox.drawImage(cut, 0, 0, out.width, out.height);
    return out;
  },
  cloneCv(c) { const n = U.canvas(c.width, c.height); n.getContext('2d').drawImage(c, 0, 0); return n; },
  /* diffusion / onion-peel inpainting with texture re-injection. maskCv: any opaque pixel = area to fill */
  inpaint(src, maskCv) {
    const W = src.width, H = src.height, mx = maskCv.getContext('2d').getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mx[(y * W + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < x0) return ImgAlgo.cloneCv(src);
    const m = 14; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(W - 1, x1 + m); y1 = Math.min(H - 1, y1 + m);
    let bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const sc = Math.min(1, 360 / Math.max(bw, bh)); // solve at reduced size for speed, then upsample only the filled pixels
    const w = Math.max(4, Math.round(bw * sc)), h = Math.max(4, Math.round(bh * sc));
    const crop = U.canvas(w, h), cx = crop.getContext('2d', { willReadFrequently: true }); cx.drawImage(src, x0, y0, bw, bh, 0, 0, w, h);
    const mk = U.canvas(w, h), mkx = mk.getContext('2d', { willReadFrequently: true }); mkx.drawImage(maskCv, x0, y0, bw, bh, 0, 0, w, h);
    const img = cx.getImageData(0, 0, w, h), D = img.data, M = mkx.getImageData(0, 0, w, h).data;
    const unk = new Uint8Array(w * h); let left = 0;
    for (let i = 0; i < w * h; i++) if (M[i * 4 + 3] > 40) { unk[i] = 1; left++; }
    // dilate unknown by 2px so brush edges/shadows are covered
    for (let it = 0; it < 2; it++) { const c2 = unk.slice(); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (!c2[i] && (c2[i - 1] || c2[i + 1] || c2[i - w] || c2[i + w])) { unk[i] = 1; left++; } } }
    const filled = unk.slice(), R = 3;
    // texture statistics of the ring
    let sum = 0, sq = 0, cnt = 0; for (let i = 0; i < w * h; i++) if (!unk[i]) { const l = (D[i * 4] + D[i * 4 + 1] + D[i * 4 + 2]) / 3; sum += l; sq += l * l; cnt++; }
    const std = cnt ? Math.sqrt(Math.max(0, sq / cnt - (sum / cnt) ** 2)) : 0; const noise = Math.min(14, std * .12);
    const known = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) known[i] = unk[i] ? 0 : 1;
    let guard = 0;
    while (left > 0 && guard++ < 400) {
      const upd = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (known[i]) continue;
        let r = 0, g = 0, b = 0, wt = 0;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; if (!known[j]) continue; const ww = 1 / (dx * dx + dy * dy + .5); r += D[j * 4] * ww; g += D[j * 4 + 1] * ww; b += D[j * 4 + 2] * ww; wt += ww; }
        if (wt > 0) upd.push([i, r / wt, g / wt, b / wt]);
      }
      if (!upd.length) break;
      upd.forEach(([i, r, g, b]) => { const n = (Math.random() - .5) * noise * 2; D[i * 4] = r + n; D[i * 4 + 1] = g + n; D[i * 4 + 2] = b + n; known[i] = 1; left--; });
    }
    cx.putImageData(img, 0, 0);
    // composite: filled region (feathered) back onto full-res copy
    const out = ImgAlgo.cloneCv(src), ox = out.getContext('2d');
    const patch = U.canvas(bw, bh), px = patch.getContext('2d'); px.imageSmoothingQuality = 'high'; px.drawImage(crop, 0, 0, bw, bh);
    const alpha = U.canvas(bw, bh), ax = alpha.getContext('2d'), am = ax.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { am.data[i * 4] = am.data[i * 4 + 1] = am.data[i * 4 + 2] = 255; am.data[i * 4 + 3] = filled[i] || unk[i] ? 255 : 0; }
    const tmp = U.canvas(w, h); tmp.getContext('2d').putImageData(am, 0, 0); ax.filter = 'blur(2px)'; ax.drawImage(tmp, 0, 0, bw, bh);
    px.globalCompositeOperation = 'destination-in'; px.drawImage(alpha, 0, 0);
    ox.drawImage(patch, x0, y0);
    return out;
  },
  autoLevels(c) {
    const k = Math.min(1, 256 / Math.max(c.width, c.height)), w = Math.max(2, Math.round(c.width * k)), h = Math.max(2, Math.round(c.height * k));
    const t = U.canvas(w, h), x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, hist = new Uint32Array(256); let n = 0, mean = 0, sat = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; const l = Math.round(.2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]); hist[l]++; n++; mean += l; sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); }
    let acc = 0, lo = 0, hi = 255; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * .005) { lo = i; break; } } acc = 0; for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * .005) { hi = i; break; } }
    return { lo, hi, mean: mean / n, sat: sat / n };
  },
};

const Photo = {
  S: null, ready: false, gizmo: null, brush: null, cropBox: null,

  mount() {
    if (this.ready) return; this.ready = true;
    this.host = $('#ph-host'); this.cv = $('#ph-canvas'); this.stage = $('#ph-stage'); this.tb = $('#ph-toolbar'); this.pn = $('#ph-panel');
    this.rq = U.raf(() => this.draw());
    this.gizmo = new Gizmo(this.host, {
      canvas: this.cv, size: () => ({ W: this.cv.width, H: this.cv.height }),
      box: () => this.layerBox(this.layer()), tf: () => { const l = this.layer(); return l ? { x: l.tf.x, y: l.tf.y, s: l.tf.s, r: l.tf.r } : { x: 0, y: 0, s: 1, r: 0 }; },
      set: tf => { const l = this.layer(); if (l) { Object.assign(l.tf, tf); this.rq(); } }, start: () => this.checkpoint(), end: () => this.gizmo.refresh(),
      buttons: [{ pos: 'tl', icon: 'close', fn: () => this.delLayer() }, { pos: 'tr', icon: 'copy', fn: () => this.dupLayer() }],
      pick: (x, y) => this.S && this.S.view === 'result' && !this.brush ? this.hitLayer(x, y) : null, select: id => { this.S.sel = id; this.gizmo.refresh(); this.renderTb(); },
    });
    new ResizeObserver(() => { this.layout(); this.rq(); }).observe(this.stage);
    $('#ph-back').onclick = () => this.exit();
    $('#ph-undo').onclick = () => this.undo(); $('#ph-redo').onclick = () => this.redo();
    $('#ph-export').onclick = () => this.exportDlg();
    this.bindBrush();
  },
  layout() {
    if (!this.S) return;
    const cw = this.stage.clientWidth, ch = this.stage.clientHeight; if (!cw || !ch || !this.cv.width) return;
    const a = this.cv.width / this.cv.height; let w = cw, h = cw / a; if (h > ch) { h = ch; w = ch * a; }
    this.cv.style.width = Math.floor(w) + 'px'; this.cv.style.height = Math.floor(h) + 'px'; this.gizmo.refresh();
  },

  /* ---------------- open / state ---------------- */
  async open(file) {
    this.mount();
    const b = UI.busy('Opening photo…');
    try {
      const maxDim = U.isLowEnd() ? 2048 : 3072;
      const bmp = await createImageBitmap(file); const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const src = U.canvas(bmp.width * k, bmp.height * k); src.getContext('2d').drawImage(bmp, 0, 0, src.width, src.height); const ow = bmp.width, oh = bmp.height; bmp.close && bmp.close();
      this.S = { name: (file.name || 'photo').replace(/\.[^.]+$/, ''), src, mask: null, ink: null, bg: null, ver: 1, origW: ow, origH: oh,
        geo: { rot: 0, fx: false, fy: false, angle: 0, crop: { x: 0, y: 0, w: 1, h: 1 } }, adj: {}, flt: null, curve: null, blur: { type: 'none', amt: 40 }, border: { w: 0, color: '#ffffff' },
        layers: [], sel: null, view: 'result', undoS: [], redoS: [] };
      this.brush = null; this.closePanel(); this.renderTb(); this.layout(); this.draw(); this.updUndo();
    } catch (e) { UI.toast('Could not open image: ' + e.message, 'error', 4000); throw e; } finally { b.done(); }
  },
  snapshot() {
    const S = this.S, plain = { geo: S.geo, adj: S.adj, flt: S.flt, curve: S.curve, blur: S.blur, border: S.border, bg: S.bg ? { ...S.bg, img: undefined } : null, layers: S.layers, sel: S.sel };
    return { p: JSON.stringify(plain), src: S.src, mask: S.mask, ink: S.ink, bgImg: S.bg && S.bg.img };
  },
  restore(sn) {
    const S = this.S, p = JSON.parse(sn.p); Object.assign(S, { geo: p.geo, adj: p.adj, flt: p.flt, curve: p.curve, blur: p.blur, border: p.border, layers: p.layers, sel: p.sel, src: sn.src, mask: sn.mask, ink: sn.ink });
    S.bg = p.bg ? { ...p.bg, img: sn.bgImg } : null; S.ver++;
  },
  checkpoint() { const S = this.S; S.undoS.push(this.snapshot()); if (S.undoS.length > 25) S.undoS.shift(); S.redoS.length = 0; this.updUndo(); },
  undo() { const S = this.S; if (!S || !S.undoS.length) return; S.redoS.push(this.snapshot()); this.restore(S.undoS.pop()); this.refreshAll(); },
  redo() { const S = this.S; if (!S || !S.redoS.length) return; S.undoS.push(this.snapshot()); this.restore(S.redoS.pop()); this.refreshAll(); },
  refreshAll() { this.updUndo(); this.renderTb(); this.rq(); },
  updUndo() { $('#ph-undo').disabled = !this.S || !this.S.undoS.length; $('#ph-redo').disabled = !this.S || !this.S.redoS.length; },
  /* mutate with undo capture (coalesced by key) */
  mut(fn, key) {
    const now = performance.now();
    if (!(key && key === this._lk && now - this._lt < 900)) this.checkpoint();
    this._lk = key || null; this._lt = now; fn(this.S); this.S.ver++; this.rq();
  },
  exit() { this.closePanel(); this.brush = null; App.go('home'); },

  /* ---------------- rendering ---------------- */
  base() {
    const S = this.S;
    if (S._base && S._bv === S.ver) return S._base;
    const { src, mask, bg, ink } = S, w = src.width, h = src.height, c = U.canvas(w, h), x = c.getContext('2d');
    if (mask) {
      const b = bg || { type: 'transparent' };
      if (b.type === 'color') { x.fillStyle = b.color; x.fillRect(0, 0, w, h); }
      else if (b.type === 'gradient') { const g = x.createLinearGradient(0, 0, w * .4, h); g.addColorStop(0, b.color); g.addColorStop(1, b.color2 || '#000'); x.fillStyle = g; x.fillRect(0, 0, w, h); }
      else if (b.type === 'image' && b.img) { const k = Math.max(w / b.img.width, h / b.img.height); x.drawImage(b.img, (w - b.img.width * k) / 2, (h - b.img.height * k) / 2, b.img.width * k, b.img.height * k); }
      else if (b.type === 'blur') { x.filter = `blur(${Math.max(1, b.blur * w / 1000)}px)`; x.drawImage(src, -w * .02, -h * .02, w * 1.04, h * 1.04); x.filter = 'none'; }
      const t = U.canvas(w, h), tx = t.getContext('2d'); tx.drawImage(src, 0, 0); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(mask, 0, 0); x.drawImage(t, 0, 0);
    } else x.drawImage(src, 0, 0);
    if (ink) x.drawImage(ink, 0, 0);
    S._base = c; S._bv = S.ver; return c;
  },
  /* geometry: returns {cv, scale} of cropped/rotated base at output resolution */
  frameSize() { const g = this.S.geo, b = this.S.src, q = g.rot % 2; return { RW: q ? b.height : b.width, RH: q ? b.width : b.height }; },
  zoomFor(crop) {
    const g = this.S.geo, a = g.angle * Math.PI / 180; if (!a) return 1;
    const { RW, RH } = this.frameSize(), cw = crop.w * RW, ch = crop.h * RH, cx = (crop.x + crop.w / 2 - .5) * RW, cy = (crop.y + crop.h / 2 - .5) * RH;
    let z = 1; const ca = Math.cos(a), sa = Math.sin(a);
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => { const px = cx + sx * cw / 2, py = cy + sy * ch / 2; const rx = px * ca + py * sa, ry = -px * sa + py * ca; z = Math.max(z, Math.abs(rx) / (RW / 2), Math.abs(ry) / (RH / 2)); });
    return z;
  },
  geoCanvas(maxDim, cropOverride) {
    const S = this.S, g = S.geo, base = this.base(), { RW, RH } = this.frameSize(), crop = cropOverride || g.crop;
    const cw = crop.w * RW, ch = crop.h * RH, sc = Math.min(1, maxDim / Math.max(cw, ch));
    const c = U.canvas(cw * sc, ch * sc), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.scale(sc, sc); x.translate(-crop.x * RW, -crop.y * RH); x.translate(RW / 2, RH / 2);
    x.rotate(g.angle * Math.PI / 180); const z = this.zoomFor(crop); x.scale((g.fx ? -1 : 1) * z, (g.fy ? -1 : 1) * z); x.rotate(g.rot * Math.PI / 2);
    x.drawImage(base, -base.width / 2, -base.height / 2);
    return { cv: c, scale: sc };
  },
  gradeParams() { const S = this.S; return ColorGL.params({ ...S.adj, curve: S.curve }, S.flt, 0); },
  hasGrade() { const S = this.S; return (S.flt && S.flt.id !== 'none') || Object.values(S.adj || {}).some(v => v) || (S.curve && !Curves.isIdentity(S.curve)); },
  /* full pipeline to a canvas (display or export) */
  render(maxDim, { cropOverride, noLayers } = {}) {
    const S = this.S; let { cv: g } = this.geoCanvas(maxDim, cropOverride);
    let out = g;
    if (this.hasGrade()) { const r = ColorGL.process(g, g.width, g.height, g.width, g.height, this.gradeParams()); out = U.canvas(g.width, g.height); out.getContext('2d').drawImage(r, 0, 0); }
    const bl = S.blur;
    if (bl.type !== 'none' && bl.amt > 0) {
      const o2 = U.canvas(out.width, out.height), x = o2.getContext('2d'), px = bl.amt / 100 * 14 * out.width / 1000;
      x.drawImage(out, 0, 0);
      if (bl.type === 'gauss') { x.filter = `blur(${px}px)`; x.drawImage(out, 0, 0); }
      else {
        const t = U.canvas(out.width, out.height), tx = t.getContext('2d'); tx.filter = `blur(${px}px)`; tx.drawImage(out, 0, 0); tx.filter = 'none'; tx.globalCompositeOperation = 'destination-out';
        const W = out.width, H = out.height; let gr;
        if (bl.type === 'radial') { gr = tx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .18, W / 2, H / 2, Math.min(W, H) * .6); } else { gr = tx.createLinearGradient(0, H * .3, 0, H * .7); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(.5, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); }
        if (bl.type === 'radial') { gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); }
        tx.fillStyle = gr; tx.fillRect(0, 0, W, H); x.drawImage(t, 0, 0);
      }
      out = o2;
    }
    if (!noLayers) {
      const x = out.getContext('2d'), W = out.width, H = out.height;
      S.layers.forEach(l => this.drawLayer(x, l, W, H));
      if (S.border.w > 0) { const bw = S.border.w / 100 * Math.min(W, H) * .5; x.save(); x.strokeStyle = S.border.color; x.lineWidth = bw * 2; x.strokeRect(0, 0, W, H); x.restore(); }
    }
    return out;
  },
  draw() {
    const S = this.S; if (!S) return;
    const cap = Math.min(1600, Math.round(Math.max(this.stage.clientWidth, this.stage.clientHeight) * Math.min(2, window.devicePixelRatio || 1)) || 1200);
    let c;
    if (S.view === 'base') { const b = this.base(), k = Math.min(1, cap / Math.max(b.width, b.height)); c = U.canvas(b.width * k, b.height * k); c.getContext('2d').drawImage(b, 0, 0, c.width, c.height); if (this.brushMask) { const x = c.getContext('2d'); x.globalAlpha = .55; x.drawImage(this.brushMask, 0, 0, c.width, c.height); x.globalAlpha = 1; } }
    else if (S.view === 'crop') { c = this.render(cap, { cropOverride: { x: 0, y: 0, w: 1, h: 1 }, noLayers: true }); }
    else c = this.render(cap);
    if (this.cv.width !== c.width || this.cv.height !== c.height) { this.cv.width = c.width; this.cv.height = c.height; }
    const x = this.cv.getContext('2d'); x.clearRect(0, 0, c.width, c.height); x.drawImage(c, 0, 0);
    this.layout(); this.gizmo.refresh(); if (this.cropBox) this.cropBox.refresh();
  },

  /* ---------------- layers ---------------- */
  layer() { const S = this.S; return S && S.sel && S.view === 'result' ? S.layers.find(l => l.id === S.sel) : null; },
  layerBox(l) {
    if (!l) return null; const W = this.cv.width, H = this.cv.height; let bw, bh;
    if (l.type === 'text') { const L = TextR.layout({ text: l.text }, W, H); bw = L.w; bh = L.h; } else { bw = bh = Stickers.baseSize(W, H); }
    return { cx: W / 2 + l.tf.x * W, cy: H / 2 + l.tf.y * H, w: bw * l.tf.s, h: bh * l.tf.s, rot: l.tf.r };
  },
  drawLayer(x, l, W, H) {
    x.save(); x.translate(W / 2 + l.tf.x * W, H / 2 + l.tf.y * H); x.rotate(l.tf.r * Math.PI / 180);
    if (l.type === 'text') { x.scale(l.tf.s, l.tf.s); TextR.draw(x, { text: l.text, anim: {}, words: null }, 0, W, H); }
    else Stickers.draw(x, l.sticker, Stickers.baseSize(W, H) * l.tf.s);
    x.restore();
  },
  hitLayer(px, py) {
    const S = this.S; for (let i = S.layers.length - 1; i >= 0; i--) {
      const l = S.layers[i], b = this.layerBox(l), a = -b.rot * Math.PI / 180, dx = px - b.cx, dy = py - b.cy;
      if (Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) <= b.w / 2 && Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) <= b.h / 2) return l.id;
    }
    return null;
  },
  addLayer(l) { this.checkpoint(); l.id = U.uid('l'); this.S.layers.push(l); this.S.sel = l.id; this.S.ver++; this.rq(); this.renderTb(); return l; },
  delLayer() { const S = this.S, l = this.layer(); if (!l) return; this.checkpoint(); S.layers = S.layers.filter(x => x !== l); S.sel = null; this.closePanel(); this.renderTb(); this.rq(); },
  dupLayer() { const l = this.layer(); if (!l) return; const n = JSON.parse(JSON.stringify(l)); n.tf.x += .05; n.tf.y += .05; this.addLayer(n); },

  /* ---------------- toolbar / panels ---------------- */
  tbtn(icon, label, fn, cls = '') { return h('button', { class: 'tb ' + cls, onclick: fn }, ic(icon, 22), h('span', null, label)); },
  renderTb() {
    const tb = this.tb; tb.innerHTML = ''; const B = (i, l, f, c) => tb.append(this.tbtn(i, l, f, c)); const S = this.S; if (!S) return;
    const l = this.layer();
    if (l) {
      B('back', 'Back', () => { S.sel = null; this.renderTb(); this.gizmo.refresh(); });
      if (l.type === 'text') B('text', 'Edit', () => this.textPanel());
      B('copy', 'Duplicate', () => this.dupLayer()); B('trash', 'Delete', () => this.delLayer(), 'danger'); return;
    }
    B('crop', 'Crop', () => this.cropPanel()); B('adjust', 'Adjust', () => this.adjustPanel()); B('sparkles', 'Filters', () => this.filterPanel()); B('curve', 'Curves', () => this.curvePanel());
    B('heal', 'Retouch', () => this.retouchPanel()); B('image', 'Background', () => this.bgPanel()); B('text', 'Text', () => this.addText()); B('smile', 'Stickers', () => this.stickerPanel());
    B('draw', 'Draw', () => this.drawPanel()); B('blur', 'Blur', () => this.blurPanel()); B('wand', 'Enhance', () => this.enhancePanel());
  },
  panel(title, body, onClose, view = 'result') {
    this.closePanel(true); this.pn.innerHTML = '';
    this.pn.append(h('div', { class: 'pn-h' }, h('b', null, title), h('button', { class: 'ibtn', onclick: () => this.closePanel(), html: Icons.get('check', 22) })), h('div', { class: 'pn-b' }, body));
    this.pn.classList.remove('hidden'); this.tb.classList.add('hidden'); this._onClose = onClose;
    if (this.S.view !== view) { this.S.view = view; this.S.ver++; }
    this.rq(); setTimeout(() => { this.layout(); this.rq(); }, 40);
  },
  closePanel(silent) {
    if (this._onClose) { const f = this._onClose; this._onClose = null; try { f(); } catch (e) { console.error(e); } }
    this.pn.classList.add('hidden'); this.tb.classList.remove('hidden'); this.brush = null; this.brushMask = null; this.cropBox && this.cropBox.destroy();
    if (this.S && this.S.view !== 'result') { this.S.view = 'result'; this.S.ver++; }
    if (this.S) { this.rq(); setTimeout(() => { this.layout(); this.rq(); }, 40); }
  },
  sl(label, min, max, step, get, set, o = {}) { return UI.slider({ label, min, max, step, value: get(), def: o.def, unit: o.unit || '', fmt: o.fmt, onInput: v => set(v) }); },
  tabs(opts, init, render) { const body = h('div', { class: 'tabbody' }); const draw = v => { body.innerHTML = ''; body.append(render(v)); }; const seg = UI.seg(opts, init, draw); draw(init); return h('div', null, seg, body); },

  /* ----- adjust ----- */
  adjustPanel() {
    const G = [['Light', [['exposure', 'Exposure'], ['brightness', 'Brightness'], ['contrast', 'Contrast'], ['highlights', 'Highlights'], ['shadows', 'Shadows']]],
      ['Colour', [['saturation', 'Saturation'], ['vibrance', 'Vibrance'], ['temp', 'Warmth'], ['tint', 'Tint'], ['hue', 'Hue']]],
      ['Detail', [['sharpen', 'Sharpen'], ['fade', 'Fade'], ['vignette', 'Vignette'], ['grain', 'Grain']]]];
    const rng = { hue: [-180, 180], sharpen: [0, 100], fade: [0, 100], grain: [0, 100] };
    this.panel('Adjust', this.tabs(G.map(([n]) => ({ label: n, value: n })), 'Light', name => h('div', null,
      G.find(x => x[0] === name)[1].map(([k, l]) => { const [a, b] = rng[k] || [-100, 100]; return this.sl(l, a, b, 1, () => this.S.adj[k] || 0, v => this.mut(S => { S.adj[k] = v; }, 'adj' + k), { def: 0 }); }),
      h('button', { class: 'btn sm', onclick: () => { this.mut(S => { S.adj = {}; }); this.adjustPanel(); } }, 'Reset all'))));
  },
  /* ----- filters ----- */
  filterPanel() {
    const S = this.S, strip = h('div', { class: 'fstrip' }), src = this.render(160, { noLayers: true }), cur = S.flt ? S.flt.id : 'none';
    FILTERS.forEach((f, i) => {
      const t = h('button', { class: 'ftile' + (f.id === cur ? ' on' : ''), onclick: () => { this.mut(S => { S.flt = f.id === 'none' ? null : { id: f.id, s: (S.flt && S.flt.s) || 1 }; }); $$('.ftile', strip).forEach(x => x.classList.remove('on')); t.classList.add('on'); } }, h('span', null, f.name));
      strip.append(t); setTimeout(() => { try { t.prepend(ColorGL.thumb(src, src.width, src.height, 64, 64, f.id)); } catch (e) { } }, i * 10);
    });
    this.panel('Filters', h('div', null, strip, this.sl('Intensity', 0, 100, 1, () => Math.round(((S.flt && S.flt.s) == null ? 1 : S.flt.s) * 100), v => this.mut(S => { if (S.flt) S.flt.s = v / 100; }, 'fi'), { unit: '%', def: 100 })));
  },
  /* ----- curves ----- */
  curvePanel() {
    const S = this.S; let ch = 'm'; const cur = () => { S.curve = S.curve || { m: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] }; return S.curve; };
    const cv = h('canvas', { class: 'curvecv', width: 260, height: 260 }), colors = { m: '#fff', r: '#ff5a5a', g: '#5aff7a', b: '#5aa0ff' };
    const drawC = () => {
      const x = cv.getContext('2d'); x.clearRect(0, 0, 260, 260); x.strokeStyle = 'rgba(255,255,255,.12)'; for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(i * 65, 0); x.lineTo(i * 65, 260); x.moveTo(0, i * 65); x.lineTo(260, i * 65); x.stroke(); }
      const pts = cur()[ch], f = Curves.monotone(pts); x.strokeStyle = colors[ch]; x.lineWidth = 2; x.beginPath(); for (let i = 0; i <= 100; i++) { const v = i / 100, y = 1 - U.clamp(f(v), 0, 1); i ? x.lineTo(v * 260, y * 260) : x.moveTo(0, y * 260); } x.stroke();
      pts.forEach(p => { x.fillStyle = colors[ch]; x.beginPath(); x.arc(p[0] * 260, (1 - p[1]) * 260, 6, 0, 7); x.fill(); });
    };
    let drag = -1;
    const pos = e => { const r = cv.getBoundingClientRect(); return [U.clamp((e.clientX - r.left) / r.width, 0, 1), U.clamp(1 - (e.clientY - r.top) / r.height, 0, 1)]; };
    cv.onpointerdown = e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); const p = pos(e), pts = cur()[ch]; this.checkpoint(); drag = pts.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < .06); if (drag < 0) { pts.push(p); pts.sort((a, b) => a[0] - b[0]); drag = pts.indexOf(p); } S.ver++; this.rq(); drawC(); };
    cv.onpointermove = e => { if (drag < 0) return; const pts = cur()[ch], p = pos(e); if (drag === 0) p[0] = Math.min(p[0], pts[1][0] - .02); else if (drag === pts.length - 1) p[0] = Math.max(p[0], pts[drag - 1][0] + .02); else p[0] = U.clamp(p[0], pts[drag - 1][0] + .02, pts[drag + 1][0] - .02); pts[drag] = p; S.ver++; this.rq(); drawC(); };
    cv.onpointerup = () => { drag = -1; };
    cv.ondblclick = e => { const p = pos(e), pts = cur()[ch], i = pts.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < .06); if (i > 0 && i < pts.length - 1) { this.checkpoint(); pts.splice(i, 1); S.ver++; this.rq(); drawC(); } };
    drawC();
    this.panel('Curves', h('div', null, UI.chips([['RGB', 'm'], ['Red', 'r'], ['Green', 'g'], ['Blue', 'b']].map(([l, v]) => ({ label: l, value: v })), 'm', v => { ch = v; drawC(); }), cv,
      h('small', { class: 'muted' }, 'Tap to add a point, drag to shape. Double-tap a point to remove it.'),
      h('button', { class: 'btn sm', onclick: () => { this.mut(S => { S.curve = null; }); this.curvePanel(); } }, 'Reset curves')));
  },
  /* ----- blur / border ----- */
  blurPanel() {
    const S = this.S;
    this.panel('Blur & border', h('div', null,
      UI.chips([['none', 'None'], ['gauss', 'Gaussian'], ['radial', 'Focus circle'], ['linear', 'Tilt-shift']].map(([v, l]) => ({ label: l, value: v })), S.blur.type, v => this.mut(S => { S.blur.type = v; })),
      this.sl('Amount', 0, 100, 1, () => S.blur.amt, v => this.mut(S => { S.blur.amt = v; }, 'bla'), { unit: '%', def: 40 }),
      h('div', { class: 'lbl-s' }, 'Border'), this.sl('Width', 0, 20, 1, () => S.border.w, v => this.mut(S => { S.border.w = v; }, 'bw'), { unit: '%', def: 0 }), UI.color(S.border.color, v => this.mut(S => { S.border.color = v; }, 'bc'))));
  },
  /* ----- enhance ----- */
  enhancePanel() {
    const S = this.S;
    const body = h('div', null,
      h('button', { class: 'choose-i', onclick: () => {
        const st = ImgAlgo.autoLevels(this.base()), span = Math.max(40, st.hi - st.lo), contrast = U.clamp((255 / span - 1) * 60, 0, 40), exp = U.clamp((120 - st.mean) / 120 * 30, -20, 28);
        this.mut(S => { S.adj = { ...S.adj, contrast: Math.round(contrast), exposure: Math.round(exp), vibrance: 22, saturation: Math.max(S.adj.saturation || 0, st.sat < 60 ? 12 : 4), sharpen: 22 }; });
        UI.toast(`Auto enhance applied (levels ${st.lo}–${st.hi}). Fine-tune in Adjust.`, 'success', 3500);
      } }, ic('wand', 22), h('div', null, h('b', null, 'Auto enhance'), h('small', null, 'Local: levels, contrast, vibrance, sharpness (non-destructive)'))),
      h('button', { class: 'choose-i', onclick: () => this.aiEnhance() }, ic('ai', 22), h('div', null, h('b', null, 'AI enhance / upscale'), h('small', null, 'Uses your API providers, falls back to local 2× smart upscale'))));
    this.panel('Enhance', body);
  },
  async aiEnhance() {
    const ctrl = new AbortController(); const b = UI.busy('Enhancing…', { cancel: () => ctrl.abort() });
    try {
      const r = await AI.enhance(this.S.src, { signal: ctrl.signal, onStatus: t => b.set(t) });
      this.checkpoint(); this.S.src = r.canvas; if (this.S.mask) { /* mask is resampled to new size */ const m = U.canvas(r.canvas.width, r.canvas.height); m.getContext('2d').drawImage(this.S.mask, 0, 0, m.width, m.height); this.S.mask = m; } this.S.ver++; this.rq();
      UI.toast(`Enhanced via ${r.provider}`, 'success', 3500);
    } catch (e) { if (e.name !== 'AbortError') UI.toast(e.message, 'error', 6000); } finally { b.done(); }
  },

  /* ----- crop ----- */
  cropPanel() {
    const S = this.S, g = S.geo; let ratio = 0;
    const startCrop = { ...g.crop };
    const applyRatio = r => {
      ratio = r; const { RW, RH } = this.frameSize(); if (!r) return; let w = 1, h2 = RW / (r * RH); if (h2 > 1) { h2 = 1; w = (r * RH) / RW; }
      const c = this.cropBox.rect; c.w = w; c.h = h2; c.x = (1 - w) / 2; c.y = (1 - h2) / 2; this.cropBox.refresh();
    };
    this.cropBox = new CropBox(this.host, this.cv, () => this.frameSize(), g.crop, () => ratio, () => { this.rq(); });
    const quarter = d => { this.mut(S => { S.geo.rot = (S.geo.rot + d + 4) % 4; S.geo.crop = { x: 0, y: 0, w: 1, h: 1 }; }); this.cropBox.rect = { x: 0, y: 0, w: 1, h: 1 }; this.cropBox.refresh(); };
    const body = h('div', null,
      UI.chips([['Free', 0], ['1:1', 1], ['4:5', .8], ['3:4', .75], ['4:3', 4 / 3], ['16:9', 16 / 9], ['9:16', 9 / 16]].map(([l, v]) => ({ label: l, value: v })), 0, applyRatio, 'scroll'),
      this.sl('Straighten', -45, 45, .5, () => g.angle, v => this.mut(S => { S.geo.angle = v; }, 'ang'), { unit: '°', def: 0 }),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => quarter(-1) }, '⟲ 90°'), h('button', { class: 'btn sm', onclick: () => quarter(1) }, '⟳ 90°'),
        h('button', { class: 'btn sm', onclick: () => this.mut(S => { S.geo.fx = !S.geo.fx; }) }, 'Flip H'), h('button', { class: 'btn sm', onclick: () => this.mut(S => { S.geo.fy = !S.geo.fy; }) }, 'Flip V'),
        h('button', { class: 'btn sm', onclick: () => { this.mut(S => { S.geo = { rot: 0, fx: false, fy: false, angle: 0, crop: { x: 0, y: 0, w: 1, h: 1 } }; }); this.cropPanel(); } }, 'Reset')));
    this.panel('Crop & rotate', body, () => { if (this.cropBox) { const r = this.cropBox.rect; if (r.w > .02 && r.h > .02) { const same = JSON.stringify(r) === JSON.stringify(startCrop); if (!same) this.mut(S => { S.geo.crop = { x: r.x, y: r.y, w: r.w, h: r.h }; }); } } }, 'crop');
  },

  /* ----- text & stickers ----- */
  addText() {
    this.addLayer({ type: 'text', tf: { x: 0, y: 0, s: 1, r: 0 }, text: { ...Model.textDef(), str: 'Your text', size: .09, stroke: { c: '#000000', w: .06 } } });
    this.textPanel();
  },
  textPanel() {
    const l = this.layer(); if (!l || l.type !== 'text') return;
    const m = (fn, k) => this.mut(() => fn(this.layer().text), k || 'pt');
    const ta = h('textarea', { class: 'inp', rows: 2, value: l.text.str }); ta.addEventListener('input', () => m(t => { t.str = ta.value || ' '; }, 'ptx'));
    const PRE = { Classic: { color: '#ffffff', stroke: { c: '#000000', w: .06 }, shadow: { c: '#000', b: 0, x: 0, y: 0 }, bg: { c: '#000', op: 0, pad: .3, rad: .25 }, font: 'sans', bold: true, upper: false, italic: false }, Neon: { color: '#00f0ff', stroke: { c: '#000', w: 0 }, shadow: { c: '#00f0ff', b: .5, x: 0, y: 0 }, bg: { c: '#000', op: 0, pad: .3, rad: .25 }, font: 'round' }, Box: { color: '#fff', stroke: { c: '#000', w: 0 }, shadow: { c: '#000', b: 0, x: 0, y: 0 }, bg: { c: '#000', op: .72, pad: .4, rad: .35 } }, Poster: { color: '#ffd60a', stroke: { c: '#000', w: .1 }, shadow: { c: '#000', b: .1, x: .04, y: .06 }, font: 'display', upper: true, bold: false }, Elegant: { color: '#fff', stroke: { c: '#000', w: 0 }, shadow: { c: '#000', b: .25, x: 0, y: .05 }, bg: { c: '#000', op: 0, pad: .3, rad: .25 }, font: 'serif', italic: true, bold: false } };
    const body = h('div', null, ta,
      UI.chips(Object.keys(PRE).map(k => ({ label: k, value: k })), null, k => m(t => Object.assign(t, JSON.parse(JSON.stringify(PRE[k]))), 'ppre'), 'scroll'),
      UI.chips(Object.keys(FONTS).map(k => ({ label: FONTS[k].name, value: k })), l.text.font, v => m(t => { t.font = v; }), 'scroll'),
      this.sl('Size', 3, 25, .5, () => this.layer().text.size * 100, v => m(t => { t.size = v / 100; }, 'psz'), { unit: '%' }),
      UI.color(l.text.color, v => m(t => { t.color = v; }, 'pcol')),
      this.sl('Outline', 0, 20, .5, () => this.layer().text.stroke.w * 100, v => m(t => { t.stroke.w = v / 100; }, 'pst'), { unit: '%' }),
      this.sl('Background', 0, 100, 1, () => this.layer().text.bg.op * 100, v => m(t => { t.bg.op = v / 100; }, 'pbg'), { unit: '%' }), UI.color(l.text.bg.c, v => m(t => { t.bg.c = v; if (!t.bg.op) t.bg.op = .7; }, 'pbgc')));
    this.panel('Text', body, () => ta.blur());
  },
  stickerPanel() {
    let cat = 'Faces', color = '#ffd60a'; const grid = h('div', { class: 'emoji-grid' });
    const add = (k, v) => this.addLayer({ type: 'sticker', tf: { x: 0, y: 0, s: 1, r: 0 }, sticker: { kind: k, v, color } });
    const fill = () => { grid.innerHTML = ''; if (cat === 'Shapes') Shapes.list.forEach(s => grid.append(h('button', { class: 'emo', onclick: () => add('shape', s) }, h('canvas', { width: 40, height: 40, 'data-s': s })))); else (EMOJI[cat] || []).forEach(e => grid.append(h('button', { class: 'emo', onclick: () => add('emoji', e) }, e))); $$('canvas', grid).forEach(cv => { const x = cv.getContext('2d'); x.translate(20, 20); x.scale(34, 34); x.fillStyle = color; x.fill(Shapes.get(cv.dataset.s)); }); };
    fill();
    this.panel('Stickers', h('div', null, UI.chips(Object.keys(EMOJI).concat(['Shapes']).map(c => ({ label: c, value: c })), cat, v => { cat = v; fill(); }, 'scroll'), grid, UI.color(color, v => { color = v; if (cat === 'Shapes') fill(); })));
  },

  /* ----- brush tools (draw / retouch / background refine) ----- */
  bindBrush() {
    const cv = this.cv; let down = false, last = null;
    const pt = e => { const r = cv.getBoundingClientRect(), b = this.base(); return { x: (e.clientX - r.left) / r.width * b.width, y: (e.clientY - r.top) / r.height * b.height }; };
    cv.addEventListener('pointerdown', e => { if (!this.brush || this.S.view !== 'base') return; e.preventDefault(); cv.setPointerCapture(e.pointerId); down = true; const p = pt(e); last = p; this.brush.down && this.brush.down(p, e); });
    cv.addEventListener('pointermove', e => { if (!down || !this.brush) return; const p = pt(e); this.brush.move && this.brush.move(p, last, e); last = p; });
    const up = e => { if (!down) return; down = false; this.brush && this.brush.up && this.brush.up(pt(e), e); };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  },
  stroke(ctx, a, b, size, color, soft = .6, erase = false) {
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / (size * .2)));
    for (let i = 0; i <= n; i++) {
      const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n, g = ctx.createRadialGradient(x, y, size * soft * .5, x, y, size / 2);
      g.addColorStop(0, color); g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)').replace(/^#([0-9a-f]{6})$/i, (m, hx) => { const [r, gg, bb] = U.hex2rgb('#' + hx); return `rgba(${r},${gg},${bb},0)`; }));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, size / 2, 0, 7); ctx.fill();
    }
  },
  drawPanel() {
    const S = this.S; let size = 24, color = '#ff3b30', erase = false;
    const ensureInk = () => { if (!S.ink) { S.ink = U.canvas(S.src.width, S.src.height); } };
    this.brush = {
      down: (p) => { this.checkpoint(); S.ink = S.ink ? ImgAlgo.cloneCv(S.ink) : U.canvas(S.src.width, S.src.height); this.brush.move(p, p); },
      move: (p, l) => { ensureInk(); const x = S.ink.getContext('2d'); x.globalCompositeOperation = erase ? 'destination-out' : 'source-over'; this.stroke(x, l || p, p, size * S.src.width / 1000, erase ? 'rgba(0,0,0,1)' : color, .7); S.ver++; this.rq(); },
    };
    this.panel('Draw', h('div', null, UI.seg([{ label: 'Brush', value: false }, { label: 'Eraser', value: true }], false, v => { erase = v; }), this.sl('Size', 4, 120, 1, () => size, v => { size = v; }, { def: 24 }), UI.color(color, v => { color = v; erase = false; }),
      h('small', { class: 'muted' }, 'Drawing is applied to the photo itself (before crop and filters).'), h('button', { class: 'btn sm', onclick: () => { this.mut(S => { S.ink = null; }); } }, 'Clear drawing')), null, 'base');
  },
  retouchPanel() {
    const S = this.S; let mode = 'heal', size = 40, srcPt = null, off = null; const mk = () => this.brushMask || (this.brushMask = U.canvas(S.src.width, S.src.height));
    const run = async (useAI) => {
      if (!this.brushMask) { UI.toast('Paint over the object first', 'error'); return; }
      const ctrl = new AbortController(); const b = UI.busy(useAI ? 'Removing object (AI)…' : 'Filling…', { cancel: () => ctrl.abort() });
      try {
        const r = await AI.removeObject(S.src, this.brushMask, { local: !useAI, signal: ctrl.signal, onStatus: t => b.set(t) });
        this.checkpoint(); S.src = r.canvas; S.ver++; this.brushMask = null; this.rq(); UI.toast(`Done (${r.provider})`, 'success', 3500);
      } catch (e) { if (e.name !== 'AbortError') UI.toast(e.message, 'error', 6000); } finally { b.done(); }
    };
    this.brush = {
      down: (p) => { if (mode === 'clone') { if (!srcPt || this.setSrc) { srcPt = p; this.setSrc = false; UI.toast('Source set. Now paint where you want to copy to.'); this.brush.skip = true; return; } this.brush.skip = false; this.checkpoint(); off = { x: srcPt.x - p.x, y: srcPt.y - p.y }; S.src = ImgAlgo.cloneCv(S.src); this.brush.move(p, p); } else { this.brush.skip = false; if (!this.brushMask) this.brushMask = U.canvas(S.src.width, S.src.height); this.brush.move(p, p); } },
      move: (p, l) => {
        if (this.brush.skip) return;
        const sz = size * S.src.width / 1000;
        if (mode === 'clone') { this.cloneDab(S.src, p, off, sz); } else { this.stroke(mk().getContext('2d'), l || p, p, sz, 'rgba(255,40,80,1)', .9); }
        S.ver++; this.rq();
      },
      up: async () => { if (mode === 'heal' && this.brushMask) await run(false); },
    };
    const body = h('div', null,
      UI.chips([['Heal (auto)', 'heal'], ['Erase object (AI)', 'erase'], ['Clone stamp', 'clone']].map(([l, v]) => ({ label: l, value: v })), mode, v => { mode = v; this.brushMask = null; srcPt = null; if (v === 'clone') UI.toast('Tap once to set the source point'); this.rq(); }, 'scroll'),
      this.sl('Brush size', 5, 120, 1, () => size, v => { size = v; }, { def: 40 }),
      h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onclick: () => run(true) }, 'Remove with AI'), h('button', { class: 'btn sm', onclick: () => run(false) }, 'Remove locally'), h('button', { class: 'btn sm', onclick: () => { this.brushMask = null; this.rq(); } }, 'Clear mask'), h('button', { class: 'btn sm', onclick: () => { this.setSrc = true; } }, 'New source')),
      h('small', { class: 'muted' }, 'Heal: paint over a blemish and release to fill automatically. Erase object: paint over it, then Remove (AI uses your provider, falls back to the local quick fill). Local fill works best on small objects.'));
    this.panel('Retouch', body, () => { this.brushMask = null; }, 'base');
  },
  cloneDab(dst, p, off, size) {
    const x = dst.getContext('2d'), t = U.canvas(size, size), tx = t.getContext('2d');
    const sx = p.x + off.x, sy = p.y + off.y; tx.drawImage(dst, sx - size / 2, sy - size / 2, size, size, 0, 0, size, size);
    tx.globalCompositeOperation = 'destination-in'; const g = tx.createRadialGradient(size / 2, size / 2, size * .2, size / 2, size / 2, size / 2); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); tx.fillStyle = g; tx.fillRect(0, 0, size, size);
    x.drawImage(t, p.x - size / 2, p.y - size / 2);
  },

  /* ----- background ----- */
  bgPanel() {
    const S = this.S; let tol = 28, wand = false, refine = null, size = 40;
    const setMask = (m, label) => { this.checkpoint(); S.mask = m; if (!S.bg) S.bg = { type: 'transparent' }; S.ver++; this.rq(); this.bgPanel(); if (label) UI.toast(label, 'success', 3500); };
    const aiRemove = async () => {
      const ctrl = new AbortController(); const b = UI.busy('Removing background…', { cancel: () => ctrl.abort() });
      try {
        const r = await AI.removeBg(S.src, { signal: ctrl.signal, onStatus: t => b.set(t) });
        // convert RGBA result into an alpha mask
        const m = U.canvas(S.src.width, S.src.height), mx = m.getContext('2d'); mx.drawImage(r.canvas, 0, 0, m.width, m.height);
        setMask(m, `Background removed (${r.provider})`);
      } catch (e) { if (e.name !== 'AbortError') UI.toast(e.message, 'error', 6500); } finally { b.done(); }
    };
    const body = h('div', null);
    if (!S.mask) {
      body.append(
        h('button', { class: 'choose-i', onclick: aiRemove }, ic('ai', 22), h('div', null, h('b', null, 'Remove background (AI)'), h('small', null, 'remove.bg / Photoroom / Clipdrop / custom — with automatic fallback'))),
        h('div', { class: 'lbl-s' }, 'Local (no internet) — best for plain backgrounds'),
        this.sl('Tolerance', 3, 80, 1, () => tol, v => { tol = v; }, { def: 28 }),
        h('button', { class: 'btn', onclick: () => { const b = UI.busy('Analysing…'); setTimeout(() => { try { const r = ImgAlgo.autoBg(S.src, tol); if (r.removed < .02) UI.toast('Could not find a plain background. Try a higher tolerance or use AI.', 'error', 4500); else setMask(r.mask, `Removed ${Math.round(r.removed * 100)}% of the image as background (local approximation)`); } catch (e) { UI.toast(e.message, 'error'); } b.done(); }, 30); } }, 'Auto remove (local)'));
    } else {
      const bgType = S.bg ? S.bg.type : 'transparent';
      const sub = h('div');
      const drawSub = t => {
        sub.innerHTML = '';
        if (t === 'color') sub.append(UI.color(S.bg.color || '#ffffff', v => this.mut(S => { S.bg = { ...S.bg, type: 'color', color: v }; }, 'bgc')));
        else if (t === 'gradient') sub.append(UI.color(S.bg.color || '#ff3b6b', v => this.mut(S => { S.bg = { ...S.bg, type: 'gradient', color: v }; }, 'bg1')), UI.color(S.bg.color2 || '#5e5ce6', v => this.mut(S => { S.bg = { ...S.bg, type: 'gradient', color2: v }; }, 'bg2')));
        else if (t === 'blur') sub.append(this.sl('Blur', 2, 100, 1, () => S.bg.blur || 30, v => this.mut(S => { S.bg = { ...S.bg, type: 'blur', blur: v }; }, 'bgb'), { def: 30 }));
        else if (t === 'image') sub.append(h('button', { class: 'btn', onclick: async () => { const f = (await Files.pick({ accept: 'image/*' }))[0]; if (!f) return; const c = await U.blobToCanvas(f, 2048); this.checkpoint(); S.bg = { type: 'image', img: c }; S.ver++; this.rq(); } }, 'Choose background photo…'));
      };
      body.append(
        h('div', { class: 'lbl-s' }, 'Background'),
        UI.chips([['transparent', 'Transparent'], ['color', 'Colour'], ['gradient', 'Gradient'], ['image', 'Photo'], ['blur', 'Blur']].map(([v, l]) => ({ label: l, value: v })), bgType, v => {
          this.mut(S => { const o = S.bg || {}; S.bg = v === 'transparent' ? { type: 'transparent' } : v === 'color' ? { type: 'color', color: o.color || '#ffffff' } : v === 'gradient' ? { type: 'gradient', color: o.color || '#ff3b6b', color2: o.color2 || '#5e5ce6' } : v === 'blur' ? { type: 'blur', blur: o.blur || 30 } : { type: 'image', img: o.img }; });
          drawSub(v); if (v === 'image' && !(S.bg && S.bg.img)) sub.querySelector('button') && sub.querySelector('button').click();
        }, 'scroll'), sub,
        h('div', { class: 'lbl-s' }, 'Refine edges'),
        UI.chips([['Erase more', 'e'], ['Restore', 'r'], ['Magic wand', 'w']].map(([l, v]) => ({ label: l, value: v })), null, v => {
          refine = v; if (v === 'w') { wand = true; this.brush = { down: p => { this.checkpoint(); S.mask = ImgAlgo.wand(S.src, S.mask, p.x, p.y, tol); S.ver++; this.rq(); } }; this.S.view = 'base'; this.S.ver++; this.rq(); return; }
          this.S.view = 'base'; this.S.ver++;
          const mk = (p, l) => { const x = S.mask.getContext('2d'); x.globalCompositeOperation = refine === 'e' ? 'destination-out' : 'source-over'; this.stroke(x, l || p, p, size * S.src.width / 1000, refine === 'e' ? 'rgba(0,0,0,1)' : 'rgba(255,255,255,1)', .6); S.ver++; this.rq(); };
          this.brush = { down: p => { this.checkpoint(); S.mask = ImgAlgo.cloneCv(S.mask); mk(p); }, move: mk };
          this.rq();
        }, 'scroll'),
        this.sl('Brush size', 5, 120, 1, () => size, v => { size = v; }, { def: 40 }), this.sl('Wand tolerance', 3, 80, 1, () => tol, v => { tol = v; }, { def: 28 }),
        h('button', { class: 'btn sm', onclick: () => { this.checkpoint(); S.mask = null; S.bg = null; S.ver++; this.rq(); this.bgPanel(); } }, 'Undo removal (restore original)'));
      drawSub(bgType);
    }
    this.panel('Background', body, null, S.mask ? 'result' : 'result');
    this.cv.classList.toggle('checker', !!S.mask);
  },

  /* ---------------- export ---------------- */
  exportDlg() {
    const S = this.S; if (!S) return;
    const s = Object.assign({ fmt: 'png', q: 92, size: 0, fill: '#ffffff' }, Settings.get('pexp', {}));
    const out = this.render(4096, { noLayers: true }); // size reference
    const est = h('div', { class: 'muted' });
    const upd = () => { Settings.set('pexp', s); const k = s.size ? Math.min(1, s.size / Math.max(out.width, out.height)) : 1; est.textContent = `${Math.round(out.width * k)}×${Math.round(out.height * k)} px` + (s.fmt === 'png' ? ' • keeps transparency' : ''); };
    upd();
    const body = h('div', null, h('div', { class: 'lbl-s' }, 'Format'), UI.chips([['png', 'PNG (transparent)'], ['jpeg', 'JPEG'], ['webp', 'WebP']].map(([v, l]) => ({ label: l, value: v })), s.fmt, v => { s.fmt = v; upd(); }, 'scroll'),
      this.sl('Quality', 40, 100, 1, () => s.q, v => { s.q = v; Settings.set('pexp', s); }, { unit: '%' }),
      h('div', { class: 'lbl-s' }, 'Size'), UI.chips([[0, 'Full'], [2048, '2048'], [1080, '1080'], [720, '720']].map(([v, l]) => ({ label: l, value: v })), s.size, v => { s.size = v; upd(); }),
      h('div', { class: 'lbl-s' }, 'Fill for JPEG (replaces transparency)'), UI.color(s.fill, v => { s.fill = v; Settings.set('pexp', s); }), est);
    UI.modal({ title: 'Export photo', body, wide: true, actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: () => { this.doExport(s); } }] });
  },
  async doExport(s) {
    const b = UI.busy('Rendering…');
    try {
      let c = this.render(s.size || 4096); if (s.fmt === 'jpeg') { const f = U.canvas(c.width, c.height), x = f.getContext('2d'); x.fillStyle = s.fill; x.fillRect(0, 0, f.width, f.height); x.drawImage(c, 0, 0); c = f; }
      const mime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[s.fmt];
      const blob = await U.canvasToBlob(c, mime, s.q / 100);
      const ext = s.fmt === 'jpeg' ? 'jpg' : s.fmt, name = `${this.S.name}-kedit-${Date.now().toString(36)}.${ext}`;
      const res = await Files.saveBlob(blob, name);
      const th = U.canvas(240, 240 * c.height / c.width); th.getContext('2d').drawImage(c, 0, 0, th.width, th.height);
      Projects.addPhoto({ name: this.S.name, thumb: th.toDataURL('image/jpeg', .7), blob: blob.size < 40e6 ? blob : null });
      b.done();
      const url = URL.createObjectURL(blob);
      UI.modal({ title: 'Saved ✓', body: h('div', null, h('img', { src: url, class: 'exp-prev checker' }), h('p', null, h('b', null, name), h('br'), `${U.size(blob.size)} • ${res.where}`)), actions: res.uri ? [{ label: 'Share', kind: 'primary', keep: true, onClick: () => { Files.share(res, name); return false; } }, { label: 'Close' }] : [{ label: 'Close' }], onClose: () => setTimeout(() => URL.revokeObjectURL(url), 60000) });
    } catch (e) { UI.toast('Export failed: ' + e.message, 'error', 5000); } finally { b.done(); }
  },
};

/* ---------- interactive crop rectangle ---------- */
class CropBox {
  constructor(host, canvas, frame, rect, ratio, onChange) {
    this.host = host; this.cv = canvas; this.frame = frame; this.rect = { ...rect }; this.ratio = ratio; this.onChange = onChange;
    this.el = h('div', { class: 'cropbox' }, h('i', { class: 'cg v1' }), h('i', { class: 'cg v2' }), h('i', { class: 'cg h1' }), h('i', { class: 'cg h2' }),
      ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'].map(k => h('div', { class: 'ch ' + k, 'data-k': k })));
    host.append(this.el);
    this.el.addEventListener('pointerdown', e => this.down(e)); this.mv = e => this.move(e); this.upf = () => { this.drag = null; };
    window.addEventListener('pointermove', this.mv); window.addEventListener('pointerup', this.upf);
    Photo.cropActive = this;
  }
  metrics() { const r = this.cv.getBoundingClientRect(), hr = this.host.getBoundingClientRect(); return { w: r.width, h: r.height, ox: r.left - hr.left, oy: r.top - hr.top }; }
  refresh() { const m = this.metrics(), r = this.rect; Object.assign(this.el.style, { left: m.ox + r.x * m.w + 'px', top: m.oy + r.y * m.h + 'px', width: r.w * m.w + 'px', height: r.h * m.h + 'px' }); }
  down(e) { e.preventDefault(); const k = e.target.dataset.k || 'move'; this.drag = { k, x: e.clientX, y: e.clientY, r: { ...this.rect } }; }
  move(e) {
    const d = this.drag; if (!d) return; const m = this.metrics(), dx = (e.clientX - d.x) / m.w, dy = (e.clientY - d.y) / m.h, r = { ...d.r }, MIN = .06;
    if (d.k === 'move') { r.x = U.clamp(d.r.x + dx, 0, 1 - r.w); r.y = U.clamp(d.r.y + dy, 0, 1 - r.h); }
    else {
      let x0 = d.r.x, y0 = d.r.y, x1 = d.r.x + d.r.w, y1 = d.r.y + d.r.h; const k = d.k;
      if (k.includes('l')) x0 = U.clamp(x0 + dx, 0, x1 - MIN); if (k.includes('r')) x1 = U.clamp(x1 + dx, x0 + MIN, 1);
      if (k.includes('t')) y0 = U.clamp(y0 + dy, 0, y1 - MIN); if (k.includes('b')) y1 = U.clamp(y1 + dy, y0 + MIN, 1);
      const ra = this.ratio();
      if (ra) { const { RW, RH } = this.frame(); let w = x1 - x0, hh = w * RW / (ra * RH); if (k.includes('t') && !k.includes('b')) { y0 = y1 - hh; if (y0 < 0) { y0 = 0; hh = y1; w = hh * ra * RH / RW; if (k.includes('l')) x0 = x1 - w; else x1 = x0 + w; } } else { y1 = y0 + hh; if (y1 > 1) { y1 = 1; hh = y1 - y0; w = hh * ra * RH / RW; if (k.includes('l')) x0 = x1 - w; else x1 = x0 + w; } } }
      r.x = x0; r.y = y0; r.w = x1 - x0; r.h = y1 - y0;
    }
    this.rect = r; this.refresh(); this.onChange && this.onChange();
  }
  destroy() { this.el.remove(); window.removeEventListener('pointermove', this.mv); window.removeEventListener('pointerup', this.upf); Photo.cropBox = null; }
}
window.Photo = Photo; window.ImgAlgo = ImgAlgo; window.CropBox = CropBox;
