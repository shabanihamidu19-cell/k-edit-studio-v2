'use strict';
/* K-EDIT STUDIO - media library, audio utilities (decode/peaks/beats/WAV/mix/synth) and frame-cache reverser */

const Library = {
  m: new Map(),
  get(id) { return this.m.get(id) || null; },
  kindOf(file) {
    const t = (file.type || '').toLowerCase(), n = (file.name || '').toLowerCase();
    if (t.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|3gp|avi)$/.test(n)) return 'video';
    if (t.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|avif)$/.test(n)) return 'image';
    if (t.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|amr)$/.test(n)) return 'audio';
    return null;
  },
  async add(file, { persist = true, kind } = {}) {
    kind = kind || this.kindOf(file);
    if (!kind) throw new Error('Unsupported file type: ' + (file.name || file.type));
    const id = U.uid('m');
    const url = URL.createObjectURL(file);
    const media = { id, kind, name: file.name || (kind + '-' + id), size: file.size, type: file.type, url, file, dur: 0, w: 0, h: 0, thumbs: [], peaks: null };
    try {
      if (kind === 'video') await this.probeVideo(media);
      else if (kind === 'image') await this.probeImage(media);
      else await this.probeAudio(media);
    } catch (e) { URL.revokeObjectURL(url); throw e; }
    this.m.set(id, media);
    if (persist) this.persist(media).catch(e => console.warn('persist failed', e));
    if (kind === 'video') this.makeThumbs(media).catch(e => console.warn('thumbs', e));
    if (kind === 'audio' || kind === 'video') this.makePeaks(media).catch(e => console.warn('peaks', e));
    return media;
  },
  meta(m) { return { id: m.id, kind: m.kind, name: m.name, size: m.size, type: m.type, dur: m.dur, w: m.w, h: m.h }; },
  async persist(m) {
    const max = Settings.get('maxStoreMB', 80) * 1048576;
    await DB.put('media', { ...this.meta(m), blob: m.size <= max ? m.file : null });
  },
  /* re-create library entries for a saved project; returns list of missing media metas */
  async restore(project) {
    const missing = [];
    for (const id in project.media) {
      if (this.m.has(id)) continue;
      const meta = project.media[id];
      let rec = null; try { rec = await DB.get('media', id); } catch (e) { }
      if (rec && rec.blob) {
        const url = URL.createObjectURL(rec.blob);
        const media = { ...meta, url, file: rec.blob, thumbs: [], peaks: null };
        this.m.set(id, media);
        if (media.kind === 'image') { try { await this.probeImage(media); } catch (e) { } }
        if (media.kind === 'video') this.makeThumbs(media).catch(() => { });
        if (media.kind !== 'image') this.makePeaks(media).catch(() => { });
      } else missing.push(meta);
    }
    return missing;
  },
  async relink(meta, file) {
    const url = URL.createObjectURL(file);
    const media = { ...meta, url, file, thumbs: [], peaks: null, size: file.size };
    if (media.kind === 'image') await this.probeImage(media);
    this.m.set(meta.id, media);
    if (media.kind === 'video') this.makeThumbs(media).catch(() => { });
    if (media.kind !== 'image') this.makePeaks(media).catch(() => { });
    return media;
  },
  probeVideo(media) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.playsInline = true;
      const to = setTimeout(() => { reject(new Error('Could not read video (format/codec not supported by this device WebView)')); v.src = ''; }, 20000);
      v.onerror = () => { clearTimeout(to); reject(new Error('Video format/codec is not supported by this device. Try an H.264 MP4.')); };
      v.onloadedmetadata = async () => {
        if (!isFinite(v.duration)) {
          await new Promise(res => { v.ontimeupdate = () => { v.ontimeupdate = null; res(); }; v.currentTime = 1e7; setTimeout(res, 3000); });
        }
        clearTimeout(to);
        media.dur = isFinite(v.duration) ? v.duration : 0; media.w = v.videoWidth; media.h = v.videoHeight;
        if (!media.dur) return reject(new Error('Video has no readable duration'));
        v.src = ''; resolve();
      };
      v.src = media.url;
    });
  },
  async probeImage(media) {
    const maxDim = U.isLowEnd() ? 1600 : 2560;
    const bmp = await createImageBitmap(media.file);
    media.w = bmp.width; media.h = bmp.height;
    const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    if (k < 1) { const c = U.canvas(bmp.width * k, bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); media.img = c; bmp.close && bmp.close(); }
    else media.img = bmp;
    media.thumbs = [{ t: 0, url: this.smallThumb(media.img, 96) }];
  },
  probeAudio(media) {
    return new Promise((resolve, reject) => {
      const a = new Audio(); a.preload = 'metadata';
      const to = setTimeout(() => reject(new Error('Could not read audio file')), 15000);
      a.onerror = () => { clearTimeout(to); reject(new Error('Audio format not supported by this device')); };
      a.onloadedmetadata = async () => {
        if (!isFinite(a.duration)) await new Promise(res => { a.ontimeupdate = () => { a.ontimeupdate = null; res(); }; a.currentTime = 1e7; setTimeout(res, 3000); });
        clearTimeout(to); media.dur = isFinite(a.duration) ? a.duration : 0;
        if (!media.dur) return reject(new Error('Audio has no readable duration'));
        resolve();
      };
      a.src = media.url;
    });
  },
  smallThumb(src, h = 64) {
    const w = Math.round(h * (src.width / src.height || 1.78));
    const c = U.canvas(w, h); c.getContext('2d').drawImage(src, 0, 0, w, h); return c.toDataURL('image/jpeg', .6);
  },
  async makeThumbs(media) {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = media.url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; setTimeout(res, 8000); });
    const n = U.clamp(Math.round(media.dur / 2), 6, 24), h = 72;
    const w = Math.round(h * (media.w / media.h || 1.78));
    const c = U.canvas(w, h), x = c.getContext('2d');
    for (let i = 0; i < n; i++) {
      const t = Math.min(media.dur - 0.05, (i + .5) / n * media.dur);
      await new Promise(res => { const to = setTimeout(res, 2500); v.onseeked = () => { clearTimeout(to); res(); }; v.currentTime = t; });
      try { x.drawImage(v, 0, 0, w, h); media.thumbs.push({ t, url: c.toDataURL('image/jpeg', .55) }); } catch (e) { break; }
      if (i === 0 || i % 4 === 3 || i === n - 1) Bus.emit('media:thumbs', media.id);
    }
    v.src = '';
  },
  thumbAt(media, t) {
    const th = media && media.thumbs; if (!th || !th.length) return null;
    let best = th[0], d = Infinity;
    for (const q of th) { const dd = Math.abs(q.t - t); if (dd < d) { d = dd; best = q; } }
    return best.url;
  },
  async makePeaks(media) {
    if (media.size > 150 * 1048576) return;
    const pk = await AudioUtil.peaks(media.file, Math.min(24000, Math.max(200, Math.round(media.dur * 25))));
    media.peaks = pk; Bus.emit('media:peaks', media.id);
  },
  async addBlob(blob, name, kind) { const f = new File([blob], name, { type: blob.type }); return this.add(f, { kind }); },
  /* register media in current project */
  register(project, media) { project.media[media.id] = this.meta(media); },
};

