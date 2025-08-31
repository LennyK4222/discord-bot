import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

// Compose a 1200x400 PNG banner with title + subtitle and circular avatar over a background (local file or URL)
const cacheDir = path.join(process.cwd(), 'data', 'cache');
function ensureCache() { if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true }); }

// Overlay-only (transparent) PNG: renders avatar ring + text + bottom shade, no background.
// Lazy-load and cache local Windows fonts, embed as @font-face to stabilize rendering
let __fontCache;
function getEmbeddedFontCss() {
  if (__fontCache !== undefined) return __fontCache;
  try {
    let boldPath = 'C:/Windows/Fonts/segoeuib.ttf';
    let regPath = 'C:/Windows/Fonts/segoeui.ttf';
    if (os.platform() !== 'win32') {
      // Best-effort Linux fallbacks (may not exist)
      boldPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
      regPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    }
    const haveBold = fs.existsSync(boldPath);
    const haveReg = fs.existsSync(regPath);
    if (!haveBold || !haveReg) {
      __fontCache = '';
      return __fontCache;
    }
    const boldData = fs.readFileSync(boldPath);
    const regData = fs.readFileSync(regPath);
    const boldB64 = Buffer.from(boldData).toString('base64');
    const regB64 = Buffer.from(regData).toString('base64');
    __fontCache = `
      <style type="text/css">
        @font-face { font-family: 'SegOverlayBold'; src: url('data:font/ttf;base64,${boldB64}') format('truetype'); font-weight: 700; font-style: normal; }
        @font-face { font-family: 'SegOverlayReg'; src: url('data:font/ttf;base64,${regB64}') format('truetype'); font-weight: 400; font-style: normal; }
      </style>
    `;
  } catch {
    __fontCache = '';
  }
  return __fontCache;
}

