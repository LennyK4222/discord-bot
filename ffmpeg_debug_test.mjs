import { composeAnimatedBanner } from './src/animatedBannerComposer.js';
import fs from 'fs';

(async () => {
  try {
    const bg = './data/banners/920914103638315048.gif';
    const title = "Bine ai venit!";
    const subtitle = "Test: font path C:/Windows/Fonts/segoeuib.ttf and special chars: 'colon: back\\slash\\ and quote\'";
    const buf = await composeAnimatedBanner({ backgroundFilePath: bg, title, subtitle });
    fs.writeFileSync('out_test.gif', buf);
    console.log('Wrote out_test.gif');
  } catch (err) {
    console.error('Error:', err && err.stack ? err.stack : err);
  }
})();
