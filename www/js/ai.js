'use strict';
/* K-EDIT STUDIO - AI layer.
   Rules: never fake success. Every provider call is real; failures are collected and shown with the provider name.
   Providers are tried in the user's order; local fallbacks are labelled "local". Keys live in Settings('ai'). */

const AI = {
  cfg() { return Object.assign({ removebg: '', photoroom: '', clipdrop: '', groq: '', openai: '', bgCustom: { url: '', key: '', header: 'Authorization' }, sttCustom: { url: '', key: '', model: 'whisper-1' } }, Settings.get('ai', {})); },
  save(c) { Settings.set('ai', c); },
  has(k) { const c = this.cfg(); return !!c[k]; },

  async http(url, { method = 'POST', headers = {}, body, signal, timeout = 90000 } = {}) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
    const onAbort = () => ctrl.abort(); if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    try {
      const r = await fetch(url, { method, headers, body, signal: ctrl.signal });
      return r;
    } catch (e) {
      if (signal && signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      if (ctrl.signal.aborted) throw new Error('Request timed out');
      throw new Error('Network error (' + (e.message || 'offline / blocked by CORS') + ')');
    } finally { clearTimeout(to); if (signal) signal.removeEventListener('abort', onAbort); }
  },
  async errText(r) { let t = ''; try { t = await r.text(); } catch (e) { } try { const j = JSON.parse(t); t = j.error && (j.error.message || j.error) || j.message || j.detail || j.errors && JSON.stringify(j.errors) || t; } catch (e) { } return `HTTP ${r.status}${t ? ': ' + String(t).slice(0, 160) : ''}`; },
  async cvBlob(c, type = 'image/png', q = .92) { return U.canvasToBlob(c, type, q); },
  async fitForUpload(c, max = 2048) { const k = Math.min(1, max / Math.max(c.width, c.height)); if (k >= 1) return c; const o = U.canvas(Math.round(c.width * k), Math.round(c.height * k)); o.getContext('2d').drawImage(c, 0, 0, o.width, o.height); return o; },
  async blobToCv(blob, w, h) {
    const cv = await U.blobToCanvas(blob);
    if (w && (cv.width !== w || cv.height !== h)) { const o = U.canvas(w, h); o.getContext('2d').drawImage(cv, 0, 0, w, h); return o; }
    return cv;
  },
  /* run providers in order; first success wins; if all fail, one honest message listing every failure */
  async chain(list, onStatus, what) {
    if (!list.length) throw new Error(`No AI provider is configured for ${what}. Open Settings → AI providers and add a key.`);
    const fails = [];
    for (const p of list) {
      onStatus && onStatus(`${p.name}…`);
      try { const r = await p.run(); return { ...r, provider: p.name }; }
      catch (e) { if (e.name === 'AbortError') throw e; fails.push(`${p.name}: ${e.message}`); }
    }
    throw new Error(`${what} failed.\n` + fails.join('\n'));
  },

  /* ---------- background removal ---------- */
  bgProviders(src, o) {
    const c = this.cfg(), list = [];
    const up = async () => this.cvBlob(await this.fitForUpload(src, 2500));
    const done = async (r, name) => { if (!r.ok) throw new Error(await this.errText(r)); const b = await r.blob(); if (!/image/.test(b.type)) throw new Error('Provider did not return an image'); return { canvas: await this.blobToCv(b, src.width, src.height) }; };
    if (c.removebg) list.push({ name: 'remove.bg', run: async () => { const f = new FormData(); f.append('image_file', await up(), 'i.png'); f.append('size', 'auto'); return done(await this.http('https://api.remove.bg/v1.0/removebg', { headers: { 'X-Api-Key': c.removebg }, body: f, signal: o.signal })); } });
    if (c.photoroom) list.push({ name: 'Photoroom', run: async () => { const f = new FormData(); f.append('image_file', await up(), 'i.png'); return done(await this.http('https://sdk.photoroom.com/v1/segment', { headers: { 'x-api-key': c.photoroom, Accept: 'image/png' }, body: f, signal: o.signal })); } });
    if (c.clipdrop) list.push({ name: 'Clipdrop', run: async () => { const f = new FormData(); f.append('image_file', await up(), 'i.png'); return done(await this.http('https://clipdrop-api.co/remove-background/v1', { headers: { 'x-api-key': c.clipdrop }, body: f, signal: o.signal })); } });
    if (c.bgCustom.url) list.push({ name: 'Custom API', run: async () => { const f = new FormData(); f.append('image_file', await up(), 'i.png'); f.append('image', await up(), 'i.png'); const hd = {}; if (c.bgCustom.key) hd[c.bgCustom.header || 'Authorization'] = c.bgCustom.key; return done(await this.http(c.bgCustom.url, { headers: hd, body: f, signal: o.signal })); } });
    return list;
  },
  /* returns {canvas (RGBA cut-out, same size as src), provider} */
  async removeBg(src, o = {}) {
    const r = await this.chain(this.bgProviders(src, o), o.onStatus, 'Background removal');
    // sanity: a provider that returns an opaque, unchanged image did not really remove anything
    const t = U.canvas(32, 32), x = t.getContext('2d'); x.drawImage(r.canvas, 0, 0, 32, 32); const d = x.getImageData(0, 0, 32, 32).data; let tr = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 250) tr++;
    if (tr < 8) throw new Error(`${r.provider} returned an image with no transparent area – nothing was removed.`);
    return r;
  },

  /* ---------- enhance / upscale ---------- */
  /* local: 2x Lanczos-ish (stepwise bicubic) + unsharp mask. Honest label: local approximation, no new detail is invented. */
  localEnhance(src) {
    const k = Math.min(2, 4096 / Math.max(src.width, src.height));
    const W = Math.round(src.width * Math.max(1, k)), H = Math.round(src.height * Math.max(1, k));
    const c = U.canvas(W, H), x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, W, H);
    // unsharp mask
    const bl = U.canvas(W, H), bx = bl.getContext('2d'); bx.filter = 'blur(1.2px)'; bx.drawImage(c, 0, 0);
    const a = x.getImageData(0, 0, W, H), b = bx.getImageData(0, 0, W, H), A = a.data, B = b.data, amt = 0.8;
    for (let i = 0; i < A.length; i += 4) for (let j = 0; j < 3; j++) { const v = A[i + j] + (A[i + j] - B[i + j]) * amt; A[i + j] = v < 0 ? 0 : v > 255 ? 255 : v; }
    x.putImageData(a, 0, 0); return c;
  },
  async enhance(src, o = {}) {
    const c = this.cfg(), list = [];
    if (c.clipdrop) list.push({ name: 'Clipdrop upscale', run: async () => {
      const k = Math.min(2, 4096 / Math.max(src.width, src.height)); if (k <= 1.01) throw new Error('Image is already at the maximum supported size');
      const f = new FormData(); const s = await this.fitForUpload(src, 1024); f.append('image_file', await this.cvBlob(s, 'image/jpeg', .95), 'i.jpg');
      f.append('target_width', Math.round(src.width * k)); f.append('target_height', Math.round(src.height * k));
      const r = await this.http('https://clipdrop-api.co/image-upscaling/v1/upscale', { headers: { 'x-api-key': c.clipdrop }, body: f, signal: o.signal, timeout: 120000 });
      if (!r.ok) throw new Error(await this.errText(r)); return { canvas: await this.blobToCv(await r.blob()) };
    } });
    try { return await this.chain(list, o.onStatus, 'AI enhance'); }
    catch (e) { if (e.name === 'AbortError') throw e; o.onStatus && o.onStatus('Local upscale…'); await new Promise(r => setTimeout(r, 20)); return { canvas: this.localEnhance(src), provider: list.length ? 'local (AI failed: ' + e.message.split('\n').slice(-1)[0] + ')' : 'local upscale + sharpen' }; }
  },

  /* ---------- object removal ---------- */
  async removeObject(src, mask, o = {}) {
    const c = this.cfg();
    if (!o.local && c.clipdrop) {
      try {
        const r = await this.chain([{ name: 'Clipdrop cleanup', run: async () => {
          const s = await this.fitForUpload(src, 2048), k = s.width / src.width;
          const m = U.canvas(s.width, s.height), mx = m.getContext('2d'); mx.fillStyle = '#000'; mx.fillRect(0, 0, m.width, m.height);
          // brush mask: any painted alpha → white
          const t = U.canvas(src.width, src.height), tx = t.getContext('2d'); tx.drawImage(mask, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = '#fff'; tx.fillRect(0, 0, t.width, t.height);
          mx.drawImage(t, 0, 0, m.width, m.height);
          const f = new FormData(); f.append('image_file', await this.cvBlob(s, 'image/jpeg', .95), 'i.jpg'); f.append('mask_file', await this.cvBlob(m, 'image/png'), 'm.png'); f.append('mode', 'quality');
          const r = await this.http('https://clipdrop-api.co/cleanup/v1', { headers: { 'x-api-key': c.clipdrop }, body: f, signal: o.signal, timeout: 120000 });
          if (!r.ok) throw new Error(await this.errText(r));
          const res = await this.blobToCv(await r.blob(), s.width, s.height);
          if (k >= 1) return { canvas: res };
          // upscale result back, but keep original pixels outside the mask
          const out = ImgAlgo.cloneCv(src), ox = out.getContext('2d'), up = U.canvas(src.width, src.height); up.getContext('2d').drawImage(res, 0, 0, up.width, up.height);
          const keep = U.canvas(src.width, src.height), kx = keep.getContext('2d'); kx.drawImage(up, 0, 0); kx.globalCompositeOperation = 'destination-in'; kx.filter = 'blur(2px)'; kx.drawImage(t, 0, 0); ox.drawImage(keep, 0, 0); return { canvas: out };
        } }], o.onStatus, 'Object removal');
        return r;
      } catch (e) { if (e.name === 'AbortError') throw e; o.onStatus && o.onStatus('Local fill…'); UI.toast('AI cleanup failed – using local fill. ' + e.message.split('\n').slice(-1)[0], 'error', 5000); }
    }
    await new Promise(r => setTimeout(r, 20));
    return { canvas: ImgAlgo.inpaint(src, mask), provider: 'local fill (approximation – best on small objects / plain areas)' };
  },

  /* ---------- speech to text ---------- */
  sttProviders(lang) {
    const c = this.cfg(), list = [];
    const mk = (name, url, key, model) => ({ name, url, key, model });
    if (c.groq) list.push(mk('Groq Whisper', 'https://api.groq.com/openai/v1/audio/transcriptions', c.groq, 'whisper-large-v3-turbo'));
    if (c.openai) list.push(mk('OpenAI Whisper', 'https://api.openai.com/v1/audio/transcriptions', c.openai, 'whisper-1'));
    if (c.sttCustom.url) list.push(mk('Custom STT', c.sttCustom.url, c.sttCustom.key, c.sttCustom.model || 'whisper-1'));
    return list;
  },
  async sttOne(p, wav, lang, signal) {
    const f = new FormData(); f.append('file', wav, 'a.wav'); f.append('model', p.model); f.append('response_format', 'verbose_json');
    f.append('timestamp_granularities[]', 'word'); f.append('timestamp_granularities[]', 'segment'); if (lang) f.append('language', lang);
    const r = await this.http(p.url, { headers: p.key ? { Authorization: 'Bearer ' + p.key } : {}, body: f, signal, timeout: 180000 });
    if (!r.ok) throw new Error(await this.errText(r));
    const j = await r.json(); if (!j || (!j.segments && !j.text)) throw new Error('Unexpected response from provider');
    return j;
  },
  /* returns [{start,end,text,words:[{w,s,e}]}] in project time */
  async transcribe(project, o = {}) {
    const provs = this.sttProviders(o.lang);
    if (!provs.length) throw new Error('Auto captions need a speech-to-text key (Groq or OpenAI). Open Settings → AI providers. Nothing was generated.');
    o.onStatus && o.onStatus('Mixing audio…', 0);
    const mix = await AudioUtil.mixdown(project, { sr: 16000, mono: true, onProgress: v => o.onStatus && o.onStatus('Mixing audio…', v * .3) });
    const pcm = mix.channels[0]; let peak = 0; for (let i = 0; i < pcm.length; i += 64) peak = Math.max(peak, Math.abs(pcm[i]));
    if (peak < 0.005) throw new Error('The project audio is silent – there is nothing to transcribe.');
    const CH = 600 * 16000, n = Math.ceil(pcm.length / CH), out = [];
    const fails = [];
    let prov = null;
    for (let k = 0; k < n; k++) {
      const a = k * CH, part = pcm.subarray(a, Math.min(pcm.length, a + CH)), wav = AudioUtil.wavBlob([part], 16000), off = a / 16000;
      let j = null;
      for (const p of (prov ? [prov, ...provs.filter(x => x !== prov)] : provs)) {
        o.onStatus && o.onStatus(`${p.name}: part ${k + 1}/${n}…`, .3 + .7 * k / n);
        try { j = await this.sttOne(p, wav, o.lang, o.signal); prov = p; break; }
        catch (e) { if (e.name === 'AbortError') throw e; fails.push(`${p.name}: ${e.message}`); }
      }
      if (!j) throw new Error('Transcription failed.\n' + [...new Set(fails)].join('\n'));
      const words = (j.words || []).map(w => ({ w: String(w.word || w.text || '').trim(), s: (w.start || 0) + off, e: (w.end || 0) + off })).filter(w => w.w);
      let segs = j.segments && j.segments.length ? j.segments.map(s => ({ start: s.start + off, end: s.end + off, text: String(s.text || '').trim() })) : [{ start: off, end: off + part.length / 16000, text: String(j.text || '').trim() }];
      // split long segments into caption-sized chunks (max ~42 chars / 2 lines) using word times when available
      segs.forEach(s => {
        if (!s.text) return;
        const ws = words.filter(w => w.s >= s.start - .05 && w.e <= s.end + .1);
        if (ws.length < 2 || s.text.length <= 42) { out.push({ ...s, words: ws }); return; }
        let cur = [], len = 0;
        const flush = () => { if (!cur.length) return; out.push({ start: cur[0].s, end: cur[cur.length - 1].e, text: cur.map(w => w.w).join(' '), words: cur }); cur = []; len = 0; };
        ws.forEach(w => { if (len + w.w.length > 38 && cur.length) flush(); cur.push(w); len += w.w.length + 1; if (/[.!?]$/.test(w.w)) flush(); });
        flush();
      });
    }
    if (!out.length) throw new Error('The provider returned no speech. Check the spoken language setting.');
    return out.filter(s => s.text);
  },

  /* ---------- test keys (real call, honest result) ---------- */
  async test(kind) {
    const c = this.cfg();
    const tiny = () => { const t = U.canvas(64, 64), x = t.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#d33'; x.beginPath(); x.arc(32, 32, 18, 0, 7); x.fill(); return t; };
    if (kind === 'groq' || kind === 'openai') {
      const url = kind === 'groq' ? 'https://api.groq.com/openai/v1/models' : 'https://api.openai.com/v1/models';
      const r = await this.http(url, { method: 'GET', headers: { Authorization: 'Bearer ' + c[kind] }, timeout: 20000 });
      if (!r.ok) throw new Error(await this.errText(r)); return 'Key accepted';
    }
    const t = tiny(), f = new FormData(); f.append('image_file', await this.cvBlob(t), 'i.png');
    const map = { removebg: ['https://api.remove.bg/v1.0/removebg', { 'X-Api-Key': c.removebg }], photoroom: ['https://sdk.photoroom.com/v1/segment', { 'x-api-key': c.photoroom }], clipdrop: ['https://clipdrop-api.co/remove-background/v1', { 'x-api-key': c.clipdrop }] };
    const m = map[kind]; if (!m) throw new Error('Unknown provider');
    const r = await this.http(m[0], { headers: m[1], body: f, timeout: 40000 });
    if (!r.ok) throw new Error(await this.errText(r)); return 'Key accepted (one test credit may have been used)';
  },
};
window.AI = AI;
