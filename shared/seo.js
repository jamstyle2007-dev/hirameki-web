/* 単語一覧・教材ページ（tools/gen_seo_pages.py で生成）の🔊ボタン。
   アプリ本体と同じ事前生成音声パックをRange取得で鳴らし、無ければ端末の音声合成で読む */
(() => {
  const main = document.querySelector("main.seo");
  if (!main) return;
  const lang = main.dataset.lang;
  const base = main.dataset.audio;
  let pack = "", clips = null, cur = null;
  const ready = fetch(base + "manifest.json?v=9")
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => {
      if (m && m.clips && m.pack) {
        clips = m.clips;
        pack = /^https?:/.test(m.pack) ? m.pack : base + m.pack;
      }
    })
    .catch(() => {});

  function device(text) {
    if (typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.9;
    speechSynthesis.speak(u);
  }

  async function speak(text) {
    if (cur) { cur.pause(); cur = null; }
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    await ready;
    const clip = clips && clips[text.trim()];
    if (!clip) return device(text);
    const [start, len] = clip;
    try {
      const res = await fetch(pack, { headers: { Range: `bytes=${start}-${start + len - 1}` } });
      if (res.status !== 206 && res.status !== 200) throw new Error("range");
      const cr = res.headers.get("Content-Range");
      const m = cr && /bytes (\d+)-/.exec(cr);
      let blob = await res.blob();
      const off = start - (m ? +m[1] : 0);
      if (off !== 0 || blob.size !== len) blob = blob.slice(off, off + len, "audio/mpeg");
      const url = URL.createObjectURL(blob);
      cur = new Audio(url);
      cur.onended = () => URL.revokeObjectURL(url);
      await cur.play();
    } catch (e) {
      device(text);
    }
  }

  main.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-say]");
    if (b) speak(b.dataset.say);
  });
})();