/* ------------------------------------------------------------------ */
const AFX = [['none', 'None'], ['bass', 'Bass boost'], ['treble', 'Treble'], ['voice', 'Voice clarity'], ['telephone', 'Telephone'], ['muffled', 'Muffled'], ['echo', 'Echo'], ['hall', 'Hall reverb'], ['robot', 'Robot']];

const AudioUtil = {
  MAX_DECODE: 200 * 1048576,
  async decode(file, sr = 22050) {
    if (file.size > this.MAX_DECODE) throw new Error('File too large for in-app audio analysis (' + U.size(file.size) + '). Trim or compress it first.');
    const buf = await file.arrayBuffer();
    const oc = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, sr);
    return await new Promise((res, rej) => { const p = oc.decodeAudioData(buf, res, rej); if (p && p.catch) p.catch(rej); });
  },
  mono(ab) {
    const n = ab.length, out = new Float32Array(n), ch = ab.numberOfChannels;
    for (let c = 0; c < ch; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ch; }
    return out;
  },
  async peaks(file, buckets) {
    const ab = await this.decode(file, 8000), d = this.mono(ab), step = d.length / buckets, out = new Float32Array(buckets);
    let mx = 1e-6;
    for (let i = 0; i < buckets; i++) { let m = 0; const a = Math.floor(i * step), b = Math.min(d.length, Math.floor((i + 1) * step)); for (let j = a; j < b; j++) { const v = Math.abs(d[j]); if (v > m) m = v; } out[i] = m; if (m > mx) mx = m; }
    for (let i = 0; i < buckets; i++) out[i] /= mx;
    return out;
  },
  async beats(file) {
    const ab = await this.decode(file, 11025), d = this.mono(ab), hop = 512, n = Math.floor(d.length / hop);
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < hop; j++) { const v = d[i * hop + j]; s += v * v; } env[i] = Math.sqrt(s / hop); }
    const flux = new Float32Array(n); for (let i = 1; i < n; i++) flux[i] = Math.max(0, env[i] - env[i - 1]);
    const times = [], W = 20; let last = -1;
    for (let i = 1; i < n - 1; i++) {
      let mean = 0, c = 0; for (let j = Math.max(0, i - W); j < Math.min(n, i + W); j++) { mean += flux[j]; c++; } mean /= c;
      const t = i * hop / ab.sampleRate;
      if (flux[i] > mean * 1.6 + 0.002 && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && t - last > .28) { times.push(+t.toFixed(3)); last = t; }
    }
    return times;
  },
  wavBlob(channels, sr) {
    const nCh = channels.length, len = channels[0].length, buf = new ArrayBuffer(44 + len * nCh * 2), v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + len * nCh * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, len * nCh * 2, true);
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < nCh; c++) { const s = U.clamp(channels[c][i], -1, 1); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    return new Blob([buf], { type: 'audio/wav' });
  },
  /* shared effect chain used by realtime graph and offline mixdown */
  buildFx(ctx, id) {
    const inp = ctx.createGain(), out = ctx.createGain();
    const biq = (type, f, g, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (g != null) b.gain.value = g; if (q != null) b.Q.value = q; return b; };
    const chain = (...n) => { inp.connect(n[0]); for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); n[n.length - 1].connect(out); };
    switch (id) {
      case 'bass': chain(biq('lowshelf', 200, 10)); break;
      case 'treble': chain(biq('highshelf', 4000, 9)); break;
      case 'voice': chain(biq('highpass', 110), biq('peaking', 2800, 6, 1)); break;
      case 'telephone': chain(biq('highpass', 500), biq('lowpass', 3200), biq('peaking', 1500, 8, 1)); break;
      case 'muffled': chain(biq('lowpass', 700)); break;
      case 'echo': { const d = ctx.createDelay(1); d.delayTime.value = .28; const fb = ctx.createGain(); fb.gain.value = .38; const wet = ctx.createGain(); wet.gain.value = .55; inp.connect(out); inp.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(out); break; }
      case 'hall': {
        const conv = ctx.createConvolver(), len = Math.floor(ctx.sampleRate * 1.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
        conv.buffer = ir; const wet = ctx.createGain(); wet.gain.value = .45; inp.connect(out); inp.connect(conv); conv.connect(wet); wet.connect(out); break;
      }
      case 'robot': { const rg = ctx.createGain(); rg.gain.value = 0; const osc = ctx.createOscillator(); osc.frequency.value = 55; osc.type = 'sine'; osc.connect(rg.gain); osc.start(); inp.connect(rg); rg.connect(out); break; }
      default: inp.connect(out);
    }
    return { input: inp, output: out };
  },
  /* Render the project audio to PCM. opts: {sr, mono, start, end} */
  async mixdown(project, { sr = 44100, mono = false, start = 0, end, onProgress } = {}) {
    end = end == null ? project.duration : end;
    const len = Math.max(1, Math.ceil((end - start) * sr));
    const oc = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(mono ? 1 : 2, len, sr);
    const items = project.items.filter(i => Model.hasAudio(i) && !i.mute && i.vol > 0 && !(i.reverse && i.type === 'video') && i.start < end && i.start + i.dur > start);
    const cache = {}; let n = 0;
    for (const it of items) {
      const media = Library.get(it.mediaId); if (!media) continue;
      let ab = cache[media.id];
      if (!ab) { try { ab = cache[media.id] = await this.decode(media.file, sr); } catch (e) { if (it.type === 'audio') throw e; continue; } }
      const src = oc.createBufferSource(); src.buffer = ab;
      const g = oc.createGain();
      const t0 = it.start - start;
      // speed (constant or ramp)
      const segs = Model.segs(it), len2 = it.out - it.in; let acc = 0;
      segs.forEach((s, k) => { if (k === 0) src.playbackRate.setValueAtTime(s.s, Math.max(0, t0)); else src.playbackRate.setValueAtTime(s.s, Math.max(0, t0 + acc)); acc += (s.b - s.a) * len2 / s.s; });
      const when = Math.max(0, t0), skipT = Math.max(0, -t0), off = it.in + skipT * (it.speed || 1);
      src.start(when, Math.min(off, ab.duration - 0.001), Math.max(0.01, len2 - (skipT * (it.speed || 1))));
      const fxn = this.buildFx(oc, it.afx || 'none');
      src.connect(fxn.input); fxn.output.connect(g); g.connect(oc.destination);
      // volume & fades
      const a0 = Math.max(0, t0), a1 = t0 + it.dur;
      g.gain.setValueAtTime(it.fadeIn > 0 && t0 >= 0 ? 0 : it.vol, a0);
      if (it.fadeIn > 0) { g.gain.setValueAtTime(0, a0); g.gain.linearRampToValueAtTime(it.vol, a0 + it.fadeIn); }
      if (it.fadeOut > 0) { g.gain.setValueAtTime(it.vol, Math.max(a0, a1 - it.fadeOut)); g.gain.linearRampToValueAtTime(0, a1); }
      g.gain.setValueAtTime(0, a1 + .001);
      src.stop(Math.min(len / sr, a1 + .01));
      n++; onProgress && onProgress(n / items.length * .5);
    }
    const rendered = await oc.startRendering();
    const ch = []; for (let c = 0; c < rendered.numberOfChannels; c++) ch.push(rendered.getChannelData(c));
    return { channels: ch, sr };
  },
  /* tiny synth for sound effects -> WAV blob */
  async synth(kind) {
    const sr = 44100, dur = { beep: .3, ding: 1.4, pop: .25, whoosh: .9, drum: .5, clap: .35, laser: .35, riser: 2.5 }[kind] || .5;
    const oc = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);
    const env = (g, a, d, peak = .8) => { g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(peak, a); g.gain.exponentialRampToValueAtTime(.001, d); };
    const noise = (len) => { const b = oc.createBuffer(1, Math.ceil(sr * len), sr), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = oc.createBufferSource(); s.buffer = b; return s; };
    const g = oc.createGain(); g.connect(oc.destination);
    if (kind === 'beep') { const o = oc.createOscillator(); o.frequency.value = 880; o.connect(g); env(g, .01, .3); o.start(); o.stop(dur); }
    else if (kind === 'ding') { [1318, 2637, 3951].forEach((f, i) => { const o = oc.createOscillator(), gg = oc.createGain(); o.frequency.value = f; o.connect(gg); gg.connect(g); gg.gain.value = .5 / (i + 1); o.start(); o.stop(dur); }); env(g, .005, dur, .7); }
    else if (kind === 'pop') { const o = oc.createOscillator(); o.frequency.setValueAtTime(500, 0); o.frequency.exponentialRampToValueAtTime(90, .12); o.connect(g); env(g, .003, .22, .9); o.start(); o.stop(dur); }
    else if (kind === 'whoosh') { const n = noise(dur), f = oc.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(300, 0); f.frequency.exponentialRampToValueAtTime(5000, dur * .55); f.frequency.exponentialRampToValueAtTime(400, dur); n.connect(f); f.connect(g); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(.9, dur * .5); g.gain.linearRampToValueAtTime(0, dur); n.start(); }
    else if (kind === 'drum') { const o = oc.createOscillator(); o.frequency.setValueAtTime(160, 0); o.frequency.exponentialRampToValueAtTime(40, .35); o.connect(g); env(g, .002, .45, 1); o.start(); o.stop(dur); }
    else if (kind === 'clap') { const n = noise(dur), f = oc.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = .8; n.connect(f); f.connect(g); [0, .02, .04].forEach((t, i) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.9, t + .002); g.gain.exponentialRampToValueAtTime(.05, t + .015); }); g.gain.setValueAtTime(.8, .06); g.gain.exponentialRampToValueAtTime(.001, .33); n.start(); }
    else if (kind === 'laser') { const o = oc.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(1800, 0); o.frequency.exponentialRampToValueAtTime(150, dur); o.connect(g); env(g, .005, dur, .35); o.start(); o.stop(dur); }
    else if (kind === 'riser') { const n = noise(dur), f = oc.createBiquadFilter(); f.type = 'highpass'; f.frequency.setValueAtTime(200, 0); f.frequency.exponentialRampToValueAtTime(7000, dur); n.connect(f); f.connect(g); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(.8, dur); n.start(); }
    const r = await oc.startRendering();
    return this.wavBlob([r.getChannelData(0)], sr);
  },
};

