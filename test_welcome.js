(async ()=>{
  try {
    const path = require('path');
    const fs = require('fs');
    const w = require('./src/welcome.js');
    console.log('functions exported:', Object.keys(w));
    const avatar = path.resolve(process.cwd(), 'images-welcome', 'welcome.jpg');
    console.log('avatar:', avatar);
    const timeout = setTimeout(()=>{ console.error('Timeout reached waiting for makeAnimatedWelcomeWebP'); process.exit(2); }, 20000);
    const buf = await w.makeAnimatedWelcomeWebP('TestUser', avatar, 'Guild');
    clearTimeout(timeout);
  const magic = buf.slice(0,4).toString('ascii');
  const ext = magic.includes('RIFF') || magic.includes('WEBP') ? 'webp' : (magic.includes('GIF8') ? 'gif' : 'dat');
  const out = `tmp_welcome.${ext}`;
  const tmp = `tmp_welcome.tmp`;
  console.log('Writing to temporary file', tmp);
  fs.writeFileSync(tmp, buf);
  if (fs.existsSync(tmp)) console.log('Temp file exists, renaming to', out);
  try {
    fs.renameSync(tmp, out);
    console.log('WROTE', out, buf.length, 'magic=', magic);
  } catch (err) {
    // fallback: try writing directly
    console.warn('Rename failed, writing directly to', out, err);
    fs.writeFileSync(out, buf);
    console.log('WROTE', out, buf.length, 'magic=', magic);
  }
  } catch (e) {
    console.error('ERROR running test:', e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }
})();
