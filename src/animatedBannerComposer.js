import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { composeOverlay } from './bannerComposer.js';
import { promisify } from 'util';
import child_process from 'child_process';
import ffmpegModule from 'fluent-ffmpeg';

const exec = promisify(child_process.exec);

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 400;
const DEFAULT_AVATAR_SIZE = 190;
const DEFAULT_FPS = 15;
const DEFAULT_OVERLAY_OPACITY = 0.2;

const FONT_REGULAR_WIN = 'C:/Windows/Fonts/segoeui.ttf';
const FONT_BOLD_WIN = 'C:/Windows/Fonts/segoeuib.ttf';
const FONT_REGULAR_LINUX = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const FONT_BOLD_LINUX = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

const FFMPEG_BIN = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN;
const FFPROBE_BIN = process.env.FFPROBE_PATH || process.env.FFPROBE_BIN;
if (FFMPEG_BIN) { try { ffmpegModule.setFfmpegPath(FFMPEG_BIN); } catch {} }
if (FFPROBE_BIN) { try { ffmpegModule.setFfprobePath(FFPROBE_BIN); } catch {} }

async function ensureFfmpegAvailable() {
  const cmd = FFMPEG_BIN ? `"${FFMPEG_BIN}" -version` : 'ffmpeg -version';
  try { await exec(cmd); } catch { throw new Error('FFmpeg not available; install or set FFMPEG_PATH'); }
}

function chooseFonts() {
  let fontRegular = FONT_REGULAR_LINUX;
  let fontBold = FONT_BOLD_LINUX;
  if (process.platform === 'win32') {
    if (fs.existsSync(FONT_REGULAR_WIN)) fontRegular = FONT_REGULAR_WIN;
    if (fs.existsSync(FONT_BOLD_WIN)) fontBold = FONT_BOLD_WIN;
    else if (fs.existsSync(FONT_REGULAR_WIN)) fontBold = FONT_REGULAR_WIN;
  } else {
    if (fs.existsSync(FONT_REGULAR_LINUX)) fontRegular = FONT_REGULAR_LINUX;
    if (fs.existsSync(FONT_BOLD_LINUX)) fontBold = FONT_BOLD_LINUX;
  }
  return { fontRegular, fontBold };
}

function escapeForFfmpegSingleQuote(s) {
  if (s == null) return '';
  // Escape backslashes first, then colon and equals which are used by ffmpeg option parser,
  // then single quotes so the value can be safely enclosed in single quotes in the filter.
  return ('' + s)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/=/g, '\\=')
    .replace(/'/g, "\\'");
}

function escapeForFfmpegUnquoted(s) {
  if (s == null) return '';
  return ('' + s)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/=/g, '\\=')
    .replace(/;/g, '\\;');
}

function escapeFfmpegOptionValue(s) {
  if (s == null) return '';
  return ('' + s)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/=/g, '\\=')
    .replace(/;/g, '\\;')
    .replace(/'/g, "\\'");
}

