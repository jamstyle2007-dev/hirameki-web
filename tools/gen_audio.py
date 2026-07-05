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

def h(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:16]

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
    ap.add_argument("--concurrency", type=int, default=6)
    args = ap.parse_args()

    datafile, outdir, voice = LANGS[args.langkey]
    levels = [x.strip() for x in args.levels.split(",") if x.strip()]
    data = json.load(open(os.path.join(ROOT, datafile), encoding="utf-8"))
    texts = collect_texts(data, levels, args.books)

    audio_dir = os.path.join(ROOT, "audio", outdir)
    os.makedirs(audio_dir, exist_ok=True)

    # 既存マニフェストを読み込み（追記マージ）
    man_path = os.path.join(audio_dir, "manifest.json")
    manifest = {}
    if os.path.exists(man_path):
        manifest = json.load(open(man_path, encoding="utf-8"))

    print(f"[{args.langkey}] 音声={voice} levels={levels} books={args.books}")
    print(f"対象テキスト {len(texts)} 件 -> {audio_dir}")

    sem = asyncio.Semaphore(args.concurrency)
    tasks, todo = [], []
    for t in texts:
        fn = h(t) + ".mp3"
        manifest[t] = fn  # マニフェストは常に最新化
        fp = os.path.join(audio_dir, fn)
        if os.path.exists(fp) and os.path.getsize(fp) > 0:
            continue  # 生成済みはスキップ
        todo.append(t)
        tasks.append(gen_one(sem, voice, t, fp))

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
