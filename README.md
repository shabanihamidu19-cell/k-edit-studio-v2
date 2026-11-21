# K-EDIT STUDIO 2.0
Personal video, music and photo editor for Android (Capacitor, plain HTML/CSS/JS, no bundler, works offline).

## Build the APK
Needs Node 20, JDK 17, Android SDK.
```
npm install
npm run android:add      # creates android/ and patches permissions
npm run android:apk      # android/app/build/outputs/apk/debug/app-debug.apk
```
Or push to GitHub and run the **Build APK** workflow (.github/workflows/build-apk.yml); the APK is an artifact.
Test in a browser: `npm start`.

## What it does
**Video** – multi-track timeline (main magnetic track, overlay lanes, audio lanes), pinch-zoom, snapping, undo/redo; trim, split, duplicate, speed (0.1–8×, ramps), reverse, freeze frame, rotate/flip/crop, PIP, 19 transitions, 19 colour filters (incl. Pwani, Zanzibar, Savana…), full colour grade (exposure, contrast, saturation, vibrance, temp, tint, highlights, shadows, curves, split-tone, vignette, grain, sharpen), pixel effects (RGB split, glitch, VHS, mosaic…), adjustment/filter/effect layers, keyframes, in/out/loop animations, masks, blend modes, chroma key (green-screen background replacement), text with fonts/stroke/shadow/typewriter/karaoke, emoji/shape stickers, captions (SRT import/export, auto captions via Whisper).
**Audio** – music/SFX/voice-over tracks, waveform, trim/split, volume, fades, effects (bass, treble, voice, telephone, echo, hall, robot…), extract audio, beat detection + cut-to-beat, nudge/sync.
**Photo** – crop/rotate/flip/straighten, adjustments, curves, filters, blur/border, text/stickers/drawing, heal/clone, object removal, background removal (local approximation or AI), background replace/blur, auto-enhance, export PNG (transparent) / JPEG / WebP.
**Export** – MP4 (if the device WebView can encode it) or WebM at 360p–4K, 24/30/60 fps, GIF, WAV, PNG still. Progress, cancel, screen wake-lock.
**AI (Settings → AI providers)** – remove.bg, Photoroom, Clipdrop (cut-out, cleanup, upscale), custom endpoint; Groq → OpenAI → custom Whisper for captions. Providers are tried in order; if all fail you see every real error. Nothing is faked. Local fallbacks are labelled “local / approximation”.

## Honest limitations
- Export is real-time (MediaRecorder on a canvas): a 1-minute video takes about 1 minute, and the app must stay in the foreground. There is no FFmpeg.wasm.
- MP4 depends on the Android WebView; otherwise WebM (plays on Android, may need conversion for some apps).
- Large videos are never loaded into JS memory (streamed from object URLs). Files above the store limit (Settings, default 80 MB) are not copied; the project asks you to re-select them.
- Reverse caches frames (preview + export are consistent); long 1080p clips can take a while and use storage.
- No person-segmentation for video; background replacement uses chroma key. Photo local cut-out works best on plain backgrounds.
- Media3 Transformer (native, hardware, background export) is the recommended next step for faster/longer exports; not included. This build was tested in headless Chromium, not yet on a physical Android device or built to an APK here.
