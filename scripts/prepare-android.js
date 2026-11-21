// Run after `cap add android` / `cap sync`: adds the permissions the editor needs and keeps the WebView media-friendly.
const fs = require('fs'), path = require('path');
const mf = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(mf)) { console.error('android/ not found – run `npx cap add android` first'); process.exit(1); }
let x = fs.readFileSync(mf, 'utf8');
const perms = ['INTERNET', 'READ_MEDIA_VIDEO', 'READ_MEDIA_IMAGES', 'READ_MEDIA_AUDIO', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'WAKE_LOCK'];
const legacy = ['<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />', '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />'];
let add = '';
for (const p of perms) if (!x.includes(`android.permission.${p}"`)) add += `    <uses-permission android:name="android.permission.${p}" />\n`;
for (const l of legacy) if (!x.includes(l.match(/android\.permission\.\w+/)[0])) add += `    ${l}\n`;
if (!x.includes('android.hardware.microphone')) add += '    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n';
if (add) x = x.replace('</manifest>', add + '</manifest>');
if (!x.includes('android:largeHeap')) x = x.replace('<application', '<application android:largeHeap="true" android:hardwareAccelerated="true"');
fs.writeFileSync(mf, x);
console.log('AndroidManifest.xml patched');
