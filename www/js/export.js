'use strict';
/* K-EDIT STUDIO - export engine.
   Video: the exact same compositor as the preview renders to an offscreen canvas while the realtime audio graph is captured
   (canvas.captureStream + MediaStreamDestination -> MediaRecorder). MP4 (H.264/AAC) when the WebView supports it, otherwise WebM.
   GIF: deterministic frame-stepping + built-in GIF encoder. WAV: offline audio mixdown. PNG: still frame. */

/* ---------- GIF encoder ---------- */
const GIF = {
  quantize(rgba, w, h) {
    const hist = new Uint32Array(32768), n = w * h;
    for (let i = 0; i < n; i++) { const o = i * 4; hist[((rgba[o] >> 3) << 10) | ((rgba[o + 1] >> 3) << 5) | (rgba[o + 2] >> 3)]++; }
    const cols = []; for (let i = 0; i < 32768; i++) if (hist[i]) cols.push(i);
    const R = i => (i >> 10) & 31, G = i => (i >> 5) & 31, B = i => i & 31;
    let boxes = [cols];
    while (boxes.length < 256) {
      let bi = -1, bs = 0;
      boxes.forEach((b, k) => { if (b.length > 1) { const s = b.reduce((a, c) => a + hist[c], 0); if (s > bs) { bs = s; bi = k; } } });
      if (bi < 0) break;
      const b = boxes[bi]; let rmin = 31, rmax = 0, gmin = 31, gmax = 0, bmin = 31, bmax = 0;
      b.forEach(c => { rmin = Math.min(rmin, R(c)); rmax = Math.max(rmax, R(c)); gmin = Math.min(gmin, G(c)); gmax = Math.max(gmax, G(c)); bmin = Math.min(bmin, B(c)); bmax = Math.max(bmax, B(c)); });
      const rr = rmax - rmin, gg = gmax - gmin, bb = bmax - bmin;
      const f = rr >= gg && rr >= bb ? R : gg >= bb ? G : B;
      b.sort((a, c) => f(a) - f(c));
      let tot = b.reduce((a, c) => a + hist[c], 0), acc = 0, cut = 1;
      for (let i = 0; i < b.length - 1; i++) { acc += hist[b[i]]; if (acc >= tot / 2) { cut = i + 1; break; } cut = i + 1; }
      boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
    }
    const pal = new Uint8Array(256 * 3), lut = new Uint8Array(32768);
    boxes.forEach((b, k) => {
      let r = 0, g = 0, bl = 0, t = 0; b.forEach(c => { const w2 = hist[c]; r += R(c) * w2; g += G(c) * w2; bl += B(c) * w2; t += w2; lut[c] = k; });
      pal[k * 3] = Math.min(255, Math.round(r / t * 8 + 4)); pal[k * 3 + 1] = Math.min(255, Math.round(g / t * 8 + 4)); pal[k * 3 + 2] = Math.min(255, Math.round(bl / t * 8 + 4));
    });
    const idx = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const o = i * 4; idx[i] = lut[((rgba[o] >> 3) << 10) | ((rgba[o + 1] >> 3) << 5) | (rgba[o + 2] >> 3)]; }
    return { pal, idx };
  },
  lzw(idx) {
    const out = []; let cur = 0, nbits = 0, buf = [];
    const write = (code, size) => { cur |= code << nbits; nbits += size; while (nbits >= 8) { buf.push(cur & 255); cur >>= 8; nbits -= 8; if (buf.length === 255) { out.push(255, ...buf); buf = []; } } };
    let size = 9, next = 258, dict = new Map(); const CLEAR = 256, END = 257;
    write(CLEAR, size);
    let prefix = idx[0];
    for (let i = 1; i < idx.length; i++) {
      const c = idx[i], key = (prefix << 8) | c, v = dict.get(key);
      if (v !== undefined) prefix = v;
      else {
        write(prefix, size);
        if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
        else { write(CLEAR, size); dict = new Map(); next = 258; size = 9; }
        prefix = c;
      }
    }
    write(prefix, size); write(END, size);
    if (nbits > 0) buf.push(cur & 255);
    if (buf.length) out.push(buf.length, ...buf);
    out.push(0);
    return new Uint8Array(out);
  },
  Encoder: class {
    constructor(w, h, fps) { this.w = w; this.h = h; this.delay = Math.max(2, Math.round(100 / fps)); this.parts = []; this.n = 0; }
    add(rgba) {
      const { w, h } = this, { pal, idx } = GIF.quantize(rgba, w, h), parts = this.parts;
      if (!this.n) {
        parts.push(new Uint8Array([71, 73, 70, 56, 57, 97, w & 255, w >> 8, h & 255, h >> 8, 0, 0, 0]));
        parts.push(new Uint8Array([0x21, 0xff, 0x0b, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 3, 1, 0, 0, 0]));
      }
      parts.push(new Uint8Array([0x21, 0xf9, 4, 0, this.delay & 255, this.delay >> 8, 0, 0]));
      parts.push(new Uint8Array([0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0x87]));
      parts.push(pal); parts.push(new Uint8Array([8])); parts.push(GIF.lzw(idx)); this.n++;
    }
    blob() { this.parts.push(new Uint8Array([0x3b])); return new Blob(this.parts, { type: 'image/gif' }); }
  },
};

