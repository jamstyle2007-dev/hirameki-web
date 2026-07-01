/* ひらめきシリーズ Web版 共通エンジン
   window.APP_CONFIG を読み、単語カード/確認テスト/シャドーイング/聞き流し/翻訳/フレーズ保存を提供する */
(() => {
  const C = window.APP_CONFIG;
  const $ = (sel) => document.querySelector(sel);
  const view = $("#view");
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(C.id + "." + key); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    },
    set(key, val) { localStorage.setItem(C.id + "." + key, JSON.stringify(val)); },
  };

  let DATA = null;
  const LEVELS = [
    { key: "beginner", label: "初級" },
    { key: "intermediate", label: "中級" },
    { key: "advanced", label: "上級" },
  ];

  /* ===== TTS ===== */
  const speech = {
    voices: [],
    load() { this.voices = speechSynthesis.getVoices(); },
    candidates(lang) {
      const exact = this.voices.filter((v) => v.lang.replace("_", "-") === lang);
      if (exact.length) return exact;
      const base = lang.split("-")[0];
      return this.voices.filter((v) => v.lang.startsWith(base));
    },
    // 聞き取りやすい声を優先（Edgeの自然音声 > Google > 女性系 > その他。低品質な男性SAPI声は避ける）
    score(v) {
      let s = 0;
      if (/natural|neural/i.test(v.name)) s += 8;
      if (/google/i.test(v.name)) s += 6;
      if (/female|zira|aria|jenny|michelle|emma|ava|ana|samantha|karen|haruka|ayumi|nanami|sayaka|kyoko|xiaoxiao|yaoyao|huihui|tingting|meijia|mei-jia|siri/i.test(v.name)) s += 3;
      if (/david|mark|george|guy|ichiro|keita|otoya|kangkang|yunjian|male|fred|ralph|albert/i.test(v.name)) s -= 5;
      return s;
    },
    pick(lang) {
      const cands = this.candidates(lang);
      if (!cands.length) return null;
      const chosen = store.get("voice." + lang, "");
      const stored = cands.find((v) => v.name === chosen);
      if (stored) return stored;
      return [...cands].sort((a, b) => this.score(b) - this.score(a))[0];
    },
    speak(text, lang, rate = 0.9, onend = null) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      const v = this.pick(lang);
      if (v) u.voice = v;
      u.rate = rate;
      if (onend) u.onend = onend;
      u.onerror = () => { if (onend) onend(); };
      speechSynthesis.speak(u);
      return u;
    },
    stop() { speechSynthesis.cancel(); },
  };
  speech.load();
  speechSynthesis.onvoiceschanged = () => {
    speech.load();
    if (location.hash === "#settings" && routes.settings) routes.settings();
  };

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 1800);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ===== ルーター ===== */
  const routes = {};
  function nav(hash) { location.hash = hash; }
  window.addEventListener("hashchange", render);

  function render() {
    speech.stop();
    player.reset();
    const [name, ...args] = (location.hash.slice(1) || "home").split("/");
    (routes[name] || routes.home)(...args.map(decodeURIComponent));
    window.scrollTo(0, 0);
  }

  function topbar(title, backHash, sub = "") {
    return `<div class="topbar">
      <button class="back" onclick="location.hash='${backHash}'">‹ 戻る</button>
      <div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>
    </div>`;
  }

  /* ===== ホーム ===== */
  routes.home = () => {
    view.innerHTML = `
      <div class="hero">
        <div class="app-icon">${C.icon}</div>
        <h1>${esc(C.name)}</h1>
        <p>${C.tagline}</p>
      </div>
      <div class="menu">
        <button class="menu-item" onclick="location.hash='vocab'">
          <span class="icon">🃏</span>
          <span><span class="t">単語カード</span><br><span class="d">${esc(C.vocabDesc)}</span></span>
          <span class="chev">›</span>
        </button>
        <button class="menu-item" onclick="location.hash='books/shadowing'">
          <span class="icon">🗣️</span>
          <span><span class="t">シャドーイング</span><br><span class="d">お手本のあとに声に出して練習</span></span>
          <span class="chev">›</span>
        </button>
        <button class="menu-item" onclick="location.hash='books/listening'">
          <span class="icon">🎧</span>
          <span><span class="t">聞き流し</span><br><span class="d">${esc(C.langLabel)}の音声を続けて再生</span></span>
          <span class="chev">›</span>
        </button>
        <button class="menu-item" onclick="location.hash='translate'">
          <span class="icon">🔁</span>
          <span><span class="t">翻訳</span><br><span class="d">日本語⇔${esc(C.langLabel)}をその場で変換</span></span>
          <span class="chev">›</span>
        </button>
        <button class="menu-item" onclick="location.hash='phrases'">
          <span class="icon">📒</span>
          <span><span class="t">保存フレーズ</span><br><span class="d">あとで復習したい表現を保存</span></span>
          <span class="chev">›</span>
        </button>
        <button class="menu-item" onclick="location.hash='settings'">
          <span class="icon">⚙️</span>
          <span><span class="t">音声設定</span><br><span class="d">読み上げの声を聞きやすいものに変更</span></span>
          <span class="chev">›</span>
        </button>
      </div>
      <div class="footer">
        iPhone版も公開中です。<br>
        <a href="${C.appStoreUrl}" target="_blank" rel="noopener">App Storeで「${esc(C.name)}」を見る</a>
      </div>`;
  };

  /* ===== 単語カード: レベル選択 ===== */
  routes.vocab = () => {
    const learned = new Set(store.get("learned", []));
    view.innerHTML = topbar("単語カード", "home") + `<div class="list">` +
      LEVELS.map((lv) => {
        const cards = DATA.vocab[lv.key];
        const done = cards.filter((c) => learned.has(lv.key + "_" + c.w)).length;
        return `<button class="list-item" onclick="location.hash='study/${lv.key}'">
          <span class="icon" style="font-size:1.8rem">${{ beginner: "1️⃣", intermediate: "2️⃣", advanced: "3️⃣" }[lv.key]}</span>
          <span><span class="t">${lv.label}</span><br>
          <span class="d">${esc(C.levelSubtitles[lv.key])}｜${cards.length}語（覚えた ${done}）</span></span>
          <span class="chev">›</span>
        </button>`;
      }).join("") + `</div>`;
  };

  /* ===== 単語カード: 学習 ===== */
  const study = { level: null, order: [], pos: 0, revealed: false, sinceQuiz: 0, recent: [] };

  routes.study = (level) => {
    if (study.level !== level) {
      study.level = level;
      study.order = shuffle(DATA.vocab[level].map((_, i) => i));
      study.pos = 0;
      study.sinceQuiz = 0;
      study.recent = [];
    }
    study.revealed = false;
    drawStudy();
  };

  function drawStudy() {
    const cards = DATA.vocab[study.level];
    const learned = new Set(store.get("learned", []));
    const skipLearned = store.get("skipLearned", false);
    let tries = 0;
    while (skipLearned && tries < cards.length) {
      const c = cards[study.order[study.pos]];
      if (!learned.has(study.level + "_" + c.w)) break;
      study.pos = (study.pos + 1) % cards.length;
      tries++;
    }
    const card = cards[study.order[study.pos]];
    const label = LEVELS.find((l) => l.key === study.level).label;
    const done = cards.filter((c) => learned.has(study.level + "_" + c.w)).length;

    view.innerHTML = topbar("単語カード " + label, "vocab") + `
      <div class="progress-line">
        <span>${study.pos + 1} / ${cards.length}</span>
        <span class="learned">覚えた ${done}語</span>
      </div>
      <div class="card vocab-card" id="vcard">
        <div class="word">${esc(card.w)}</div>
        ${C.hasPinyin ? `<div class="pinyin">${esc(card.p)}</div>` : ""}
        ${study.revealed ? `
          <div class="meaning">${esc(card.m)}</div>
          <div class="example">${esc(card.e)}</div>
          ${C.hasPinyin ? `<div class="example-p">${esc(card.ep)}</div>` : ""}
          <div class="example-ja">${esc(card.ej)}</div>
        ` : `<div class="hint">タップして意味を表示</div>`}
      </div>
      <div style="height:14px"></div>
      <div class="row">
        <button class="btn ghost" id="speak">🔊 発音</button>
        <button class="btn ok" id="know">✅ 覚えた</button>
        <button class="btn ng" id="dontknow">🔁 まだ</button>
      </div>
      <div class="opt-row">
        <span>覚えた単語をスキップ</span>
        <input type="checkbox" class="toggle" id="skip" ${skipLearned ? "checked" : ""}>
      </div>`;

    $("#vcard").onclick = () => {
      if (!study.revealed) {
        study.revealed = true;
        speech.speak(card.w, C.lang, C.rateNormal);
        drawStudy();
      }
    };
    $("#speak").onclick = () => speech.speak(study.revealed ? card.w + ". " + card.e : card.w, C.lang, C.rateNormal);
    $("#skip").onchange = (e) => store.set("skipLearned", e.target.checked);
    $("#know").onclick = () => mark(card, true);
    $("#dontknow").onclick = () => mark(card, false);
  }

  function mark(card, ok) {
    const id = study.level + "_" + card.w;
    const learned = new Set(store.get("learned", []));
    if (ok) learned.add(id); else learned.delete(id);
    store.set("learned", [...learned]);
    study.recent.push(card);
    if (study.recent.length > 12) study.recent.shift();
    study.sinceQuiz++;
    study.pos = (study.pos + 1) % DATA.vocab[study.level].length;
    study.revealed = false;
    if (study.sinceQuiz >= 10) {
      study.sinceQuiz = 0;
      startQuiz();
    } else {
      drawStudy();
    }
  }

  /* ===== 確認テスト（4択・5問） ===== */
  const quiz = { qs: [], pos: 0, score: 0 };

  function startQuiz() {
    const pool = DATA.vocab[study.level];
    const qs = shuffle([...study.recent]).slice(0, 5).map((card) => {
      const wrong = shuffle(pool.filter((c) => c.m !== card.m)).slice(0, 3).map((c) => c.m);
      return { card, opts: shuffle([card.m, ...wrong]) };
    });
    quiz.qs = qs; quiz.pos = 0; quiz.score = 0;
    drawQuiz();
  }

  function drawQuiz() {
    if (quiz.pos >= quiz.qs.length) {
      const perfect = quiz.score === quiz.qs.length;
      view.innerHTML = topbar("確認テスト", "vocab") + `
        <div class="card">
          <div class="quiz-score" style="color:${perfect ? "var(--gold)" : "var(--fg)"}">
            ${perfect ? "🎉 満点！" : "結果"} ${quiz.score} / ${quiz.qs.length}
          </div>
          <button class="btn" id="cont">学習を続ける</button>
        </div>`;
      $("#cont").onclick = () => drawStudy();
      return;
    }
    const q = quiz.qs[quiz.pos];
    view.innerHTML = topbar(`確認テスト ${quiz.pos + 1}/${quiz.qs.length}`, "vocab") + `
      <div class="card">
        <div class="quiz-q">${esc(q.card.w)}</div>
        ${C.hasPinyin ? `<div class="quiz-p">${esc(q.card.p)}</div>` : ""}
        <div class="quiz-opts">
          ${q.opts.map((o, i) => `<button class="btn" data-i="${i}">${esc(o)}</button>`).join("")}
        </div>
      </div>`;
    speech.speak(q.card.w, C.lang, C.rateNormal);
    view.querySelectorAll(".quiz-opts .btn").forEach((b) => {
      b.onclick = () => {
        const pick = q.opts[+b.dataset.i];
        const okBtn = [...view.querySelectorAll(".quiz-opts .btn")].find((x) => x.textContent === q.card.m);
        okBtn.classList.add("correct");
        if (pick === q.card.m) quiz.score++;
        else b.classList.add("wrong");
        view.querySelectorAll(".quiz-opts .btn").forEach((x) => (x.onclick = null));
        setTimeout(() => { quiz.pos++; drawQuiz(); }, 900);
      };
    });
  }

  /* ===== 教材一覧（シャドーイング/聞き流し） ===== */
  routes.books = (mode) => {
    const title = mode === "shadowing" ? "シャドーイング" : "聞き流し";
    const books = DATA.books[mode];
    view.innerHTML = topbar(title, "home") + LEVELS.map((lv) => {
      const bs = books.filter((b) => b.level === lv.key);
      if (!bs.length) return "";
      return `<h2 style="font-size:1.15rem;font-weight:800;margin:20px 4px 12px">${lv.label}</h2>
        <div class="list">` + bs.map((b) => {
          const idx = books.indexOf(b);
          return `<button class="list-item" onclick="location.hash='play/${mode}/${idx}'">
            <span><span class="t">${esc(b.title)}</span><br><span class="d">${b.sentences.length}文</span></span>
            <span class="chev">›</span>
          </button>`;
        }).join("") + `</div>`;
    }).join("");
  };

  /* ===== プレイヤー ===== */
  const player = {
    mode: null, book: null, idx: 0, playing: false, timer: null,
    reset() {
      this.playing = false;
      clearTimeout(this.timer);
      this.timer = null;
    },
  };

  routes.play = (mode, bookIdx) => {
    player.reset();
    player.mode = mode;
    player.book = DATA.books[mode][+bookIdx];
    player.idx = 0;
    drawPlayer();
  };

  function drawPlayer() {
    const b = player.book;
    const s = b.sentences[player.idx];
    const withJa = store.get("playJa", true);
    const loop = store.get("playLoop", false);
    const speed = store.get("playSpeed", "標準");
    const speeds = { "とても遅い": 0.55, "遅い": 0.7, "標準": 0.9, "速い": 1.1 };

    view.innerHTML = topbar(b.title, "books/" + player.mode, `${player.idx + 1} / ${b.sentences.length}文`) + `
      <div class="card player-sent">
        <div>${esc(s.t)}</div>
        ${C.hasPinyin ? `<div class="p">${esc(s.p)}</div>` : ""}
        ${withJa ? `<div class="ja">${esc(s.ja)}</div>` : ""}
      </div>
      <div class="player-ctrl">
        <button id="prev">⏮</button>
        <button id="pp" class="main">${player.playing ? "⏸" : "▶︎"}</button>
        <button id="next">⏭</button>
      </div>
      <div class="card" style="margin-top:20px;padding:6px 18px">
        <div class="opt-row"><span>速さ</span>
          <select id="speed">${Object.keys(speeds).map((k) => `<option ${k === speed ? "selected" : ""}>${k}</option>`).join("")}</select>
        </div>
        <div class="opt-row"><span>日本語も読む</span><input type="checkbox" class="toggle" id="ja" ${withJa ? "checked" : ""}></div>
        <div class="opt-row"><span>くり返し再生</span><input type="checkbox" class="toggle" id="loop" ${loop ? "checked" : ""}></div>
      </div>
      ${player.mode === "shadowing" ? `<p class="note">お手本の音声のあとに、同じ文を声に出して言ってみましょう。1文ごとに復唱の間（ま）が入ります。</p>` : ""}`;

    $("#pp").onclick = () => (player.playing ? pausePlay() : startPlay());
    $("#prev").onclick = () => jump(-1);
    $("#next").onclick = () => jump(1);
    $("#speed").onchange = (e) => { store.set("playSpeed", e.target.value); if (player.playing) { pausePlay(); startPlay(); } };
    $("#ja").onchange = (e) => { store.set("playJa", e.target.checked); drawPlayer(); };
    $("#loop").onchange = (e) => store.set("playLoop", e.target.checked);
  }

  function jump(d) {
    const n = player.book.sentences.length;
    player.idx = (player.idx + d + n) % n;
    const wasPlaying = player.playing;
    pausePlay();
    drawPlayer();
    if (wasPlaying) startPlay();
  }

  function pausePlay() {
    player.playing = false;
    clearTimeout(player.timer);
    speech.stop();
    const pp = $("#pp");
    if (pp) pp.textContent = "▶︎";
  }

  function startPlay() {
    player.playing = true;
    const pp = $("#pp");
    if (pp) pp.textContent = "⏸";
    playCurrent();
  }

  function playCurrent() {
    if (!player.playing) return;
    const speeds = { "とても遅い": 0.55, "遅い": 0.7, "標準": 0.9, "速い": 1.1 };
    const rate = speeds[store.get("playSpeed", "標準")];
    const s = player.book.sentences[player.idx];
    const withJa = store.get("playJa", true);

    const afterForeign = () => {
      if (!player.playing) return;
      const next = () => {
        if (!player.playing) return;
        const gap = player.mode === "shadowing" ? Math.min(6000, 700 + s.t.length * 55) : 500;
        player.timer = setTimeout(() => {
          if (!player.playing) return;
          const n = player.book.sentences.length;
          if (player.idx === n - 1 && !store.get("playLoop", false)) { pausePlay(); return; }
          player.idx = (player.idx + 1) % n;
          drawPlayer();
          const pp = $("#pp");
          if (pp) pp.textContent = "⏸";
          playCurrent();
        }, gap);
      };
      if (withJa) speech.speak(s.ja, "ja-JP", 1.0, next);
      else next();
    };
    speech.speak(s.t, C.lang, rate, afterForeign);
  }

  /* ===== 翻訳 ===== */
  routes.translate = () => {
    const dir = store.get("transDir", "toForeign");
    view.innerHTML = topbar("翻訳", "home") + `
      <div class="seg" id="dirseg">
        <button data-d="toForeign" class="${dir === "toForeign" ? "on" : ""}">日本語 → ${esc(C.langLabel)}</button>
        <button data-d="toJa" class="${dir === "toJa" ? "on" : ""}">${esc(C.langLabel)} → 日本語</button>
      </div>
      <div style="height:14px"></div>
      <textarea class="input" id="src" placeholder="${dir === "toForeign" ? "例：おはようございます" : C.examplePlaceholder}"></textarea>
      <div style="height:12px"></div>
      <button class="btn" id="go">${dir === "toForeign" ? esc(C.langLabel) + "に変換" : "日本語に変換"}</button>
      <div id="out"></div>
      <p class="note">インターネット接続を使って翻訳します。長い文は分けて入力すると、より正確になります。</p>`;

    view.querySelectorAll("#dirseg button").forEach((b) => {
      b.onclick = () => { store.set("transDir", b.dataset.d); routes.translate(); };
    });
    $("#go").onclick = doTranslate;
  };

  async function translateText(text, dir) {
    const sl = dir === "toForeign" ? "ja" : C.mmLang;
    const tl = dir === "toForeign" ? C.mmLang : "ja";
    // 第一候補: AI翻訳（Gemini・自然な意訳）。APIキー設定時のみ有効
    if (C.aiKey) {
      try {
        const from = dir === "toForeign" ? "日本語" : C.aiName;
        const to = dir === "toForeign" ? C.aiName : "日本語";
        const prompt = `あなたはプロの翻訳者です。次の${from}の文を、ネイティブが実際に使う自然で正確な${to}に翻訳してください。訳文だけを出力してください。\n\n${text}`;
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${C.aiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }),
        });
        const json = await res.json();
        const parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
        const out = parts.map((p) => p.text || "").join("").trim();
        if (out) return out;
      } catch { /* フォールバックへ */ }
    }
    // 第二候補: Google翻訳の公開エンドポイント
    try {
      const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`);
      const json = await res.json();
      const out = (json[0] || []).map((seg) => seg[0]).join("").trim();
      if (out) return out;
    } catch { /* フォールバックへ */ }
    // 第二候補: MyMemory
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sl}|${tl}`);
    const json = await res.json();
    return (json.responseData && json.responseData.translatedText || "").trim();
  }

  async function doTranslate() {
    const text = $("#src").value.trim();
    if (!text) return;
    const dir = store.get("transDir", "toForeign");
    $("#go").disabled = true;
    $("#go").textContent = "翻訳中…";
    try {
      const out = await translateText(text, dir);
      if (!out) throw new Error("empty");
      const foreign = dir === "toForeign" ? out : text;
      const ja = dir === "toForeign" ? text : out;
      $("#out").innerHTML = `
        <div class="card result-box">
          <div class="res">${esc(out)}</div>
          <div style="height:14px"></div>
          <div class="row">
            <button class="btn ghost small" id="rspeak">🔊 発音</button>
            <button class="btn small" id="rsave">📒 保存</button>
          </div>
        </div>`;
      $("#rspeak").onclick = () => speech.speak(foreign, C.lang, C.rateNormal);
      $("#rsave").onclick = () => {
        const phrases = store.get("phrases", []);
        phrases.unshift({ ja, f: foreign, at: new Date().toISOString() });
        store.set("phrases", phrases);
        toast("保存しました");
      };
      speech.speak(foreign, C.lang, C.rateNormal);
    } catch {
      $("#out").innerHTML = `<p class="note" style="color:var(--ng)">翻訳できませんでした。少し時間をおいて、もう一度お試しください。</p>`;
    }
    $("#go").disabled = false;
    $("#go").textContent = dir === "toForeign" ? C.langLabel + "に変換" : "日本語に変換";
  }

  /* ===== 保存フレーズ ===== */
  routes.phrases = () => {
    const phrases = store.get("phrases", []);
    view.innerHTML = topbar("保存フレーズ", "home") +
      (phrases.length === 0
        ? `<div class="empty">まだ保存がありません。<br>翻訳の結果から「📒 保存」できます。</div>`
        : `<div class="list">` + phrases.map((p, i) => `
            <div class="list-item" style="cursor:default">
              <button class="btn ghost small" data-s="${i}" style="width:auto">🔊</button>
              <span><span class="t">${esc(p.f)}</span><br><span class="d">${esc(p.ja)}</span></span>
              <button class="del" data-i="${i}">✕</button>
            </div>`).join("") + `</div>`);
    view.querySelectorAll("[data-s]").forEach((b) => {
      b.onclick = () => speech.speak(phrases[+b.dataset.s].f, C.lang, C.rateNormal);
    });
    view.querySelectorAll(".del").forEach((b) => {
      b.onclick = () => {
        phrases.splice(+b.dataset.i, 1);
        store.set("phrases", phrases);
        routes.phrases();
      };
    });
  };

  /* ===== 音声設定 ===== */
  routes.settings = () => {
    speech.load();
    const langs = [
      { lang: C.lang, label: C.langLabel, sample: C.voiceSample },
      { lang: "ja-JP", label: "日本語", sample: "こんにちは。今日もがんばりましょう。" },
    ];
    view.innerHTML = topbar("音声設定", "home") + langs.map((L, li) => {
      const cands = speech.candidates(L.lang);
      const current = speech.pick(L.lang);
      return `<div class="card" style="margin-bottom:16px">
        <div style="font-size:1.2rem;font-weight:800;margin-bottom:10px">${esc(L.label)}の声</div>
        ${cands.length === 0 ? `<p class="note">この端末には${esc(L.label)}の音声が見つかりませんでした。ブラウザや端末の音声データを追加してください。</p>` : `
        <select id="voice${li}" style="width:100%;font-size:1.05rem;font-weight:700;color:var(--fg);background:rgba(255,255,255,0.12);border:1px solid var(--card-border);border-radius:12px;padding:13px">
          ${cands.map((v) => `<option value="${esc(v.name)}" ${current && v.name === current.name ? "selected" : ""}>${esc(v.name)}</option>`).join("")}
        </select>
        <div style="height:12px"></div>
        <button class="btn ghost" id="test${li}">🔊 この声を聞いてみる</button>`}
      </div>`;
    }).join("") + `<p class="note">「Natural」や「Google」と付いた声が、いちばん自然で聞き取りやすくおすすめです。設定はこの端末に保存されます。</p>`;

    langs.forEach((L, li) => {
      const sel = $("#voice" + li);
      if (!sel) return;
      sel.onchange = () => store.set("voice." + L.lang, sel.value);
      $("#test" + li).onclick = () => {
        store.set("voice." + L.lang, sel.value);
        speech.stop();
        speech.speak(L.sample, L.lang, L.lang === "ja-JP" ? 1.0 : C.rateNormal);
      };
    });
  };

  function shuffle(a) {
    const arr = [...a];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* ===== 起動 ===== */
  fetch(C.dataUrl)
    .then((r) => r.json())
    .then((d) => { DATA = d; render(); })
    .catch(() => { view.innerHTML = `<div class="empty">データを読み込めませんでした。<br>再読み込みしてください。</div>`; });
})();
