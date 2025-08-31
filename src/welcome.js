const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');
// Generates an animated WebP banner with pulsating text
async function makeAnimatedWelcomeWebP(username, avatarUrl, guildName) {
  const width = 1200;
  const height = 360;
  const frames = 8; // fewer frames for speed
  const frameDelay = 80; // ms per frame

  // preload assets to avoid repeated I/O
  const bg = await findLocalBackground();
  let avatarImg = null;
  try { avatarImg = await loadImage(avatarUrl); } catch (e) { avatarImg = null; }

  const buffers = [];
  for (let i = 0; i < frames; i++) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // draw background (static or animated GIF frames)
    if (bg) {
      if (bg.type === 'gif') {
        const frameImg = bg.images[i % bg.images.length];
        // scale/crop similar to static case
        const ar = frameImg.width / frameImg.height;
        const tar = width / height;
        let sx = 0, sy = 0, sw = frameImg.width, sh = frameImg.height;
        if (ar > tar) {
          sh = frameImg.height;
          sw = Math.round(sh * tar);
          sx = Math.round((frameImg.width - sw) / 2);
        } else {
          sw = frameImg.width;
          sh = Math.round(sw / tar);
          sy = Math.round((frameImg.height - sh) / 2);
        }
        ctx.drawImage(frameImg, sx, sy, sw, sh, 0, 0, width, height);
      } else {
        const ar = bg.width / bg.height;
        const tar = width / height;
        let sx = 0, sy = 0, sw = bg.width, sh = bg.height;
        if (ar > tar) {
          sh = bg.height;
          sw = Math.round(sh * tar);
          sx = Math.round((bg.width - sw) / 2);
        } else {
          sw = bg.width;
          sh = Math.round(sw / tar);
          sy = Math.round((bg.height - sh) / 2);
        }
        ctx.drawImage(bg, sx, sy, sw, sh, 0, 0, width, height);
      }
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, '#6a11cb');
      grad.addColorStop(1, '#2575fc');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }

    // panel
    const pad = 28;
    const panelX = pad;
    const panelY = pad;
    const panelW = width - pad * 2;
    const panelH = height - pad * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, panelX, panelY, panelW, panelH, 18, true, false);

    // avatar
    const avatarSize = 180;
    const avX = panelX + 36;
    const avY = panelY + Math.round((panelH - avatarSize) / 2);
    if (avatarImg) {
      // avatar pulse/scale animation
      const avatarPulse = 1 + 0.05 * Math.sin((i / frames) * Math.PI * 2);
      const drawSize = Math.round(avatarSize * avatarPulse);
      const drawX = avX - Math.round((drawSize - avatarSize) / 2);
      const drawY = avY - Math.round((drawSize - avatarSize) / 2);

      const borderOuter = drawSize + 12;
      const bx = drawX - 6;
      const by = drawY - 6;
      ctx.save();
      ctx.beginPath();
      ctx.arc(bx + borderOuter / 2, by + borderOuter / 2, borderOuter / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(140,50,220,0.85)';
      ctx.shadowColor = 'rgba(140,50,220,0.6)';
      ctx.shadowBlur = 14 * Math.abs(Math.sin((i / frames) * Math.PI * 2)) + 6;
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(drawX + drawSize / 2, drawY + drawSize / 2, drawSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatarImg, drawX, drawY, drawSize, drawSize);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(drawX + drawSize / 2, drawY + drawSize / 2, drawSize / 2 + 3, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();
    }

    // text block
    const textX = avX + avatarSize + 36;
    const titleSize = 80;
    const nameSize = 48;
    const lineSpacing = 18;
    const textBlockHeight = titleSize + lineSpacing + nameSize;
    const textY = avY + Math.round((avatarSize - textBlockHeight) / 2);

  const pulse = 0.6 + 0.4 * Math.sin((i / frames) * Math.PI * 2);
  // username animation (fade + slight slide)
  const namePulse = 0.55 + 0.45 * Math.sin((i / frames) * Math.PI * 2 + Math.PI / 4);
  const nameOffset = Math.round(6 * Math.sin((i / frames) * Math.PI * 2));
    const title = 'Bine ai venit!';
    ctx.font = `700 ${titleSize}px Sans`;
    ctx.textBaseline = 'top';
    ctx.save(); ctx.globalAlpha = pulse;
    ctx.lineWidth = Math.max(6, Math.round(titleSize / 12));
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = Math.round(titleSize / 6);
    ctx.strokeText(title, textX, textY);
    ctx.restore();
    ctx.save(); ctx.globalAlpha = pulse; ctx.fillStyle = '#ffffff'; ctx.fillText(title, textX, textY); ctx.restore();

  ctx.font = `600 ${nameSize}px Sans`;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.save();
  ctx.globalAlpha = namePulse;
  ctx.fillText(username, textX + nameOffset, textY + titleSize + lineSpacing);
  ctx.restore();

  // moving subtle overlay for background motion
  const overlayOffset = Math.round(80 * Math.sin((i / frames) * Math.PI * 2));
  const ograd = ctx.createLinearGradient(-overlayOffset, 0, width - overlayOffset, height);
  ograd.addColorStop(0, 'rgba(255,255,255,0.02)');
  ograd.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  ograd.addColorStop(1, 'rgba(255,255,255,0.02)');
  ctx.fillStyle = ograd;
  ctx.fillRect(0, 0, width, height);

  // store raw RGBA pixel data for each frame (faster to quantize later)
  const im = ctx.getImageData(0, 0, width, height);
  buffers.push(im.data);
  }

  // Try to produce an animated GIF using a pure-JS encoder (omggif) with a
  // simple 6x6x6 color cube (216 colors). This avoids native builds.
  try {
    const { GifWriter } = require('omggif');

    // build 6x6x6 palette (216 colors) and pad to 256 entries (each as 24-bit int)
    const basePaletteInts = [];
    for (let r = 0; r < 6; r++) {
      for (let g = 0; g < 6; g++) {
        for (let b = 0; b < 6; b++) {
          const rr = Math.round((r * 255) / 5);
          const gg = Math.round((g * 255) / 5);
          const bb = Math.round((b * 255) / 5);
          basePaletteInts.push((rr << 16) | (gg << 8) | bb);
        }
      }
    }
    const paletteColors = new Array(256).fill(0);
    for (let i = 0; i < basePaletteInts.length; i++) paletteColors[i] = basePaletteInts[i];

    // prepare indexed frames from raw RGBA arrays
    const indexedFrames = buffers.map((imgData) => {
      const indexed = new Uint8Array(width * height);
      for (let p = 0, j = 0; p < imgData.length; p += 4, j++) {
        const r = imgData[p];
        const g = imgData[p + 1];
        const b = imgData[p + 2];
        const ri = Math.round((r / 255) * 5);
        const gi = Math.round((g / 255) * 5);
        const bi = Math.round((b / 255) * 5);
        const idx = ri * 36 + gi * 6 + bi; // 0..215
        indexed[j] = idx;
      }
      return indexed;
    });

    // allocate an output buffer (heuristic size)
    const outBuf = new Uint8Array(width * height * buffers.length + 2048);
    const gw = new GifWriter(outBuf, width, height, { loop: 0, palette: paletteColors });
    for (let i = 0; i < indexedFrames.length; i++) {
      const frame = indexedFrames[i];
      gw.addFrame(0, 0, width, height, frame, { palette: paletteColors, delay: Math.round(frameDelay / 10) });
    }
    const used = gw.end();
    return Buffer.from(outBuf.slice(0, used));
  } catch (e) {
    console.error('omggif GIF generation failed:', e && e.stack ? e.stack : e);
    // omggif not available or failed; fall back to single-frame webp
  }

  // fallback: single-frame webp from last frame (fast)
  try {
    const last = buffers[buffers.length - 1];
    return await sharp(last).webp({ quality: 95 }).toBuffer();
  } catch (err) {
    return buffers[buffers.length - 1];
  }
}
// Optional: register a bundled TTF for nicer text rendering
// const fontPath = path.resolve(__dirname, '..', 'assets', 'Inter-Bold.ttf');
// if (fs.existsSync(fontPath)) registerFont(fontPath, { family: 'Inter' });
async function makeWelcomeImage(username, avatarUrl, guildName) {
  const width = 1200;
  const height = 360;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // background (if GIF found, use first frame as static background)
  const bg = await findLocalBackground();
  if (bg) {
    const img = bg.type === 'gif' ? bg.images[0] : bg;
    const ar = img.width / img.height;
    const tar = width / height;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (ar > tar) {
      sh = img.height;
      sw = Math.round(sh * tar);
      sx = Math.round((img.width - sw) / 2);
    } else {
      sw = img.width;
      sh = Math.round(sw / tar);
      sy = Math.round((img.height - sh) / 2);
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#6a11cb');
    grad.addColorStop(1, '#2575fc');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  // panel
  const pad = 28;
  const panelX = pad;
  const panelY = pad;
  const panelW = width - pad * 2;
  const panelH = height - pad * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, panelX, panelY, panelW, panelH, 18, true, false);

  // avatar
  const avatarSize = 180;
  const avX = panelX + 36;
  const avY = panelY + Math.round((panelH - avatarSize) / 2);

  try {
    const avatarImg = await loadImage(avatarUrl);

    // glow/border
    const borderOuter = avatarSize + 12;
    const bx = avX - 6;
    const by = avY - 6;
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx + borderOuter / 2, by + borderOuter / 2, borderOuter / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(140,50,220,0.85)';
    ctx.shadowColor = 'rgba(140,50,220,0.6)';
    ctx.shadowBlur = 20;
    ctx.fill();
    ctx.restore();

    // avatar clip
    ctx.save();
    ctx.beginPath();
    ctx.arc(avX + avatarSize / 2, avY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImg, avX, avY, avatarSize, avatarSize);
    ctx.restore();

    // thin ring
    ctx.beginPath();
    ctx.arc(avX + avatarSize / 2, avY + avatarSize / 2, avatarSize / 2 + 3, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
  } catch (err) {
    console.warn('Failed to load avatar', err);
  }

  // text block (centered vertically relative to avatar)
  const textX = avX + avatarSize + 36;
  const titleSize = 80;
  const nameSize = 48;
  const lineSpacing = 18;
  const textBlockHeight = titleSize + lineSpacing + nameSize;
  const textY = avY + Math.round((avatarSize - textBlockHeight) / 2);

  // title
  const title = 'Bine ai venit!';
  ctx.font = `700 ${titleSize}px Sans`;
  ctx.textBaseline = 'top';
  ctx.save();
  ctx.lineWidth = Math.max(6, Math.round(titleSize / 12));
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = Math.round(titleSize / 6);
  ctx.strokeText(title, textX, textY);
  ctx.restore();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, textX, textY);

  // username (no tag/discriminator)
  const name = `${username}`;
  ctx.font = `600 ${nameSize}px Sans`;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.fillText(name, textX, textY + titleSize + lineSpacing);

  return canvas.toBuffer('image/png');
}

// tiny helper: rounded rectangle
function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  if (typeof r === 'undefined') r = 5;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}


