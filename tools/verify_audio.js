// 事前生成音声が実ブラウザで再生できるかを検証する
const { chromium } = require('/Users/jamstyle01/united-c-blog/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const base = 'http://localhost:8899';

  // 1) eikaiwaページを開く（manifest読込＆appエンジン起動を確認）
  await page.goto(base + '/eikaiwa/', { waitUntil: 'networkidle' });

  // 2) manifestが読めているか（ページと同じ相対解決で）
  const manifestOk = await page.evaluate(async () => {
    const r = await fetch('../audio/eikaiwa/manifest.json');
    if (!r.ok) return { ok: false };
    const m = await r.json();
    return { ok: true, count: Object.keys(m).length, appleFile: m['apple'], exFile: m['I eat an apple every morning.'] };
  });

  // 3) 実際に音声を再生して currentTime が進むか（＝本当に鳴るか）
  const playResult = await page.evaluate(async (file) => {
    return await new Promise((resolve) => {
      const a = new Audio('../audio/eikaiwa/' + file);
      a.playbackRate = 0.95;
      let played = false;
      a.onplaying = () => { played = true; };
      a.onerror = () => resolve({ played: false, err: 'onerror' });
      a.play().then(() => {
        setTimeout(() => resolve({ played, currentTime: a.currentTime, duration: a.duration }), 900);
      }).catch((e) => resolve({ played: false, err: String(e) }));
    });
  }, manifestOk.appleFile);

  console.log('manifest:', JSON.stringify(manifestOk));
  console.log('playback:', JSON.stringify(playResult));

  const pass = manifestOk.ok && playResult.played && playResult.currentTime > 0;
  console.log(pass ? '\n✅ 合格: 事前生成のAria音声が実ブラウザで再生されました' : '\n❌ 不合格');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
