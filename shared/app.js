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
    // 容量オーバー（全言語で同じ保存領域を共有）やプライベートモードでも画面を止めない
    set(key, val) {
      try { localStorage.setItem(C.id + "." + key, JSON.stringify(val)); return true; }
      catch { return false; }
    },
    remove(key) { try { localStorage.removeItem(C.id + "." + key); } catch {} },
  };

  let DATA = null;
  const LEVELS = [
    { key: "beginner", label: "初級" },
    { key: "intermediate", label: "中級" },
    { key: "advanced", label: "上級" },
  ];

  /* ===== TTS ===== */
  // Android WebView等、window.speechSynthesisが存在しない環境でも
  // 事前生成音声(pack)だけで動くようにする（無ければ端末音声機能は静かに無効化）
  const hasDeviceTTS = typeof speechSynthesis !== "undefined";
  const speech = {
    voices: [],
    audio: null,        // 事前生成音声の再生用（使い回してキャンセル可能に）
    audioUrl: null,     // 直近再生のObjectURL（後始末用）
    seq: 0,             // 再生トークン（非同期取得中に次の発話が来たら破棄する）
    pack: "",           // 連結音声パックのURL（例: ../audio/eikaiwa/pack.mp3）
    clips: null,        // { テキスト: [byteOffset, byteLength] } 事前生成音声の索引
    audioBase: "",      // 事前生成音声フォルダのURL
    load() { this.voices = hasDeviceTTS ? speechSynthesis.getVoices() : []; },
    // 事前生成音声のバイト範囲 [offset,len] を返す（無ければ null）
    clipFor(text) {
      if (!this.clips || !text) return null;
      return this.clips[text.trim()] || null;
    },
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
    // 事前生成音声(Aria等の高品質女性音声)を優先し、無ければ端末の音声にフォールバック
    speak(text, lang, rate = 0.9, onend = null) {
      this.stop();
      const clip = this.clipFor(text);
      if (clip && this.pack) {
        const mySeq = ++this.seq;
        this.playClip(clip, rate, onend, mySeq).catch(() => {
          // 取得/再生に失敗し、かつ他の発話に切り替わっていなければ端末音声へ
          if (this.seq === mySeq) this.speakDevice(text, lang, rate, onend);
        });
        return;
      }
      return this.speakDevice(text, lang, rate, onend);
    },
    // パックから該当バイト範囲だけを取得して再生（範囲バイト列はそのまま単体mp3として有効）
    playClip(clip, rate, onend, mySeq) {
      const [start, len] = clip;
      return fetch(this.pack, { headers: { Range: `bytes=${start}-${start + len - 1}` } })
        .then((res) => {
          if (res.status !== 206 && res.status !== 200) throw new Error("range " + res.status);
          // Content-Rangeで実際の開始位置を確認する（Android WebViewのローカル資産配信は
          // 開始位置だけ尊重し終端は無視してファイル末尾まで返すことがあるため、
          // 「サイズが違えば切り出す」だけでは基準点を誤る。ヘッダーが無ければ200(全体)とみなす）
          const cr = res.headers.get("Content-Range");
          const m = cr && /bytes (\d+)-/.exec(cr);
          const rangeStart = m ? parseInt(m[1], 10) : 0;
          return res.blob().then((blob) => ({ blob, rangeStart }));
        })
        .then(({ blob, rangeStart }) => {
          const offset = start - rangeStart;
          if (offset !== 0 || blob.size !== len) blob = blob.slice(offset, offset + len, blob.type || "audio/mpeg");
          if (this.seq !== mySeq) return; // 取得中に次の発話が来ていたら破棄
          return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const a = new Audio(url);
            this.audio = a; this.audioUrl = url;
            try { a.preservesPitch = true; a.mozPreservesPitch = true; a.webkitPreservesPitch = true; } catch (e) {}
            a.playbackRate = Math.max(0.5, Math.min(1.2, rate + 0.05)); // 生成は等速なので少し補正
            const cleanup = () => { try { URL.revokeObjectURL(url); } catch (e) {} };
            a.onended = () => { cleanup(); resolve(); if (onend) onend(); };
            a.onerror = () => { cleanup(); reject(new Error("audio error")); };
            a.play().catch(reject);
          });
        });
    },
    // 端末内蔵の音声合成（従来ロジック）。無い環境（Android WebView等）では何もしない
    speakDevice(text, lang, rate = 0.9, onend = null) {
      if (!hasDeviceTTS) { if (onend) onend(); return null; }
      // 前回の発話が残っていると2回目以降が鳴らなくなるため、毎回リセットしてから発話する
      speechSynthesis.cancel();
      // Chromeで一時停止状態のまま詰まることがあるので念のため解除
      if (speechSynthesis.paused) speechSynthesis.resume();
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
    // 複数テキストを順番に読み上げ（単語→例文など）。各パートが事前音声/端末音声を自動選択
    speakSeq(parts, lang, rate = 0.9, onend = null) {
      const list = parts.filter((t) => t && t.trim());
      const step = (i) => {
        if (i >= list.length) { if (onend) onend(); return; }
        this.speak(list[i], lang, rate, () => step(i + 1));
      };
      step(0);
    },
    stop() {
      this.seq++; // 進行中の非同期取得を無効化する
      if (hasDeviceTTS) speechSynthesis.cancel();
      if (this.audio) { try { this.audio.onended = null; this.audio.onerror = null; this.audio.pause(); } catch (e) {} this.audio = null; }
      if (this.audioUrl) { try { URL.revokeObjectURL(this.audioUrl); } catch (e) {} this.audioUrl = null; }
    },
  };
  speech.load();
  if (hasDeviceTTS) speechSynthesis.onvoiceschanged = () => {
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
  /* ===== 今日の目標・連続学習日数 ===== */
  // 日付は端末のローカル時刻で数える（日本の利用者が夜中0時で切り替わるように）
  function today(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function goal() { return store.get("dailyGoal", 20); }
  function todayCount() {
    const d = store.get("daily", null);
    return d && d.date === today() ? d.count : 0;
  }
  // 連続日数：最後に学習した日が今日か昨日なら継続中、それより前なら途切れている
  function streakDays() {
    const s = store.get("streak", null);
    return s && (s.last === today() || s.last === today(-1)) ? s.days : 0;
  }
  function countStudy() {
    const t = today();
    const n = todayCount() + 1;
    store.set("daily", { date: t, count: n });
    const s = store.get("streak", null);
    if (!s || s.last !== t) {
      store.set("streak", { last: t, days: s && s.last === today(-1) ? s.days + 1 : 1 });
    }
    if (n === goal()) toast(`🎉 今日の目標 ${goal()}語 達成！`);
  }
  function goalHtml() {
    const n = todayCount(), g = goal(), days = streakDays();
    const pct = Math.min(100, Math.round((n / g) * 100));
    return `<div class="goal">
      <div class="goal-row"><span>🔥 ${days ? days + "日連続" : "今日から連続記録スタート"}</span><span>今日 ${n} / ${g}語${n >= g ? " ✅" : ""}</span></div>
      <div class="goal-bar"><div style="width:${pct}%"></div></div>
    </div>`;
  }

  /* ===== 苦手な単語 ===== */
  // 「まだ」や確認テストの不正解で登録し、「覚えた」や正解で外す。キーは learned と同じ「レベル_単語」
  function cardKey(card) { return (card._lv || study.id) + "_" + card.w; }
  function setWeak(card, on) {
    const key = cardKey(card);
    if (!LEVELS.some((l) => key.startsWith(l.key + "_"))) return; // 組み込み語彙だけが対象
    const weak = new Set(store.get("weak", []));
    if (on) weak.add(key); else weak.delete(key);
    store.set("weak", [...weak]);
  }
  function weakCards() {
    const weak = new Set(store.get("weak", []));
    return LEVELS.flatMap((l) => DATA.vocab[l.key].filter((c) => weak.has(l.key + "_" + c.w)).map((c) => ({ ...c, _lv: l.key })));
  }

  // 最後に学習していた場所（単語カード/教材/デッキ）。ホームの「続きから」に使う
  function saveLast(icon, title, sub) {
    store.set("last", { hash: location.hash.slice(1), icon, title, sub });
  }

  routes.home = () => {
    const last = store.get("last", null);
    view.innerHTML = `
      <div class="hero">
        <div class="app-icon">${C.icon}</div>
        <h1>${esc(C.name)}</h1>
        <p>${C.tagline}</p>
      </div>
      ${goalHtml()}
      <div class="menu">
        ${last && last.hash ? `<button class="menu-item resume" id="resume">
          <span class="icon">${esc(last.icon || "▶︎")}</span>
          <span><span class="d">続きから</span><br><span class="t">${esc(last.title)}</span><br><span class="d">${esc(last.sub || "")}</span></span>
          <span class="chev">›</span>
        </button>` : ""}
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
        <button class="menu-item" onclick="location.hash='lessons'">
          <span class="icon">📝</span>
          <span><span class="t">レッスン復習</span><br><span class="d">先生のメモを貼るとAIが復習カードを作成</span></span>
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
        <a href="${C.appStoreUrl}" target="_blank" rel="noopener">App Storeで「${esc(C.name)}」を見る</a><br><br>
        <a href="../privacy/">プライバシーポリシー</a>
      </div>`;
    if (last && last.hash) $("#resume").onclick = () => (location.hash = last.hash);
  };

  /* ===== 単語カード: レベル選択 ===== */
  routes.vocab = () => {
    const learned = new Set(store.get("learned", []));
    const weakN = store.get("weak", []).length;
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
      }).join("") + (weakN ? `<button class="list-item" onclick="location.hash='weak'">
          <span class="icon" style="font-size:1.8rem">😣</span>
          <span><span class="t">苦手な単語</span><br>
          <span class="d">「まだ」やテストで間違えた単語だけを復習｜${weakN}語</span></span>
          <span class="chev">›</span>
        </button>` : "") + `</div>
      <div class="card" style="margin-top:16px;padding:6px 18px">
        <div class="opt-row"><span>1日の目標</span>
          <select id="goal">${[10, 20, 30, 50, 100].map((n) => `<option value="${n}" ${n === goal() ? "selected" : ""}>${n}語</option>`).join("")}</select>
        </div>
      </div>`;
    $("#goal").onchange = (e) => store.set("dailyGoal", +e.target.value);
  };

  routes.weak = () => {
    const cards = weakCards();
    if (!cards.length) { toast("苦手な単語はありません 🎉"); location.hash = "vocab"; return; }
    study.id = null; // 毎回いまの苦手リストで作り直す
    startStudy("weak", cards, "vocab", "苦手な単語");
  };

  /* ===== 単語カード: 学習（組み込み語彙・レッスン復習デッキ共通エンジン） ===== */
  const study = { id: null, cards: [], back: "vocab", title: "", order: [], pos: 0, revealed: false, sinceQuiz: 0, recent: [] };

  // id は「覚えた」管理の名前空間（組み込みはレベル名のまま＝後方互換、デッキは deck_<id>）
  function startStudy(id, cards, back, title) {
    if (study.id !== id) {
      study.id = id;
      study.cards = cards;
      study.back = back;
      study.title = title;
      // 前回のシャッフル順と位置を復元（データの語数が変わっていたら作り直す）
      const saved = store.get("studyPos." + id, null);
      if (saved && Array.isArray(saved.order) && saved.order.length === cards.length) {
        study.order = saved.order;
        study.pos = Math.min(saved.pos | 0, cards.length - 1);
      } else {
        study.order = shuffle(cards.map((_, i) => i));
        study.pos = 0;
      }
      study.sinceQuiz = 0;
      study.recent = [];
    }
    study.revealed = false;
    drawStudy();
  }

  routes.study = (level) => {
    const label = LEVELS.find((l) => l.key === level).label;
    startStudy(level, DATA.vocab[level], "vocab", "単語カード " + label);
  };

  function drawStudy() {
    const cards = study.cards;
    const learned = new Set(store.get("learned", []));
    const skipLearned = store.get("skipLearned", false);
    let tries = 0;
    while (skipLearned && tries < cards.length) {
      const c = cards[study.order[study.pos]];
      if (!learned.has(cardKey(c))) break;
      study.pos = (study.pos + 1) % cards.length;
      tries++;
    }
    const card = cards[study.order[study.pos]];
    const done = cards.filter((c) => learned.has(cardKey(c))).length;
    if (study.id !== "weak") store.set("studyPos." + study.id, { order: study.order, pos: study.pos });
    saveLast("🃏", study.title, `${study.pos + 1} / ${cards.length}枚目｜覚えた ${done}語`);

    view.innerHTML = topbar(study.title, study.back) + `
      <div class="progress-line">
        <span>${study.pos + 1} / ${cards.length}</span>
        <span>今日 ${todayCount()} / ${goal()}</span>
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
        <button class="btn speak" id="speak">🔊 発音</button>
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
    $("#speak").onclick = () => study.revealed
      ? speech.speakSeq([card.w, card.e], C.lang, C.rateNormal)
      : speech.speak(card.w, C.lang, C.rateNormal);
    $("#skip").onchange = (e) => store.set("skipLearned", e.target.checked);
    $("#know").onclick = () => mark(card, true);
    $("#dontknow").onclick = () => mark(card, false);
  }

  function mark(card, ok) {
    const id = cardKey(card);
    const learned = new Set(store.get("learned", []));
    if (ok) learned.add(id); else learned.delete(id);
    store.set("learned", [...learned]);
    setWeak(card, !ok);
    countStudy();
    study.recent.push(card);
    if (study.recent.length > 12) study.recent.shift();
    study.sinceQuiz++;
    study.pos = (study.pos + 1) % study.cards.length;
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
    const pool = study.cards;
    const qs = shuffle([...study.recent]).slice(0, 5).map((card) => {
      const others = [...new Set(pool.filter((c) => c.m !== card.m).map((c) => c.m))];
      const wrong = shuffle(others).slice(0, 3);
      return { card, opts: shuffle([card.m, ...wrong]) };
    });
    quiz.qs = qs; quiz.pos = 0; quiz.score = 0;
    drawQuiz();
  }

  function drawQuiz() {
    if (quiz.pos >= quiz.qs.length) {
      const perfect = quiz.score === quiz.qs.length;
      view.innerHTML = topbar("確認テスト", study.back) + `
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
    view.innerHTML = topbar(`確認テスト ${quiz.pos + 1}/${quiz.qs.length}`, study.back) + `
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
        if (pick === q.card.m) { quiz.score++; setWeak(q.card, false); }
        else { b.classList.add("wrong"); setWeak(q.card, true); }
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
    mode: null, book: null, back: null, key: null, idx: 0, playing: false, timer: null,
    reset() {
      this.playing = false;
      clearTimeout(this.timer);
      this.timer = null;
    },
  };

  routes.play = (mode, bookIdx) => {
    player.reset();
    player.mode = mode;
    player.back = "books/" + mode;
    player.book = DATA.books[mode][+bookIdx];
    if (!player.book) { location.hash = "books/" + mode; return; }
    player.key = "play/" + mode + "/" + bookIdx;
    player.idx = restorePlayIdx();
    drawPlayer();
  };

  function restorePlayIdx() {
    const i = store.get("playPos", {})[player.key] | 0;
    return i < player.book.sentences.length ? i : 0;
  }

  function drawPlayer() {
    const b = player.book;
    const s = b.sentences[player.idx];
    const pos = store.get("playPos", {});
    pos[player.key] = player.idx;
    store.set("playPos", pos);
    const sh = player.mode === "shadowing";
    saveLast(sh ? "🗣️" : "🎧", b.title, `${sh ? "シャドーイング" : "聞き流し"}｜${player.idx + 1} / ${b.sentences.length}文目`);
    const withJa = store.get("playJa", true);
    const loop = store.get("playLoop", false);
    const speed = store.get("playSpeed", "標準");
    const speeds = { "とても遅い": 0.55, "遅い": 0.7, "標準": 0.9, "速い": 1.1 };

    view.innerHTML = topbar(b.title, player.back || ("books/" + player.mode), `${player.idx + 1} / ${b.sentences.length}文`) + `
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
    doTranslate.n++;
    const dir = store.get("transDir", "toForeign");
    const autoSpeak = store.get("transAutoSpeak", true);
    view.innerHTML = topbar("翻訳", "home") + `
      <div class="seg" id="dirseg">
        <button data-d="toForeign" class="${dir === "toForeign" ? "on" : ""}">日本語 → ${esc(C.langLabel)}</button>
        <button data-d="toJa" class="${dir === "toJa" ? "on" : ""}">${esc(C.langLabel)} → 日本語</button>
      </div>
      <div style="height:14px"></div>
      <textarea class="input" id="src" placeholder="${dir === "toForeign" ? "例：おはようございます" : C.examplePlaceholder}"></textarea>
      <div style="height:12px"></div>
      <button class="btn" id="go">${dir === "toForeign" ? esc(C.langLabel) + "に変換" : "日本語に変換"}</button>
      <div class="card" style="margin-top:14px;padding:2px 18px">
        <div class="opt-row"><span>🔊 自動で読み上げ</span><input type="checkbox" class="toggle" id="autospeak" ${autoSpeak ? "checked" : ""}></div>
      </div>
      <div id="out"></div>
      <p class="note">インターネット接続を使って翻訳します。長い文は分けて入力すると、より正確になります。</p>`;

    view.querySelectorAll("#dirseg button").forEach((b) => {
      b.onclick = () => { store.set("transDir", b.dataset.d); routes.translate(); };
    });
    $("#autospeak").onchange = (e) => store.set("transAutoSpeak", e.target.checked);
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
    // 上限超過などのエラー文もHTTP 200で返ってくるので、訳として表示しない
    if (json.responseStatus != 200) throw new Error(json.responseDetails || "mymemory");
    return (json.responseData && json.responseData.translatedText || "").trim();
  }

  /* ===== 例文（翻訳した語の使い方を見せる） ===== */
  // 単語や短い言い回しのときだけ例文を出す（長い文を訳したときは出さない）
  function isShortPhrase(text) {
    const t = (text || "").trim();
    if (!t || t.length > 26) return false;
    if (/[.!?。！？]\s*\S/.test(t)) return false;             // 文が2つ以上あれば単語ではない
    // 中国語・韓国語は空白で区切られないことがあるので、文字数でも判定する
    if ((C.mmLang === "zh" || C.mmLang === "ko") && t.replace(/[。！？.!?\s]/g, "").length > 8) return false;
    return t.split(/\s+/).filter(Boolean).length <= 3;
  }

  // アルファベット語は語の切れ目で一致させる（cat が category に当たらないように）
  function makeMatcher(word) {
    const n = word.trim().toLowerCase().replace(/[.!?。！？、,]+$/, "");
    if (!n) return null;
    const esc2 = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // 語尾が変わった形（promise→promised, eat→eating, cat→cats）も同じ語とみなす。
    // ただし別の語（cat→category）には当たらないよう、よくある語尾だけを許す
    // 短い語（he→her, an→and）は別の語になってしまうので、語尾変化は4文字以上の語だけ認める。
    // アポストロフィは語の切れ目として扱う（L'eau の eau、I'm の I に当たるように）
    const sfx = n.replace(/[^a-zà-ÿœæ]/gi, "").length >= 4 ? "(s|es|d|ed|ing|r|rs)?" : "(s|es)?";
    const latin = /^[a-zà-ÿœæ'’ -]+$/i.test(n)
      ? new RegExp(`(^|[^a-zà-ÿœæ])${esc2}${sfx}([^a-zà-ÿœæ]|$)`, "i") : null;
    // 漢字1文字は他の語の一部に紛れ込みやすい（「水」が「水果」に当たる等）ので拾い読みはしない
    const canScan = !!latin || n.length >= 2;
    return { n, canScan, test: (s) => (latin ? latin.test(String(s)) : String(s).toLowerCase().includes(n)) };
  }

  // 収録データ（単語カード・例文集）から、その語を使った文を拾う（通信なし・確実に自然な文）
  function localExamples(word, limit) {
    const m = makeMatcher(word);
    if (!m || !DATA) return [];
    const out = [], seen = new Set();
    const push = (t, ja) => {
      const k = String(t || "").trim();
      if (!k || seen.has(k) || out.length >= limit) return;
      seen.add(k);
      out.push({ t: k, ja: String(ja || "").trim() });
    };
    const levels = ["beginner", "intermediate", "advanced"];
    // 1) 見出し語がぴたりと一致する単語カードの例文を最優先
    for (const lv of levels) for (const it of (DATA.vocab && DATA.vocab[lv]) || []) {
      if (it.e && it.w && it.w.trim().toLowerCase() === m.n) push(it.e, it.ej);
    }
    if (m.canScan) {
      // 2) 単語カードの例文の中に出てくるもの
      for (const lv of levels) for (const it of (DATA.vocab && DATA.vocab[lv]) || []) {
        if (it.e && m.test(it.e)) push(it.e, it.ej);
      }
      // 3) シャドーイング・聞き流しの文の中に出てくるもの
      for (const mode of Object.keys(DATA.books || {})) {
        for (const b of DATA.books[mode] || []) for (const s of b.sentences || []) {
          if (s.t && m.test(s.t)) push(s.t, s.ja);
        }
      }
    }
    return out;
  }

  // 足りない分をAIに作ってもらう（キー未設定・失敗時は空を返す）
  async function aiExamples(word, want) {
    if (!C.aiKey || want <= 0) return [];
    const prompt = `${C.aiName}の「${word}」を使った例文を${want}つ作ってください。
・日常でよく使う、短くてやさしい文にする
・それぞれに自然な日本語訳をつける
・次の形のJSON配列だけを出力し、説明文は書かないでください
[{"t":"${C.aiName}の例文","ja":"日本語訳"}]`;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${C.aiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4 } }),
      });
      const json = await res.json();
      const parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
      const raw = parts.map((p) => p.text || "").join("");
      const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
      return arr.filter((x) => x && x.t)
        .map((x) => ({ t: String(x.t).trim(), ja: String(x.ja || "").trim() })).slice(0, want);
    } catch { return []; }
  }

  // 例文キャッシュは古いものから捨てて200語までにする（保存領域を使い切らないように）
  function cacheExamples(key, list) {
    const keys = store.get("exKeys", []).filter((k) => k !== key);
    keys.push(key);
    while (keys.length > 200) store.remove(keys.shift());
    store.set("exKeys", keys);
    store.set(key, list);
  }

  // 翻訳結果の下に例文カードを出す（収録データ→足りなければAIの順）
  async function showExamples(foreign) {
    const wrap = $("#exwrap");
    if (!wrap || !isShortPhrase(foreign)) return;
    const key = "ex." + C.mmLang + "." + foreign.trim().toLowerCase();
    let list = store.get(key, null);
    if (!list) {
      list = localExamples(foreign, 3);
      if (list.length < 3 && C.aiKey) {
        wrap.innerHTML = `<p class="note">例文をさがしています…</p>`;
        list = list.concat(await aiExamples(foreign, 3 - list.length)).slice(0, 3);
      }
      // AIで3件そろったとき（またはAIを使わない設定のとき）だけ保存。失敗・途中の結果は次回やり直す
      if (list.length >= 3 || (!C.aiKey && list.length)) cacheExamples(key, list);
    }
    if (!list.length) { wrap.innerHTML = ""; return; }
    wrap.innerHTML = `<div class="card ex-box">
        <div class="ex-head">「${esc(foreign)}」を つかった 例文</div>
        ${list.map((x, i) => `<div class="ex-row">
            <button class="btn speak small ex-play" data-i="${i}">🔊</button>
            <div><div class="ex-t">${esc(x.t)}</div>${x.ja ? `<div class="ex-ja">${esc(x.ja)}</div>` : ""}</div>
          </div>`).join("")}
      </div>`;
    wrap.querySelectorAll(".ex-play").forEach((b) => {
      b.onclick = () => speech.speak(list[+b.dataset.i].t, C.lang, C.rateNormal);
    });
  }

  doTranslate.n = 0;
  async function doTranslate() {
    const text = $("#src").value.trim();
    if (!text) return;
    const dir = store.get("transDir", "toForeign");
    const tok = ++doTranslate.n; // 翻訳中に画面を離れたり向きを切り替えたら、古い結果は捨てる
    const stale = () => tok !== doTranslate.n || !$("#out");
    $("#go").disabled = true;
    $("#go").textContent = "翻訳中…";
    try {
      const out = await translateText(text, dir);
      if (stale()) return;
      if (!out) throw new Error("empty");
      const foreign = dir === "toForeign" ? out : text;
      const ja = dir === "toForeign" ? text : out;
      $("#out").innerHTML = `
        <div class="card result-box">
          <div class="res">${esc(out)}</div>
          <div style="height:14px"></div>
          <div class="row">
            <button class="btn speak small" id="rspeak">🔊 発音</button>
            <button class="btn small" id="rsave">📒 保存</button>
          </div>
        </div>
        <div id="exwrap"></div>`;
      $("#rspeak").onclick = () => speech.speak(foreign, C.lang, C.rateNormal);
      $("#rsave").onclick = () => {
        const phrases = store.get("phrases", []);
        phrases.unshift({ ja, f: foreign, at: new Date().toISOString() });
        toast(store.set("phrases", phrases) ? "保存しました" : "保存できませんでした（端末の保存容量がいっぱいです）");
      };
      if (store.get("transAutoSpeak", true)) speech.speak(foreign, C.lang, C.rateNormal);
      showExamples(foreign);
    } catch {
      if (stale()) return;
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
              <button class="btn speak small" data-s="${i}" style="width:auto">🔊</button>
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
        <button class="btn speak" id="test${li}">🔊 この声を聞いてみる</button>`}
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

  /* ===== レッスン復習（先生のメモ → AIが復習カード化） ===== */
  function getDecks() { return store.get("decks", []); }
  function saveDecks(d) { store.set("decks", d); }

  routes.lessons = () => {
    const decks = getDecks();
    view.innerHTML = topbar("レッスン復習", "home") +
      `<button class="btn" style="margin-bottom:18px" onclick="location.hash='lessonnew'">＋ 先生のメモから作成</button>` +
      (decks.length === 0
        ? `<div class="empty">オンラインレッスンで先生が書いてくれた単語・表現・チャットを貼り付けると、AIが復習用の単語カードと例文を作ります。<br><br>作った復習カードはここに保存され、いつでも学習できます。</div>`
        : decks.map((d) => `
          <div class="card" style="margin-bottom:14px">
            <div style="font-size:1.2rem;font-weight:800">${esc(d.title)}</div>
            <div style="color:var(--fg-sub);font-weight:600;margin:4px 0 14px">${esc(d.date)}｜${d.cards.length}語</div>
            <button class="btn" onclick="location.hash='deck/${d.id}'">▶︎ 開く</button>
            <div class="row" style="margin-top:10px">
              <button class="btn ghost small" data-dl="${d.id}">⬇ 書き出し</button>
              <button class="btn ghost small" data-del="${d.id}">🗑 削除</button>
            </div>
          </div>`).join(""));
    view.querySelectorAll("[data-dl]").forEach((b) => (b.onclick = () => downloadDeck(b.dataset.dl)));
    view.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
      if (!confirm("この復習カードを削除しますか？")) return;
      saveDecks(getDecks().filter((x) => x.id !== b.dataset.del));
      routes.lessons();
    }));
  };

  // デッキを開くと、まず「一覧」（全情報が一目で読める復習ビュー）
  routes.deck = (id) => {
    const deck = getDecks().find((d) => d.id === id);
    if (!deck) { location.hash = "lessons"; return; }
    view.innerHTML = topbar(deck.title, "lessons", `${deck.date}｜${deck.cards.length}語`) + `
      <div class="seg" style="margin-bottom:16px">
        <button class="on">一覧</button>
        <button onclick="location.hash='deckcards/${id}'">カード</button>
        <button onclick="location.hash='decklisten/${id}'">リスニング</button>
      </div>
      <div class="review-list">${deck.cards.map((c, i) => reviewCardHtml(c, i)).join("")}</div>`;
    view.querySelectorAll("[data-say]").forEach((b) => (b.onclick = () => {
      const c = deck.cards[+b.dataset.say];
      speech.speak(c.e ? c.w + "。" + c.e : c.w, C.lang, C.rateNormal);
    }));
  };

  function reviewCardHtml(c, i) {
    return `<div class="card review-card">
      <button class="say-btn" data-say="${i}">🔊</button>
      <div class="rc-word">${esc(c.w)}</div>
      ${C.hasPinyin && c.p ? `<div class="rc-pinyin">${esc(c.p)}</div>` : ""}
      ${c.pos ? `<span class="pos-badge">${esc(c.pos)}</span>` : ""}
      <div class="rc-meaning">${esc(c.m)}</div>
      ${c.e ? `<div class="rc-ex">
        <div class="rc-ex-t">${esc(c.e)}</div>
        ${C.hasPinyin && c.ep ? `<div class="rc-ex-p">${esc(c.ep)}</div>` : ""}
        ${c.ej ? `<div class="rc-ex-ja">${esc(c.ej)}</div>` : ""}
      </div>` : ""}
    </div>`;
  }

  // カードで覚える（1枚ずつめくる・確認テスト付き）
  routes.deckcards = (id) => {
    const deck = getDecks().find((d) => d.id === id);
    if (!deck) { location.hash = "lessons"; return; }
    startStudy("deck_" + id, deck.cards, "deck/" + id, deck.title);
  };

  // 例文リスニング（デッキの例文を続けて再生）
  routes.decklisten = (id) => {
    const deck = getDecks().find((d) => d.id === id);
    if (!deck) { location.hash = "lessons"; return; }
    const sentences = deck.cards.filter((c) => c.e).map((c) => ({ t: c.e, ja: c.ej || "", p: c.ep || "" }));
    if (!sentences.length) { location.hash = "deck/" + id; return; }
    player.reset();
    player.mode = "listening";
    player.back = "deck/" + id;
    player.book = { title: deck.title + "（例文）", sentences };
    player.key = "decklisten/" + id;
    player.idx = restorePlayIdx();
    drawPlayer();
  };

  routes.lessonnew = () => {
    view.innerHTML = topbar("先生のメモから作成", "lessons") + `
      <p class="note" style="margin-top:0">レッスンで先生が書いてくれた単語・表現・チャットの内容を、そのまま貼り付けてください。AIが復習用の単語カードと例文を作ります。</p>
      <input class="input" id="title" style="min-height:auto;margin-bottom:12px" placeholder="タイトル（例：7/2 オンラインレッスン）">
      <textarea class="input" id="notes" placeholder="ここに先生のメモやチャットを貼り付け"></textarea>
      <div style="height:12px"></div>
      <button class="btn" id="make">復習カードを作成</button>
      <div id="mkout"></div>`;
    $("#make").onclick = makeDeck;
  };

  async function makeDeck() {
    const text = $("#notes").value.trim();
    if (!text) { toast("メモを貼り付けてください"); return; }
    if (!C.aiKey) { $("#mkout").innerHTML = `<p class="note" style="color:var(--ng)">AI機能が利用できないため、復習カードを作成できません。</p>`; return; }
    const btn = $("#make");
    btn.disabled = true;
    btn.textContent = "作成中…（10〜20秒ほど）";
    try {
      const cards = await extractDeck(text);
      if (!cards.length) throw new Error("empty");
      const now = new Date();
      const date = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
      const title = $("#title").value.trim() || (date + " のレッスン");
      const deck = { id: Date.now().toString(36), title, date, cards };
      saveDecks([deck, ...getDecks()]);
      toast(`${cards.length}語の復習カードを作成しました`);
      location.hash = "deck/" + deck.id;
    } catch {
      $("#mkout").innerHTML = `<p class="note" style="color:var(--ng)">うまく作成できませんでした。貼り付ける文章を短くするか、少し時間をおいてもう一度お試しください。</p>`;
      btn.disabled = false;
      btn.textContent = "復習カードを作成";
    }
  }

  async function extractDeck(text) {
    const schema = C.hasPinyin
      ? `各項目のキーは "w"(簡体字の語・表現), "p"(ピンイン・声調記号つき), "pos"(品詞を短い日本語で。例:名/動/形/副/量/表現), "m"(日本語の意味), "e"(その語を使った自然な中国語の例文), "ep"(例文のピンイン), "ej"(例文の日本語訳)。`
      : `各項目のキーは "w"(英単語または熟語・表現), "pos"(品詞を短い日本語で。例:名/動/形/副/前/熟語/表現), "m"(日本語の意味), "e"(その語を使った自然な英語の例文), "ej"(例文の日本語訳)。`;
    const prompt = `あなたは${C.aiName}のプロ講師です。以下はオンラインレッスンで先生が書いてくれたメモやチャットの内容です。この中から、生徒が後で復習すべき重要な単語・熟語・表現を抜き出し、復習用カードを作ってください。
条件:
- レッスンに実際に登場した語や表現を優先する
- 例文はその語の使い方が分かる自然なものにする
- 10〜20項目程度。重複は除く
- 出力はJSON配列のみ。前後に説明文やコードブロックを付けない
- ${schema}

--- レッスンのメモ ---
${text}`;
    // Geminiは一時的に503/429を返すことがあるため、指数バックオフで数回リトライ
    let json = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${C.aiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, responseMimeType: "application/json" } }),
      });
      if (res.ok) { json = await res.json(); break; }
      if (res.status !== 503 && res.status !== 429 && res.status !== 500) throw new Error("http " + res.status);
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
    if (!json) throw new Error("busy");
    const parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
    const raw = parts.map((p) => p.text || "").join("").trim();
    let parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) parsed = parsed.cards || parsed.items || parsed.list || [];
    return parsed
      .filter((c) => c && c.w && c.m)
      .slice(0, 40)
      .map((c) => ({ w: c.w, p: c.p || "", pos: c.pos || "", m: c.m, e: c.e || "", ep: c.ep || "", ej: c.ej || "" }));
  }

  function downloadDeck(id) {
    const deck = getDecks().find((d) => d.id === id);
    if (!deck) return;
    const lines = deck.cards.map((c, i) => {
      let s = `${i + 1}. ${c.w}`;
      if (C.hasPinyin && c.p) s += `（${c.p}）`;
      if (c.pos) s += ` [${c.pos}]`;
      s += `\n   意味: ${c.m}`;
      if (c.e) s += `\n   例文: ${c.e}`;
      if (C.hasPinyin && c.ep) s += `\n   例文ピンイン: ${c.ep}`;
      if (c.ej) s += `\n   訳: ${c.ej}`;
      return s;
    });
    const body = `${deck.title}（${deck.date}）\n${C.name} 復習カード\n\n${lines.join("\n\n")}\n`;
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${deck.title}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function shuffle(a) {
    const arr = [...a];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* ===== 起動 ===== */
  // 事前生成音声のマニフェストを読み込む（dataUrl の /data/xxx.json → /audio/xxx/ から）。
  // 無くても端末音声で動くので、失敗は無視する。
  // dataUrlの前置（"../"の有無等）に依存せず"data/xxx.json"部分だけをaudio/xxx/に変換する
  speech.audioBase = C.dataUrl.replace(/data\/([^/]+)\.json$/, "audio/$1/");
  const AUDIO_V = "9"; // 音声pack/manifestのキャッシュ更新用。packを作り直したら+1する（offsetが変わるため）
  fetch(speech.audioBase + "manifest.json?v=" + AUDIO_V)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => {
      if (m && m.clips) {
        speech.clips = m.clips;
        // packは同一オリジン(相対パス)か、別ホスト(絶対URL・容量の大きい言語はjack-invest.comに配置)
        const ref = m.pack || "pack.mp3";
        speech.pack = (/^https?:\/\//.test(ref) ? ref : speech.audioBase + ref) + "?v=" + AUDIO_V;
      }
    })
    .catch(() => {});

  fetch(C.dataUrl)
    .then((r) => r.json())
    .then((d) => { DATA = d; render(); })
    .catch(() => { view.innerHTML = `<div class="empty">データを読み込めませんでした。<br>再読み込みしてください。</div>`; });

  // ホーム画面に追加したときのオフライン対応（sw.js はサイト直下に置き、全言語で共有する）
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register(new URL("../sw.js", location.href), { scope: new URL("../", location.href).pathname }).catch(() => {});
    });
  }
})();