// Helper to find and load a local background image, prioritizing welcome.gif
// If a GIF is found, decode frames using omggif and convert frames to PNG buffers
// and loaded `Image` objects so callers can draw animated backgrounds.
async function findLocalBackground() {
  const candidates = [
    path.join(__dirname, '..', 'images-welcome', 'welcome.gif'),
    path.join(__dirname, '..', 'images-welcome', 'welcome.png'),
    path.join(__dirname, '..', 'images-welcome', 'welcome.jpg'),
  ];
  // Simple cache to avoid re-decoding GIFs on every call
  if (!global.__welcome_bg_cache) global.__welcome_bg_cache = {};
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const stat = fs.statSync(file);
    const key = file;
    const cached = global.__welcome_bg_cache[key];
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.value;
    }
    try {
      const ext = path.extname(file).toLowerCase();
      if (ext === '.gif') {
        // decode GIF frames using omggif
        const { GifReader } = require('omggif');
        const buf = fs.readFileSync(file);
        const reader = new GifReader(buf);
        const gw = reader.width;
        const gh = reader.height;
        const frames = [];
        for (let f = 0; f < reader.numFrames(); f++) {
          const info = reader.frameInfo(f);
          const rgba = new Uint8Array(gw * gh * 4);
          reader.decodeAndBlitFrameRGBA(f, rgba);
          // convert raw RGBA to PNG buffer via sharp
          const pngBuf = await sharp(Buffer.from(rgba), { raw: { width: gw, height: gh, channels: 4 } }).png().toBuffer();
          frames.push({ png: pngBuf, delay: (info.delay || 1) * 10 });
        }
        // preload images for fast drawImage in canvas
  const images = await Promise.all(frames.map(fr => loadImage(fr.png)));
  const value = { type: 'gif', frames, images, width: gw, height: gh };
  global.__welcome_bg_cache[key] = { mtimeMs: stat.mtimeMs, value };
  return value;
      } else {
  // static image
  const img = await loadImage(file);
  global.__welcome_bg_cache[key] = { mtimeMs: stat.mtimeMs, value: img };
  return img;
      }
    } catch (err) {
      // ignore and try next
    }
  }
  return null;
}

module.exports = { makeWelcomeImage, makeAnimatedWelcomeWebP };
