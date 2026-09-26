// ひらめき語学: 全言語・全画面の自動動作確認（スマホ幅）
// 各画面を実ブラウザで開き、JSエラー・読み込み失敗(4xx/5xx)・横はみ出しを検出してスクリーンショットを保存する。
//
// 使い方:
//   python3 -m http.server 8899 &            # リポジトリ直下で
//   node tools/smoke_test.js [出力フォルダ]    # 既定は ./smoke-out（.gitignore 済み）
// 環境変数: BASE（既定 http://localhost:8899/）, CHROME（Chromeの実行ファイル。未指定ならPlaywright同梱）
// 問題があれば終了コード1。
const path = require("path");
const fs = require("fs");

function loadPlaywright() {
  try { return require("playwright"); } catch {}
  const root = require("child_process").execSync("npm root -g").toString().trim();
  return require(path.join(root, "playwright"));
}

const BASE = process.env.BASE || "http://localhost:8899/";
const OUT = process.argv[2] || "smoke-out";
const LANGS = ["eikaiwa", "chinese", "korean", "french", "spanish"];
// [ハッシュ, 表示されるべき要素]
const SCREENS = [
  ["", ".menu"],
  ["vocab", ".list"],
  ["study/beginner", ".vocab-card"],
  ["books/shadowing", ".list-item"],
  ["play/shadowing/0", ".player-sent"],
  ["books/listening", ".list-item"],
  ["play/listening/0", ".player-sent"],
  ["translate", "#src"],
  ["phrases", ".topbar"],
  ["lessons", ".topbar"],
  ["settings", ".topbar"],
];
// 404でも問題ないもの（ローカル専用の設定ファイル）
const IGNORE_404 = [/config\.local\.js/];

(async () => {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const problems = [];

  for (const lang of LANGS) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    let where = "";
    page.on("pageerror", (e) => problems.push(`${lang}/${where}: JSエラー ${e.message}`));
    page.on("response", (r) => {
      const u = r.url();
      if (r.status() >= 400 && u.startsWith(BASE) && !IGNORE_404.some((re) => re.test(u))) {
        problems.push(`${lang}/${where}: ${r.status()} ${u.slice(BASE.length)}`);
      }
    });

    // 初回表示の速さ（ホームのメニューが出るまで）
    const t0 = Date.now();
    await page.goto(BASE + lang + "/");
    await page.waitForSelector(".menu", { timeout: 10000 }).catch(() => problems.push(`${lang}: ホームが表示されない`));
    const homeMs = Date.now() - t0;

    for (const [hash, sel] of SCREENS) {
      where = hash || "home";
      await page.goto(BASE + lang + "/#" + hash);
      const ok = await page.waitForSelector(sel, { timeout: 8000 }).then(() => true).catch(() => false);
      if (!ok) problems.push(`${lang}/${where}: ${sel} が表示されない`);
      await page.waitForTimeout(200);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      if (sw > 390) problems.push(`${lang}/${where}: 横にはみ出し (${sw}px)`);
      await page.screenshot({ path: path.join(OUT, `${lang}-${where.replace(/\//g, "_")}.png`) });
    }

    // 単語カード: めくる→覚えた/まだ を10回→確認テストが出る
    where = "study-flow";
    await page.goto(BASE + lang + "/#study/intermediate");
    await page.waitForSelector("#vcard");
    await page.click("#vcard");
    if (!(await page.$(".meaning"))) problems.push(`${lang}/study: タップしても意味が出ない`);
    for (let i = 0; i < 10; i++) {
      await page.click(i % 2 ? "#know" : "#dontknow");
      await page.waitForTimeout(60);
    }
    if (!(await page.$(".quiz-opts"))) problems.push(`${lang}/study: 10枚後に確認テストが出ない`);

    // 検索用ページ
    for (const u of [`${lang}/words/`, `${lang}/words/beginner/1/`, `${lang}/texts/`, `${lang}/texts/shadowing-0/`]) {
      where = u;
      await page.goto(BASE + u);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      if (sw > 390) problems.push(`${u}: 横にはみ出し (${sw}px)`);
    }

    console.log(`${lang}: ホーム表示 ${homeMs}ms`);
    await page.close();
  }

  await browser.close();
  if (problems.length) {
    console.log(`\n❌ 問題 ${problems.length} 件`);
    problems.forEach((p) => console.log("  - " + p));
    process.exit(1);
  }
  console.log(`\n✅ 全言語・全画面OK（スクリーンショット: ${OUT}/）`);
})();