/* ------------------------------------------------------------------ */
/* Reverser: captures frames of a clip range into JPEG blobs so reverse plays deterministically in preview & export */
const Reverser = {
  cache: new Map(), // key -> {frames:[{t,blob}], bmps: Map}
  key: (m, a, b) => `${m.id}:${a.toFixed(3)}:${b.toFixed(3)}`,
  has(key) { return this.cache.has(key); },
  async build(media, a, b, { onProgress, signal } = {}) {
    const key = this.key(media, a, b);
    if (this.cache.has(key)) return key;
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = media.url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('Cannot decode video for reverse')); });
    const maxDim = U.isLowEnd() ? 640 : 960, k = Math.min(1, maxDim / Math.max(media.w, media.h));
    const c = U.canvas(media.w * k, media.h * k), x = c.getContext('2d');
    await new Promise(res => { v.onseeked = res; v.currentTime = a; });
    const frames = [], jobs = []; let lastT = -1, done = false;
    const rate = U.isLowEnd() ? 1 : 2;
    v.playbackRate = rate; v.muted = true;
    await new Promise((resolve, reject) => {
      const grab = (t) => {
        if (t - lastT < 1 / 26) return; lastT = t;
        x.drawImage(v, 0, 0, c.width, c.height);
        const rec = { t, blob: null }; frames.push(rec);
        jobs.push(new Promise(r => c.toBlob(bl => { rec.blob = bl; r(); }, 'image/jpeg', .82)));
      };
      const finish = () => { if (done) return; done = true; v.pause(); resolve(); };
      const step = (now, meta) => {
        if (signal && signal.aborted) { done = true; v.pause(); return reject(new Error('cancelled')); }
        const t = meta ? meta.mediaTime : v.currentTime;
        if (t > b || v.ended) return finish();
        grab(t); onProgress && onProgress(U.clamp((t - a) / (b - a), 0, 1));
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step); else requestAnimationFrame(() => step(0, null));
      };
      v.onended = finish; v.onerror = () => reject(new Error('Decode error during reverse'));
      v.play().then(() => { if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step); else requestAnimationFrame(() => step(0, null)); }).catch(reject);
    });
    await Promise.all(jobs); v.src = '';
    const good = frames.filter(f => f.blob);
    if (good.length < 2) throw new Error('Could not capture frames for reverse');
    this.cache.set(key, { frames: good, bmps: new Map() });
    DB.put('rev', { key, frames: good }).catch(() => { });
    return key;
  },
  async load(key) {
    if (this.cache.has(key)) return true;
    try { const r = await DB.get('rev', key); if (r) { this.cache.set(key, { frames: r.frames, bmps: new Map() }); return true; } } catch (e) { }
    return false;
  },
  idxFor(fr, t) { let lo = 0, hi = fr.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (fr[m].t < t) lo = m + 1; else hi = m; } if (lo > 0 && Math.abs(fr[lo - 1].t - t) < Math.abs(fr[lo].t - t)) lo--; return lo; },
  /* returns an ImageBitmap if decoded, else triggers decode and returns nearest available */
  frame(key, t) {
    const e = this.cache.get(key); if (!e) return null;
    const i = this.idxFor(e.frames, t);
    let b = e.bmps.get(i);
    if (!b) {
      if (!e.pending) e.pending = new Set();
      for (let d = 0; d < 6; d++) for (const j of [i + d, i - d]) { if (j >= 0 && j < e.frames.length && !e.bmps.has(j) && !e.pending.has(j)) { e.pending.add(j); createImageBitmap(e.frames[j].blob).then(bm => { e.bmps.set(j, bm); e.pending.delete(j); if (e.bmps.size > 40) { const first = e.bmps.keys().next().value; const old = e.bmps.get(first); old && old.close && old.close(); e.bmps.delete(first); } Engine && Engine.requestRender(); }).catch(() => e.pending.delete(j)); } }
      for (let d = 1; d < 12 && !b; d++) b = e.bmps.get(i + d) || e.bmps.get(i - d);
    }
    return b || null;
  },
  size: key => { const e = Reverser.cache.get(key); return e ? e.frames.reduce((s, f) => s + f.blob.size, 0) : 0; },
};

window.Library = Library; window.AudioUtil = AudioUtil; window.Reverser = Reverser; window.AFX = AFX;