function escapeXml(s) {
  if (s == null) return '';
  return ('' + s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}


function buildFfmpegFiltersArray(bgPath, avatarPng, layout, titleText, subtitleText, fontRegular, fontBold, avatarIsFullOverlay = false) {
  if (!bgPath || !fs.existsSync(bgPath)) throw new Error('Invalid background path: ' + bgPath);

  const avatarLayout = (layout && layout.avatar) || {};
  const titleLayout = (layout && layout.title) || {};
  const subtitleLayout = (layout && layout.subtitle) || {};
  const overlayOpacity = typeof (layout && layout.overlayOpacity) === 'number' ? layout.overlayOpacity : DEFAULT_OVERLAY_OPACITY;

  const avSize = Math.max(32, Math.min(300, avatarLayout.size || DEFAULT_AVATAR_SIZE));
  const avX = avatarLayout.x ?? 80;
  const avY = avatarLayout.y ?? 90;

  const titleCenter = titleLayout.center !== undefined ? !!titleLayout.center : true;
  const subCenter = subtitleLayout.center !== undefined ? !!subtitleLayout.center : true;
  const titleXExpr = titleCenter ? '(w-text_w)/2' : (titleLayout.x ?? 200);
  const titleY = titleLayout.y ?? 205;
  const titleSize = titleLayout.size || 100;
  const titleColor = titleLayout.color || '#00E5FF';
  const titleBorder = titleLayout.strokeColor || 'black@0.85';
  const titleBorderW = titleLayout.strokeWidth ?? 3;

  const subXExpr = subCenter ? '(w-text_w)/2' : (subtitleLayout.x ?? 200);
  const subY = subtitleLayout.y ?? 265;
  const subSize = subtitleLayout.size || 50;
  const subColor = subtitleLayout.color || '#FFD166';
  const subBorder = subtitleLayout.strokeColor || 'black@0.85';
  const subBorderW = subtitleLayout.strokeWidth ?? 2;

  const filters = [];

  filters.push({ filter: 'fps', options: { fps: DEFAULT_FPS }, inputs: '0:v', outputs: 'fps0' });
  filters.push({ filter: 'scale', options: { w: CANVAS_WIDTH, h: CANVAS_HEIGHT, flags: 'lanczos' }, inputs: 'fps0', outputs: 'sc0' });
  filters.push({ filter: 'format', options: 'rgba', inputs: 'sc0', outputs: 'bg' });

  if (avatarPng) {
    // If the second input is a full-canvas overlay (text PNG), avoid scaling and place at 0,0
    if (avatarIsFullOverlay) {
      filters.push({ filter: 'fps', options: { fps: DEFAULT_FPS }, inputs: '1:v', outputs: 'fps1' });
      filters.push({ filter: 'format', options: 'rgba', inputs: 'fps1', outputs: 'av' });
      filters.push({ filter: 'overlay', options: { x: 0, y: 0, shortest: 0, eof_action: 'repeat' }, inputs: ['bg', 'av'], outputs: 'lay' });
    } else {
      filters.push({ filter: 'fps', options: { fps: DEFAULT_FPS }, inputs: '1:v', outputs: 'fps1' });
      filters.push({ filter: 'scale', options: { w: avSize + 10, h: avSize + 10, flags: 'lanczos' }, inputs: 'fps1', outputs: 'sc1' });
      filters.push({ filter: 'format', options: 'rgba', inputs: 'sc1', outputs: 'av' });
      filters.push({ filter: 'overlay', options: { x: avX, y: avY, shortest: 0, eof_action: 'repeat' }, inputs: ['bg', 'av'], outputs: 'lay' });
    }
  } else {
    // pass-through
    filters.push({ filter: 'copy', inputs: 'bg', outputs: 'lay' });
  }

  filters.push({ filter: 'drawbox', options: { x: 0, y: 0, w: 'iw', h: 'ih', color: `black@${overlayOpacity}`, t: 'fill' }, inputs: 'lay', outputs: 'db' });

  if (!avatarIsFullOverlay) {
    // draw title
    filters.push({
      filter: 'drawtext',
      options: {
        text: titleText || '',
        x: titleXExpr,
        y: titleY,
        fontsize: titleSize,
        fontcolor: titleColor,
        bordercolor: titleBorder,
        borderw: titleBorderW,
        enable: '1'
      },
      inputs: 'db', outputs: 't1'
    });

    // draw subtitle
    filters.push({
      filter: 'drawtext',
      options: {
        text: subtitleText || '',
        x: subXExpr,
        y: subY,
        fontsize: subSize,
        fontcolor: subColor,
        bordercolor: subBorder,
        borderw: subBorderW,
        enable: '1'
      },
      inputs: 't1', outputs: 'pre'
    });
  } else {
    filters.push({ filter: 'copy', inputs: 'db', outputs: 'pre' });
  }

  filters.push({ filter: 'split', inputs: 'pre', outputs: ['pout', 'palin'] });
  filters.push({ filter: 'palettegen', options: { stats_mode: 'full' }, inputs: 'palin', outputs: 'pal' });
  filters.push({ filter: 'paletteuse', options: { new: 1, diff_mode: 'rectangle' }, inputs: ['pout', 'pal'], outputs: 'outv' });

  return filters;
}

export async function composeAnimatedBanner({ backgroundFilePath, backgroundUrl, title, subtitle, avatarUrl, layout = {} }) {
  const startTime = Date.now();
  await ensureFfmpegAvailable();

  const bgPath = backgroundFilePath || null;
  if (!bgPath || !fs.existsSync(bgPath)) throw new Error('Background not found: ' + bgPath);

  const { fontRegular, fontBold } = chooseFonts();

  // Render the overlay (avatar + text) using the same renderer as preview so appearance matches
  const overlayBuf = await composeOverlay({ title: title || '', subtitle: subtitle || '', avatarUrl, layout });
  const tmpPngPath = path.join(os.tmpdir(), `banner_text_${Date.now()}.png`);
  fs.writeFileSync(tmpPngPath, overlayBuf);
  const avatarPng = tmpPngPath;

  const filterArr = buildFfmpegFiltersArray(bgPath, avatarPng, layout, title || '', subtitle || '', fontRegular, fontBold, true);
  console.log('FFmpeg filter array:', JSON.stringify(filterArr, null, 2));

  const outPath = path.join(os.tmpdir(), 'banner_out_' + Date.now() + '.gif');

  return await new Promise((resolve, reject) => {
    try {
      let cmd = ffmpegModule(bgPath).input(avatarPng);

      cmd = cmd.complexFilter(filterArr);
      cmd.on('start', (cmdline) => console.log('FFmpeg command:', cmdline));

      cmd.outputOptions(['-y', '-loop', '0', '-f', 'gif', '-map', '[outv]'])
        .output(outPath)
        .on('stderr', (line) => { try { console.log('[ffmpeg]', line.toString()); } catch {} })
        .on('end', () => {
          try {
            const buf = fs.readFileSync(outPath);
            try { fs.unlinkSync(outPath); } catch {}
            try { fs.unlinkSync(avatarPng); } catch {}
            console.log(`Banner composition completed in ${Date.now() - startTime}ms`);
            resolve(buf);
          } catch (err) { reject(err); }
        })
        .on('error', (err) => {
          try { fs.unlinkSync(avatarPng); } catch {}
          reject(err);
        })
        .run();
    } catch (err) { try { fs.unlinkSync(avatarPng); } catch {} reject(err); }
  });
}