export async function composeOverlay({ title, subtitle, avatarUrl, layout = {} }) {
  // Ensure caches (only avatar cache needed here)
  if (!global.__bannerCaches) {
    const makeLRU = (limit) => {
      const m = new Map();
      return {
        get(k) { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
        set(k, v) { if (m.has(k)) m.delete(k); m.set(k, v); if (m.size > limit) { const f = m.keys().next().value; m.delete(f); } }
      };
    };
    global.__bannerCaches = { bg: makeLRU(24), avatar: makeLRU(48) };
  }
  const AV_CACHE = global.__bannerCaches.avatar;

  const avatarLayout = layout.avatar || {};
  const titleLayout = layout.title || {};
  const subtitleLayout = layout.subtitle || {};
  const overlayOpacity = typeof layout.overlayOpacity === 'number' ? layout.overlayOpacity : 0.20;
  const canvasW = 1200, canvasH = 400;
  const defaultAvatarSize = 190;
  const avSize = Math.max(32, Math.min(300, avatarLayout.size || defaultAvatarSize));
  const avX = Math.max(0, Math.min(canvasW - (avSize + 10), avatarLayout.x ?? 80));
  const avY = Math.max(0, Math.min(canvasH - (avSize + 10), avatarLayout.y ?? 90));
  const titleCenter = titleLayout.center !== undefined ? !!titleLayout.center : true;
  const subCenter = subtitleLayout.center !== undefined ? !!subtitleLayout.center : true;
  const titleX = titleCenter ? canvasW / 2 : (titleLayout.x ?? 200);
  const titleY = titleLayout.y ?? 205;
  const titleSize = Math.max(12, Math.min(200, titleLayout.size || 100));
  const titleColor = titleLayout.color || '#00E5FF';
  const titleStroke = titleLayout.strokeColor || 'rgba(0,0,0,0.85)';
  const titleStrokeW = titleLayout.strokeWidth ?? 3;
  const subX = subCenter ? canvasW / 2 : (subtitleLayout.x ?? 200);
  const subY = subtitleLayout.y ?? 265;
  const subSize = Math.max(12, Math.min(200, subtitleLayout.size || 50));
  const subColor = subtitleLayout.color || '#FFD166';
  const subStroke = subtitleLayout.strokeColor || 'rgba(0,0,0,0.85)';
  const subStrokeW = subtitleLayout.strokeWidth ?? 2.0;

  // Transparent base
  let base = sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } });

  // Avatar badge (LRU cached)
  let avatarComposite = [];
  if (avatarUrl) {
    try {
      const size = avSize;
      const avKey = `${avatarUrl}|${size}`;
      let badge = AV_CACHE.get(avKey);
      if (!badge) {
        const avatarBuf = await fetchCachedBuffer(avatarUrl);
        const circleSvg = Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/>
        </svg>`);
        const ringColor = '#00e5ff';
        const ringSvg = Buffer.from(`<svg width="${size+10}" height="${size+10}" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${(size+10)/2}" cy="${(size+10)/2}" r="${(size+10)/2}" fill="${ringColor}"/>
        </svg>`);
        const roundedAvatar = await sharp(avatarBuf)
          .resize(size, size)
          .composite([{ input: circleSvg, blend: 'dest-in' }])
          .png()
          .toBuffer();
        badge = await sharp({ create: { width: size+10, height: size+10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite([
            { input: ringSvg, top: 0, left: 0 },
            { input: roundedAvatar, top: 5, left: 5 }
          ])
          .png()
          .toBuffer();
        AV_CACHE.set(avKey, badge);
      }
      avatarComposite = [ { input: badge, top: avY, left: avX } ];
    } catch {}
  }

  const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeTitle = esc(title);
  const safeSubtitle = esc(subtitle);
  const fontCss = getEmbeddedFontCss();
  const svgText = Buffer.from(`
    <svg width="1200" height="400" xmlns="http://www.w3.org/2000/svg">
      ${fontCss}
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000" stop-opacity="${overlayOpacity}"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.6"/>
        </filter>
      </defs>
      <rect x="0" y="0" width="1200" height="400" fill="url(#shade)"/>
      <g filter="url(#shadow)">
        <text x="${titleX}" y="${titleY}" text-anchor="${titleCenter ? 'middle' : 'start'}" font-family="${fontCss ? 'SegOverlayBold' : "'Segoe UI', Arial, sans-serif"}" font-weight="700" font-size="${titleSize}px" style="fill: none; stroke: ${titleStroke}; stroke-width: ${titleStrokeW}; paint-order: stroke fill;">${safeTitle}</text>
        <text x="${titleX}" y="${titleY}" text-anchor="${titleCenter ? 'middle' : 'start'}" font-family="${fontCss ? 'SegOverlayBold' : "'Segoe UI', Arial, sans-serif"}" font-weight="700" font-size="${titleSize}px" style="fill: ${titleColor};">${safeTitle}</text>
        <text x="${subX}" y="${subY}" text-anchor="${subCenter ? 'middle' : 'start'}" font-family="${fontCss ? 'SegOverlayReg' : "'Segoe UI', Arial, sans-serif"}" font-weight="400" font-size="${subSize}px" style="fill: none; stroke: ${subStroke}; stroke-width: ${subStrokeW}; paint-order: stroke fill;">${safeSubtitle}</text>
        <text x="${subX}" y="${subY}" text-anchor="${subCenter ? 'middle' : 'start'}" font-family="${fontCss ? 'SegOverlayReg' : "'Segoe UI', Arial, sans-serif"}" font-weight="400" font-size="${subSize}px" style="fill: ${subColor};">${safeSubtitle}</text>
      </g>
    </svg>
  `);

  const out = await base
    .composite([
      ...avatarComposite,
      { input: svgText, top: 0, left: 0 }
    ])
    .png()
    .toBuffer();

  return out;
}
function urlToCachePath(url) {
  const h = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  const ext = (new URL(url).pathname.split('.').pop() || 'bin').toLowerCase().split('?')[0];
  return path.join(cacheDir, `${h}.${ext}`);
}
async function fetchCachedBuffer(url) {
  ensureCache();
  const p = urlToCachePath(url);
  if (fs.existsSync(p)) return fs.readFileSync(p);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download failed: ' + url);
  const buf = Buffer.from(await res.arrayBuffer());
  try { fs.writeFileSync(p, buf); } catch {}
  return buf;
}

export async function composeBanner({ backgroundFilePath, backgroundUrl, title, subtitle, avatarUrl, layout = {} }) {
  // --- In-memory LRU caches to speed up rapid previews ---
  // Cache for resized background PNG by key (file + mtime or URL string)
  // and for prebuilt circular avatar badge (avatarUrl + size)
  if (!global.__bannerCaches) {
    const makeLRU = (limit) => {
      const m = new Map();
      return {
        get(k) {
          if (!m.has(k)) return undefined;
          const v = m.get(k);
          m.delete(k); m.set(k, v);
          return v;
        },
        set(k, v) {
          if (m.has(k)) m.delete(k);
          m.set(k, v);
          if (m.size > limit) {
            const first = m.keys().next().value; m.delete(first);
          }
        }
      };
    };
    global.__bannerCaches = {
      bg: makeLRU(24),
      avatar: makeLRU(48)
    };
  }
  const BG_CACHE = global.__bannerCaches.bg;
  const AV_CACHE = global.__bannerCaches.avatar;

  // Resolve background key + buffer
  let bgKey = 'gradient';
  let bgInput;
  if (backgroundFilePath && fs.existsSync(backgroundFilePath)) {
    const st = fs.statSync(backgroundFilePath);
    bgKey = `file:${backgroundFilePath}:${st.mtimeMs}`;
    bgInput = fs.readFileSync(backgroundFilePath);
  } else if (backgroundUrl) {
    bgKey = `url:${backgroundUrl}`;
    bgInput = await fetchCachedBuffer(backgroundUrl);
  } else {
    // Fallback to a gradient background if none provided
    const svg = `<svg width="1200" height="400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#f59e0b"/>
          <stop offset="100%" stop-color="#ef4444"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="400" fill="url(#g)"/>
    </svg>`;
    bgInput = Buffer.from(svg);
  }

  // Resize background to 1200x400 and cache the PNG buffer
  let resizedBg = BG_CACHE.get(bgKey);
  if (!resizedBg) {
    resizedBg = await sharp(bgInput).resize(1200, 400, { fit: 'cover' }).png().toBuffer();
    BG_CACHE.set(bgKey, resizedBg);
  }
  let base = sharp(resizedBg);

  // Rounded corners mask
  const radius = 28;
  const roundedMask = Buffer.from(`
    <svg width="1200" height="400" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="1200" height="400" rx="${radius}" ry="${radius}" fill="#fff"/>
    </svg>
  `);

  // Extract layout values with defaults
  const avatarLayout = layout.avatar || {};
  const titleLayout = layout.title || {};
  const subtitleLayout = layout.subtitle || {};
  const overlayOpacity = typeof layout.overlayOpacity === 'number' ? layout.overlayOpacity : 0.20;
  const canvasW = 1200, canvasH = 400;
  const defaultAvatarSize = 190;
  const avSize = Math.max(32, Math.min(300, avatarLayout.size || defaultAvatarSize));
  const avX = Math.max(0, Math.min(canvasW - (avSize + 10), avatarLayout.x ?? 80));
  const avY = Math.max(0, Math.min(canvasH - (avSize + 10), avatarLayout.y ?? 90));
  const titleCenter = titleLayout.center !== undefined ? !!titleLayout.center : true;
  const subCenter = subtitleLayout.center !== undefined ? !!subtitleLayout.center : true;
  const titleX = titleCenter ? canvasW / 2 : (titleLayout.x ?? 200);
  const titleY = titleLayout.y ?? 205;
  const titleSize = Math.max(12, Math.min(200, titleLayout.size || 100));
  const titleColor = titleLayout.color || '#00E5FF';
  const titleStroke = titleLayout.strokeColor || 'rgba(0,0,0,0.85)';
  const titleStrokeW = titleLayout.strokeWidth ?? 2.5;
  const subX = subCenter ? canvasW / 2 : (subtitleLayout.x ?? 200);
  const subY = subtitleLayout.y ?? 265;
  const subSize = Math.max(12, Math.min(200, subtitleLayout.size || 50));
  const subColor = subtitleLayout.color || '#FFD166';
  const subStroke = subtitleLayout.strokeColor || 'rgba(0,0,0,0.85)';
  const subStrokeW = subtitleLayout.strokeWidth ?? 2.0;

  // Prepare avatar (circle) with LRU cache for avatarUrl+size
  let avatarComposite = [];
  if (avatarUrl) {
    try {
      const size = avSize;
      const avKey = `${avatarUrl}|${size}`;
      let badge = AV_CACHE.get(avKey);
      if (!badge) {
        const avatarBuf = await fetchCachedBuffer(avatarUrl);
        const circleSvg = Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/>
        </svg>`);
        const ringColor = '#00e5ff';
        const ringSvg = Buffer.from(`<svg width="${size+10}" height="${size+10}" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${(size+10)/2}" cy="${(size+10)/2}" r="${(size+10)/2}" fill="${ringColor}"/>
        </svg>`);
        const roundedAvatar = await sharp(avatarBuf)
          .resize(size, size)
          .composite([{ input: circleSvg, blend: 'dest-in' }])
          .png()
          .toBuffer();
        // Merge ring + avatar into a single badge buffer to composite fast
        badge = await sharp({ create: { width: size+10, height: size+10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite([
            { input: ringSvg, top: 0, left: 0 },
            { input: roundedAvatar, top: 5, left: 5 }
          ])
          .png()
          .toBuffer();
        AV_CACHE.set(avKey, badge);
      }
      avatarComposite = [ { input: badge, top: avY, left: avX } ];
    } catch {}
  }

  // Foreground overlay and text via SVG
  const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeTitle = esc(title);
  const safeSubtitle = esc(subtitle);
  const fontCss2 = getEmbeddedFontCss();
  const svgText = Buffer.from(`
    <svg width="1200" height="400" xmlns="http://www.w3.org/2000/svg">
      ${fontCss2}
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000" stop-opacity="${overlayOpacity}"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.6"/>
        </filter>
      </defs>
      <!-- Bottom gradient for contrast -->
      <rect x="0" y="0" width="1200" height="400" fill="url(#shade)"/>
      <g filter="url(#shadow)">
        <!-- Title outline + fill -->
        <text x="${titleX}" y="${titleY}" text-anchor="${titleCenter ? 'middle' : 'start'}" font-family="${fontCss2 ? 'SegOverlayBold' : "'Segoe UI', Arial, sans-serif"}" font-weight="700" font-size="${titleSize}px" style="fill: none; stroke: ${titleStroke}; stroke-width: ${titleStrokeW}; paint-order: stroke fill;">${safeTitle}</text>
        <text x="${titleX}" y="${titleY}" text-anchor="${titleCenter ? 'middle' : 'start'}" font-family="${fontCss2 ? 'SegOverlayBold' : "'Segoe UI', Arial, sans-serif"}" font-weight="700" font-size="${titleSize}px" style="fill: ${titleColor};">${safeTitle}</text>
        <!-- Subtitle outline + fill -->
        <text x="${subX}" y="${subY}" text-anchor="${subCenter ? 'middle' : 'start'}" font-family="${fontCss2 ? 'SegOverlayReg' : "'Segoe UI', Arial, sans-serif"}" font-weight="400" font-size="${subSize}px" style="fill: none; stroke: ${subStroke}; stroke-width: ${subStrokeW}; paint-order: stroke fill;">${safeSubtitle}</text>
        <text x="${subX}" y="${subY}" text-anchor="${subCenter ? 'middle' : 'start'}" font-family="${fontCss2 ? 'SegOverlayReg' : "'Segoe UI', Arial, sans-serif"}" font-weight="400" font-size="${subSize}px" style="fill: ${subColor};">${safeSubtitle}</text>
      </g>
    </svg>
  `);

  // Apply rounded corners by masking at the end
  const composed = await base
    .composite([
      ...avatarComposite,
      { input: svgText, top: 0, left: 0 }
    ])
    .png()
    .toBuffer();

  const out = await sharp(composed)
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  return out;
}
