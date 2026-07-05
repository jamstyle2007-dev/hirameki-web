// パック方式の事前生成音声が実ブラウザでRange取得→再生できるかを検証する
const { chromium } = require('/Users/jamstyle01/united-c-blog/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const base = 'http://localhost:8899';
  await page.goto(base + '/eikaiwa/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const r = await fetch('../audio/eikaiwa/manifest.json');
    if (!r.ok) return { ok: false, why: 'manifest ' + r.status };
    const m = await r.json();
    if (!m.clips) return { ok: false, why: 'no clips' };
    const clip = m.clips['apple'];
    if (!clip) return { ok: false, why: 'no apple clip' };
    const [start, len] = clip;
    // Range取得
    const rr = await fetch('../audio/eikaiwa/' + m.pack, { headers: { Range: `bytes=${start}-${start + len - 1}` } });
    const status = rr.status;
    let blob = await rr.blob();
    if (status === 200 && blob.size > len) blob = blob.slice(start, start + len, blob.type || 'audio/mpeg');
    // 再生
    const played = await new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.playbackRate = 0.95;
      let ok = false;
      a.onplaying = () => { ok = true; };
      a.onerror = () => resolve({ ok: false, why: 'audio onerror' });
      a.play().then(() => setTimeout(() => resolve({ ok, ct: a.currentTime, dur: a.duration }), 900))
              .catch((e) => resolve({ ok: false, why: String(e) }));
    });
    return { ok: true, clips: Object.keys(m.clips).length, pack: m.pack, rangeStatus: status, blobSize: blob.size, expectLen: len, play: played };
  });

  console.log(JSON.stringify(result, null, 2));
  // 本番Pagesは206(部分取得)、ローカルPythonは200(全体→切り出し)。どちらも切り出し後は正しいサイズで再生できるべき
  const pass = result.ok && (result.rangeStatus === 206 || result.rangeStatus === 200) && result.blobSize === result.expectLen && result.play.ok && result.play.ct > 0;
  console.log(pass ? '\n✅ 合格: パックからRange取得したAria音声が実ブラウザで再生されました' : '\n❌ 不合格');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