const Export = {
  cancelled: false,
  mimes() {
    const ok = m => window.MediaRecorder && MediaRecorder.isTypeSupported(m);
    return {
      mp4: ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4d0028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'].find(ok) || null,
      webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(ok) || null,
    };
  },
  open() {
    const p = Store.project;
    if (!p.items.length) { UI.toast('Nothing to export yet. Add a clip first.', 'error'); return; }
    const M = this.mimes();
    const s = Object.assign({ fmt: M.mp4 ? 'mp4' : 'webm', res: U.isLowEnd() ? 720 : 1080, fps: p.fps || 30, q: 'med' }, Settings.get('exp', {}));
    if (s.fmt === 'mp4' && !M.mp4) s.fmt = 'webm';
    const est = h('div', { class: 'muted est' });
    const upd = () => { Settings.set('exp', s); const d = this.estimate(p, s); est.textContent = s.fmt === 'png' ? 'Single frame at the playhead' : s.fmt === 'wav' ? `≈ ${U.size(p.duration * 44100 * 4)} (stereo WAV)` : `${d.w}×${d.h} • ≈ ${U.size(d.bytes)} • ${U.fmt(p.duration)} (exports in real time)`; };
    const fmts = [{ label: 'MP4', value: 'mp4', title: M.mp4 ? '' : 'Not supported by this WebView' }, { label: 'WebM', value: 'webm' }, { label: 'GIF', value: 'gif' }, { label: 'Audio WAV', value: 'wav' }, { label: 'PNG frame', value: 'png' }].filter(f => f.value !== 'mp4' || M.mp4).filter(f => f.value !== 'webm' || M.webm);
    const body = h('div', null,
      h('div', { class: 'lbl-s' }, 'Format'), UI.chips(fmts, s.fmt, v => { s.fmt = v; upd(); }, 'scroll'),
      h('div', { class: 'lbl-s' }, 'Resolution'), UI.chips([[480, '480p'], [720, '720p'], [1080, '1080p'], [1440, '2K'], [2160, '4K']].map(([v, l]) => ({ label: l, value: v })), s.res, v => { s.res = v; upd(); }, 'scroll'),
      h('div', { class: 'lbl-s' }, 'Frame rate'), UI.chips([24, 30, 60].map(v => ({ label: v + ' fps', value: v })), s.fps, v => { s.fps = v; upd(); }),
      h('div', { class: 'lbl-s' }, 'Quality'), UI.chips([['low', 'Small file'], ['med', 'Balanced'], ['high', 'Best']].map(([v, l]) => ({ label: l, value: v })), s.q, v => { s.q = v; upd(); }),
      est,
      h('small', { class: 'muted' }, 'Keep the app open and the screen on while exporting. GIF is limited to 15 fps / 480 px; 4K needs a powerful device.'));
    upd();
    UI.modal({ title: 'Export', body, wide: true, actions: [{ label: 'Cancel' }, { label: 'Export', kind: 'primary', onClick: () => { this.run(s); } }] });
  },
  estimate(p, s) {
    const d = Model.dims(p, s.res), br = this.bitrate(d.w, d.h, s.fps, s.q);
    if (s.fmt === 'gif') { const g = Model.dims(p, Math.min(s.res, 480)); return { w: g.w, h: g.h, bytes: g.w * g.h * Math.min(15, s.fps) * p.duration * .12 }; }
    return { w: d.w, h: d.h, bytes: (br + 128000) * p.duration / 8 };
  },
  bitrate(w, h, fps, q) { const bpp = { low: .045, med: .08, high: .13 }[q] || .08; return U.clamp(w * h * fps * bpp, 1.2e6, 45e6); },

  async run(s) {
    const p = Store.project; this.cancelled = false;
    Engine.pause();
    const prevT = Engine.t; let wake = null;
    try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch (e) { }
    const b = UI.busy('Preparing export…', { cancel: () => { this.cancelled = true; Engine.pause(); } });
    const t0 = performance.now();
    try {
      let blob, name = (p.name || 'K-Edit').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'K-Edit', ext;
      if (s.fmt === 'png') { blob = await this.still(s); ext = 'png'; }
      else if (s.fmt === 'wav') { blob = await this.wav(b); ext = 'wav'; }
      else if (s.fmt === 'gif') { blob = await this.gif(s, b); ext = 'gif'; }
      else { const r = await this.video(s, b); blob = r.blob; ext = r.ext; }
      if (this.cancelled || !blob) { UI.toast('Export cancelled'); return; }
      b.set('Saving file…');
      const file = `${name}-${s.fmt === 'png' || s.fmt === 'wav' ? '' : s.res + 'p-'}${Date.now().toString(36)}.${ext}`;
      const res = await Files.saveBlob(blob, file);
      b.done(); this.done(blob, file, res, (performance.now() - t0) / 1000, ext);
    } catch (e) { console.error(e); UI.toast('Export failed: ' + (e.message || e), 'error', 6000); }
    finally { b.done(); Engine.exporting = false; Engine.onFrame = null; Engine.setMonitor(true); if (wake) wake.release().catch(() => { }); Engine.seek(prevT); }
  },
  done(blob, file, res, secs, ext) {
    const url = URL.createObjectURL(blob);
    const preview = ext === 'png' || ext === 'gif' ? h('img', { src: url, class: 'exp-prev' }) : ext === 'wav' ? h('audio', { src: url, controls: true, class: 'exp-prev' }) : h('video', { src: url, controls: true, playsinline: true, class: 'exp-prev' });
    const body = h('div', null, preview, h('p', null, h('b', null, file), h('br'), U.size(blob.size) + ' • saved to ' + res.where + ' • took ' + secs.toFixed(0) + 's'),
      ext === 'webm' ? h('small', { class: 'muted' }, 'WebM files play in Chrome, VLC, WhatsApp and most Android players. For MP4 use a device whose WebView supports H.264 recording.') : null);
    const actions = [{ label: 'Close' }];
    if (res.uri) actions.unshift({ label: 'Share', kind: 'primary', keep: true, onClick: () => { Files.share(res, file); return false; } });
    UI.modal({ title: 'Export complete ✓', body, actions, onClose: () => setTimeout(() => URL.revokeObjectURL(url), 120000) });
  },

  async still(s) {
    const d = Model.dims(Store.project, s.res), c = U.canvas(d.w, d.h);
    Engine.exporting = true; Engine.sync(Engine.t, false); await Engine.settle();
    Engine.drawProject(c.getContext('2d'), d.w, d.h, Engine.t, { hq: true });
    return U.canvasToBlob(c, 'image/png');
  },
  async wav(b) {
    const p = Store.project;
    const r = await AudioUtil.mixdown(p, { sr: 44100, onProgress: v => b.set('Mixing audio…', v) });
    b.set('Encoding WAV…', .9);
    return AudioUtil.wavBlob(r.channels, r.sr);
  },
  async gif(s, b) {
    const p = Store.project, fps = Math.min(15, s.fps), d = Model.dims(p, Math.min(s.res, 480));
    const c = U.canvas(d.w, d.h), x = c.getContext('2d', { willReadFrequently: true }), enc = new GIF.Encoder(d.w, d.h, fps);
    const n = Math.max(1, Math.floor(p.duration * fps));
    if (n > 600) throw new Error('GIF is limited to 40 s at 15 fps. Trim the project first.');
    Engine.exporting = true;
    for (let i = 0; i < n; i++) {
      if (this.cancelled) return null;
      const t = Math.min(p.duration - .001, i / fps);
      Engine.t = t; Engine.sync(t, false, true); await Engine.settle(2500);
      Engine.drawProject(x, d.w, d.h, t, {});
      enc.add(x.getImageData(0, 0, d.w, d.h).data);
      b.set(`Rendering GIF frame ${i + 1}/${n}`, (i + 1) / n);
      if (i % 3 === 0) await U.sleep(0);
    }
    return enc.blob();
  },
  async video(s, b) {
    const p = Store.project, M = this.mimes();
    const mime = s.fmt === 'mp4' ? M.mp4 : M.webm; if (!mime) throw new Error('This device cannot record ' + s.fmt.toUpperCase() + ' video');
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    const d = Model.dims(p, s.res), c = U.canvas(d.w, d.h), x = c.getContext('2d', { alpha: false });
    Engine.exporting = true; Engine.audioInit(); Engine.setMonitor(false);
    Engine.t = 0; Engine.sync(0, false, true); await Engine.settle(3000);
    Engine.drawProject(x, d.w, d.h, 0, { hq: true });
    const stream = c.captureStream(s.fps);
    const at = Engine.exportDest && Engine.exportDest.stream.getAudioTracks()[0]; if (at) stream.addTrack(at);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: this.bitrate(d.w, d.h, s.fps, s.q), audioBitsPerSecond: 160000 });
    const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res, rej) => { rec.onstop = res; rec.onerror = e => rej(e.error || new Error('Recorder error')); });
    const t0 = performance.now(), dur = p.duration;
    Engine.onFrame = t => {
      Engine.drawProject(x, d.w, d.h, t, { hq: true });
      const pr = t / dur, el = (performance.now() - t0) / 1000, eta = pr > .02 ? el / pr - el : 0;
      b.set(`Exporting ${Math.round(pr * 100)}%${eta ? ' • ~' + Math.ceil(eta) + 's left' : ''}`, pr);
    };
    const ended = new Promise(res => { const off = Bus.on('ended', () => { off(); res(); }); const off2 = Bus.on('pause', () => { if (this.cancelled) { off2(); res(); } }); });
    rec.start(500);
    Engine.seek(0); Engine.play();
    await ended;
    await U.sleep(350);
    Engine.drawProject(x, d.w, d.h, dur, { hq: true });
    if (rec.state !== 'inactive') rec.stop();
    await stopped;
    if (this.cancelled) return { blob: null, ext };
    return { blob: new Blob(chunks, { type: mime.split(';')[0] }), ext };
  },
};
window.Export = Export; window.GIF = GIF;
