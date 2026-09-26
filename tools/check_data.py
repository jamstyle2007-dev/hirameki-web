#!/usr/bin/env python3
"""
ひらめき語学: データ品質チェック
data/<lang>.json と audio/<lang>/manifest.json を突き合わせて、
訳抜け・重複・前後の空白・音声の欠け・言語の取り違えを一覧にする。

使い方:
  python3 tools/check_data.py            # 全言語
  python3 tools/check_data.py korean     # 1言語だけ
問題があれば終了コード1（CIやpush前チェックに使える）。
"""
import sys, os, json, re
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANGS = ["eikaiwa", "chinese", "korean", "french", "spanish"]
LEVELS = ["beginner", "intermediate", "advanced"]

KANA = re.compile(r"[぀-ヿ]")      # ひらがな・カタカナ（外国語側に混入していないか）
HANGUL = re.compile(r"[가-힯]")
LATIN = re.compile(r"[A-Za-z]")


def foreign_ok(lang, text):
    """外国語テキストがその言語らしい文字を含むか（取り違え検出用のゆるい判定）。"""
    if lang == "korean":
        return bool(HANGUL.search(text))
    if lang == "chinese":
        return bool(re.search(r"[一-鿿]", text))
    return bool(LATIN.search(text))


def check(lang):
    data = json.load(open(os.path.join(ROOT, "data", lang + ".json"), encoding="utf-8"))
    mpath = os.path.join(ROOT, "audio", lang, "manifest.json")
    clips = json.load(open(mpath, encoding="utf-8")).get("clips", {}) if os.path.exists(mpath) else None
    issues = defaultdict(list)  # 種類 -> [説明]

    def audio(text, where):
        if clips is not None and text.strip() and text.strip() not in clips:
            issues["音声なし"].append(f"{where}: {text}")

    def ws(text, where):
        if text != text.strip() or "  " in text:
            issues["余分な空白"].append(f"{where}: {text!r}")

    notes = defaultdict(list)  # 問題ではないが参考として出すもの
    seen = {}
    for lvl in LEVELS:
        seen_lvl = {}
        for i, c in enumerate(data.get("vocab", {}).get(lvl, [])):
            where = f"vocab.{lvl}[{i}]"
            for k in ("w", "m", "e", "ej"):
                v = c.get(k, "")
                if not isinstance(v, str) or not v.strip():
                    issues["空欄"].append(f"{where}.{k} ({c.get('w', '?')})")
                    continue
                ws(v, f"{where}.{k}")
            w, e = c.get("w", "").strip(), c.get("e", "").strip()
            for k in ("w", "e"):
                v = c.get(k, "")
                if v and KANA.search(v):
                    issues["外国語欄に日本語"].append(f"{where}.{k}: {v}")
                elif v and not foreign_ok(lang, v):
                    issues["外国語欄の文字が不自然"].append(f"{where}.{k}: {v}")
            for k in ("m", "ej"):
                v = c.get(k, "")
                if v and lang == "korean" and HANGUL.search(v):
                    issues["日本語欄に外国語"].append(f"{where}.{k}: {v}")
            if w:
                key = w.lower()
                if key in seen_lvl:
                    issues["同じレベル内の単語の重複"].append(f"{w}  ({seen_lvl[key]} と {where})")
                elif key in seen:
                    # 同音異義語（사과=りんご/謝罪 など）や上のレベルでの再登場があるので問題扱いしない
                    notes["レベルをまたぐ同じ単語"].append(f"{w}  ({seen[key]} と {where})")
                seen_lvl.setdefault(key, where)
                seen.setdefault(key, where)
                audio(w, where + ".w")
            if e:
                audio(e, where + ".e")

    for kind in ("shadowing", "listening"):
        titles = {}
        for bi, book in enumerate(data.get("books", {}).get(kind, [])):
            bwhere = f"{kind}[{bi}]「{book.get('title', '?')}」"
            t = book.get("title", "")
            if t in titles:
                issues["教材タイトルの重複"].append(f"{t} ({titles[t]} と {bwhere})")
            titles[t] = bwhere
            if not book.get("sentences"):
                issues["空欄"].append(f"{bwhere}: 本文なし")
            for si, s in enumerate(book.get("sentences", [])):
                where = f"{bwhere}#{si + 1}"
                for k in ("t", "ja"):
                    v = s.get(k, "")
                    if not isinstance(v, str) or not v.strip():
                        issues["空欄"].append(f"{where}.{k}")
                    else:
                        ws(v, f"{where}.{k}")
                if s.get("t"):
                    if KANA.search(s["t"]):
                        issues["外国語欄に日本語"].append(f"{where}.t: {s['t']}")
                    audio(s["t"], where)
                if s.get("ja"):
                    audio(s["ja"], where + ".ja")

    return data, clips, issues, notes


def main():
    targets = sys.argv[1:] or LANGS
    total = 0
    for lang in targets:
        data, clips, issues, notes = check(lang)
        n_vocab = sum(len(data.get("vocab", {}).get(l, [])) for l in LEVELS)
        n_books = sum(len(v) for v in data.get("books", {}).values())
        n = sum(len(v) for v in issues.values())
        total += n
        print(f"\n=== {lang}: 単語 {n_vocab} / 教材 {n_books} / 音声クリップ {len(clips) if clips is not None else 'なし'} → 問題 {n} 件")
        for kind, items in sorted(issues.items(), key=lambda x: -len(x[1])):
            print(f"  [{kind}] {len(items)} 件")
            for it in items[:15]:
                print(f"    - {it}")
            if len(items) > 15:
                print(f"    …ほか {len(items) - 15} 件")
        for kind, items in notes.items():
            print(f"  (参考) {kind}: {len(items)} 件")
    print(f"\n合計 {total} 件")
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
