#!/usr/bin/env python3
"""iOS版ひらめき英会話/中国語のSwift埋め込みデータをJSONへ変換する。

- 単語カード: b()/i()/a() (英会話) / c() (中国語, 配列コンテキストでレベル判定)
- 聞き流し/シャドーイング: LevelPack -> Textbook -> s(原文, 日本語)
- 中国語はピンインを pypinyin で事前生成して埋め込む（Web側で動的生成しない）
"""
import json
import re
import sys
from pathlib import Path

from pypinyin import pinyin, Style

SRC = Path("/Users/jamstyle01/Documents/Claude/Projects/アプリ開発 (1)")
OUT = Path("/Users/jamstyle01/hirameki-web/data")

# Swiftの文字列リテラル（エスケープ対応）
STR = r'"((?:[^"\\]|\\.)*)"'


def unescape(s: str) -> str:
    return s.replace('\\"', '"').replace("\\n", "\n").replace("\\\\", "\\")


def parse_calls(text: str, funcs: str) -> list[tuple]:
    """f("a", "b", "c", "d") 形式の呼び出しを (func, args...) で列挙する。"""
    pat = re.compile(rf'\b({funcs})\(\s*{STR}\s*,\s*{STR}\s*,\s*{STR}\s*,\s*{STR}\s*\)')
    return [(m.group(1),) + tuple(unescape(g) for g in m.groups()[1:]) + (m.start(),)
            for m in pat.finditer(text)]


def parse_vocab_eikaiwa(text: str) -> dict:
    levels = {"b": "beginner", "i": "intermediate", "a": "advanced"}
    out = {"beginner": [], "intermediate": [], "advanced": []}
    for f, w, m, e, ej, _ in parse_calls(text, "b|i|a"):
        out[levels[f]].append({"w": w, "m": m, "e": e, "ej": ej})
    return out


def parse_vocab_chinese(text: str) -> dict:
    # レベルは配列宣言の位置で判定
    markers = []
    for name in ("beginner", "intermediate", "advanced"):
        m = re.search(rf"static let {name}: \[VocabCard\] = \[", text)
        if m:
            markers.append((m.start(), name))
    markers.sort()
    out = {"beginner": [], "intermediate": [], "advanced": []}
    for _, h, m, e, ej, pos in parse_calls(text, "c"):
        level = None
        for start, name in markers:
            if pos >= start:
                level = name
        if level:
            py = to_pinyin(h)
            out[level].append({"w": h, "p": py, "m": m, "e": e, "ej": ej,
                               "ep": to_pinyin(e)})
    return out


def to_pinyin(s: str) -> str:
    parts = pinyin(s, style=Style.TONE, errors=lambda x: [x])
    return " ".join(p[0] for p in parts).strip()


def parse_books(text: str, zh: bool) -> dict:
    """LevelPack/Textbook/s() を線形走査で親子付けし、shadowing/listeningに分ける。"""
    listening_start = text.find("static let listeningPacks")
    level_pat = re.compile(r"LevelPack\(level: \.(\w+)")
    book_pat = re.compile(rf"Textbook\(title:\s*{STR}")
    sent_pat = re.compile(rf"\bs\(\s*{STR}\s*,\s*{STR}\s*\)")
    events = []
    for m in level_pat.finditer(text):
        events.append((m.start(), "level", m.group(1)))
    for m in book_pat.finditer(text):
        events.append((m.start(), "book", unescape(m.group(1))))
    for m in sent_pat.finditer(text):
        events.append((m.start(), "sent", (unescape(m.group(1)), unescape(m.group(2)))))
    events.sort()
    out = {"shadowing": [], "listening": []}
    cur_level, cur_book = None, None
    for pos, kind, val in events:
        if kind == "level":
            cur_level = val
        elif kind == "book":
            mode = "listening" if 0 <= listening_start <= pos else "shadowing"
            cur_book = {"level": cur_level, "title": val, "sentences": []}
            out[mode].append(cur_book)
        elif kind == "sent" and cur_book is not None:
            t, ja = val
            sent = {"t": t, "ja": ja}
            if zh:
                sent["p"] = to_pinyin(t)
            cur_book["sentences"].append(sent)
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    ek_vocab = parse_vocab_eikaiwa(
        (SRC / "HiramekiEikaiwa/HiramekiEikaiwa/VocabCards.swift").read_text())
    ek_books = parse_books(
        (SRC / "HiramekiEikaiwa/HiramekiEikaiwa/ContentView.swift").read_text(), zh=False)
    (OUT / "eikaiwa.json").write_text(json.dumps(
        {"vocab": ek_vocab, "books": ek_books}, ensure_ascii=False), encoding="utf-8")

    zh_vocab = parse_vocab_chinese(
        (SRC / "HiramekiChinese/HiramekiChinese/VocabData.swift").read_text())
    zh_books = parse_books(
        (SRC / "HiramekiChinese/HiramekiChinese/ContentView.swift").read_text(), zh=True)
    (OUT / "chinese.json").write_text(json.dumps(
        {"vocab": zh_vocab, "books": zh_books}, ensure_ascii=False), encoding="utf-8")

    for name, v, b in (("英会話", ek_vocab, ek_books), ("中国語", zh_vocab, zh_books)):
        counts = {k: len(x) for k, x in v.items()}
        for mode in ("shadowing", "listening"):
            n_sent = sum(len(x["sentences"]) for x in b[mode])
            print(f"{name} {mode}: books={len(b[mode])} sentences={n_sent}")
        print(f"{name}: vocab={counts}")


if __name__ == "__main__":
    sys.exit(main())
