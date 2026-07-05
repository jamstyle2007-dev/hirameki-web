#!/usr/bin/env python3
"""
個別mp3を1つの pack.mp3 に連結し、各クリップのバイト位置索引を作る。
GitHub Pagesは大量の小ファイル同期で失敗するため、ファイル数を激減させる。
連結された各クリップは元の完全なmp3のままなので、Range取得したバイト列は
そのまま単体mp3として再生できる（フレーム精度を維持）。

使い方: venv/bin/python tools/pack_audio.py <langkey>
出力: audio/<dir>/pack.mp3 と audio/<dir>/manifest.json（{pack, clips:{text:[offset,len]}}）
"""
import sys, os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIRS = {"eikaiwa": "eikaiwa", "chinese": "chinese", "korean": "korean",
        "french": "french", "spanish": "spanish"}

def main():
    if len(sys.argv) < 2 or sys.argv[1] not in DIRS:
        print("usage: pack_audio.py <eikaiwa|chinese|korean|french|spanish>")
        sys.exit(1)
    d = DIRS[sys.argv[1]]
    adir = os.path.join(ROOT, "audio", d)
    man_path = os.path.join(adir, "manifest.json")
    man = json.load(open(man_path, encoding="utf-8"))

    # 既にpack形式ならスキップ判定用に旧形式(text->filename)だけ受け付ける
    if isinstance(man, dict) and "clips" in man:
        print("既にpack形式です。個別mp3から作り直すには旧manifestが必要。中断。")
        sys.exit(1)

    clips = {}
    pack_path = os.path.join(adir, "pack.mp3")
    offset = 0
    missing = 0
    with open(pack_path, "wb") as out:
        for text in sorted(man.keys()):
            fn = man[text]
            fp = os.path.join(adir, fn)
            if not os.path.exists(fp):
                missing += 1
                continue
            data = open(fp, "rb").read()
            if not data:
                missing += 1
                continue
            out.write(data)
            clips[text] = [offset, len(data)]
            offset += len(data)

    new_man = {"pack": "pack.mp3", "clips": clips}
    json.dump(new_man, open(man_path, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(pack_path)
    print(f"[{sys.argv[1]}] pack.mp3 = {size/1024/1024:.1f}MB / クリップ {len(clips)}件 / 欠損 {missing}")
    print(f"  -> {pack_path}")
    print(f"  -> {man_path} (pack形式)")

if __name__ == "__main__":
    main()
