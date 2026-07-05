#!/usr/bin/env python3
"""
ひらめき語学: 事前音声生成ツール（Microsoft Neural 音声 / edge-tts・無料）
data/<lang>.json から単語・例文・本文のテキストを集め、mp3を生成して
audio/<langdir>/ に保存。manifest.json（テキスト→ファイル名）も出力する。

使い方:
  venv/bin/python tools/gen_audio.py <langkey> [--levels beginner,intermediate,advanced] [--books]
  例: ~/hirameki-voice/venv/bin/python tools/gen_audio.py eikaiwa --levels beginner
既に存在するmp3はスキップ（再開可能）。
"""
import sys, os, json, hashlib, asyncio, argparse
import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# langkey -> (dataファイル, 出力ディレクトリ名, 音声名)
LANGS = {
    "eikaiwa":  ("data/eikaiwa.json", "eikaiwa", "en-US-AriaNeural"),
    "chinese":  ("data/chinese.json", "chinese", "zh-CN-XiaoxiaoNeural"),
    "korean":   ("data/korean.json",  "korean",  "ko-KR-SunHiNeural"),
    "french":   ("data/french.json",  "french",  "fr-FR-DeniseNeural"),
    "spanish":  ("data/spanish.json", "spanish", "es-ES-ElviraNeural"),
}

JA_VOICE = "ja-JP-NanamiNeural"  # 日本語訳はWindowsと同じNanamiで統一する

def h(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:16]

def collect_ja(data):
    """本文(シャドーイング/聞き流し)の日本語訳を集める。これはNanamiで読み上げる。"""
    texts = set()
    for kind in ("shadowing", "listening"):
        for book in data.get("books", {}).get(kind, []):
            for s in book.get("sentences", []):
                if s.get("ja"): texts.add(s["ja"].strip())
    return sorted(t for t in texts if t)

def collect_texts(data, levels, include_books):
    """発音対象の外国語テキストを集める（重複除去）。日本語(m/ej/ja)は対象外。"""
    texts = set()
    vocab = data.get("vocab", {})
    for lvl in levels:
        for card in vocab.get(lvl, []):
            if card.get("w"): texts.add(card["w"].strip())
            if card.get("e"): texts.add(card["e"].strip())
    if include_books:
        for kind in ("shadowing", "listening"):
            for book in data.get("books", {}).get(kind, []):
                for s in book.get("sentences", []):
                    if s.get("t"): texts.add(s["t"].strip())
    return sorted(t for t in texts if t)

async def gen_one(sem, voice, text, path, retries=4):
    async with sem:
        for attempt in range(retries):
            try:
                comm = edge_tts.Communicate(text, voice)
                await comm.save(path)
                if os.path.getsize(path) > 0:
                    return True
                raise RuntimeError("empty file")
            except Exception as e:
                if os.path.exists(path):
                    try: os.remove(path)
                    except OSError: pass
                if attempt == retries - 1:
                    print(f"  ✗ 失敗: {text[:40]!r} ({e})")
                    return False
                await asyncio.sleep(1.5 * (attempt + 1))

async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("langkey", choices=LANGS.keys())
    ap.add_argument("--levels", default="beginner,intermediate,advanced")
    ap.add_argument("--books", action="store_true")
    ap.add_argument("--ja", action="store_true", help="本文の日本語訳もNanami音声で生成")
    ap.add_argument("--concurrency", type=int, default=6)
    args = ap.parse_args()

    datafile, outdir, voice = LANGS[args.langkey]
    levels = [x.strip() for x in args.levels.split(",") if x.strip()]
    data = json.load(open(os.path.join(ROOT, datafile), encoding="utf-8"))

    # テキスト→音声名 の対応（外国語=言語の声、日本語訳=Nanami）
    voice_map = {}
    for t in collect_texts(data, levels, args.books):
        voice_map[t] = voice
    if args.ja:
        for t in collect_ja(data):
            voice_map.setdefault(t, JA_VOICE)  # 既存キーは上書きしない

    audio_dir = os.path.join(ROOT, "audio", outdir)
    os.makedirs(audio_dir, exist_ok=True)

    # 既存マニフェストを読み込み（text->filename形式のみ追記マージ。pack形式なら作り直す）
    man_path = os.path.join(audio_dir, "manifest.json")
    manifest = {}
    if os.path.exists(man_path):
        old = json.load(open(man_path, encoding="utf-8"))
        if isinstance(old, dict) and "clips" not in old:
            manifest = old

    print(f"[{args.langkey}] 外国語={voice} / 日本語={JA_VOICE if args.ja else '-'} levels={levels} books={args.books}")
    print(f"対象テキスト {len(voice_map)} 件（うち日本語訳 {sum(1 for v in voice_map.values() if v==JA_VOICE)} 件）-> {audio_dir}")

    sem = asyncio.Semaphore(args.concurrency)
    tasks, todo = [], []
    for t, v in voice_map.items():
        fn = h(t) + ".mp3"
        manifest[t] = fn  # マニフェストは常に最新化
        fp = os.path.join(audio_dir, fn)
        if os.path.exists(fp) and os.path.getsize(fp) > 0:
            continue  # 生成済みはスキップ
        todo.append(t)
        tasks.append(gen_one(sem, v, t, fp))

    print(f"未生成 {len(todo)} 件を生成します…")
    done = 0
    ok = 0
    # 進捗表示のため少しずつ回す
    CH = 200
    for i in range(0, len(tasks), CH):
        results = await asyncio.gather(*tasks[i:i+CH])
        ok += sum(1 for r in results if r)
        done += len(results)
        print(f"  {done}/{len(tasks)} 完了（成功 {ok}）")

    json.dump(manifest, open(man_path, "w", encoding="utf-8"),
              ensure_ascii=False, indent=0)
    total = sum(1 for f in os.listdir(audio_dir) if f.endswith(".mp3"))
    print(f"完了。mp3合計 {total} 件・manifest {len(manifest)} 件 -> {man_path}")

if __name__ == "__main__":
    asyncio.run(main())
