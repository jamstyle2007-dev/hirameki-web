#!/usr/bin/env python3
"""
ひらめき語学: 検索流入用の静的ページを data/<lang>.json から自動生成する。

  <lang>/words/                     レベル別の単語一覧の目次
  <lang>/words/<level>/<n>/         単語一覧（1ページ50語・意味と例文つき）
  <lang>/texts/                     シャドーイング/聞き流し教材の目次
  <lang>/texts/<kind>-<i>/          教材の本文と日本語訳
  sitemap.xml                       上記を含めて作り直す

使い方: python3 tools/gen_seo_pages.py
data/*.json を更新したら実行し直す（生成物は毎回まるごと作り直す）。
"""
import html
import json
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://apps.jack-invest.com"
PER_PAGE = 50
ASSET_V = "12"  # shared/app.css・seo.js のキャッシュ番号
LANGS = ["eikaiwa", "chinese", "korean", "french", "spanish"]
LEVELS = [("beginner", "初級"), ("intermediate", "中級"), ("advanced", "上級")]
KINDS = [("shadowing", "シャドーイング", "🗣️"), ("listening", "聞き流し", "🎧")]
AD = """<div class="ad-bottom">
  <ins class="adsbygoogle" style="display:inline-block;width:320px;height:50px"
       data-ad-client="ca-pub-1152026485973831"
       data-ad-slot="5755851567"></ins>
</div>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>"""

e = lambda s: html.escape(str(s), quote=True)


def lang_config(lang):
    """アプリ本体の index.html からテーマや表示名を読み取る（設定を二重管理しないため）。"""
    src = open(os.path.join(ROOT, lang, "index.html"), encoding="utf-8").read()
    pick = lambda pat: re.search(pat, src).group(1)
    subs = dict(re.findall(r'(beginner|intermediate|advanced): "([^"]*)"', pick(r"levelSubtitles: \{([^}]*)\}")))
    return {
        "name": pick(r'name: "([^"]*)"'),
        "icon": pick(r'icon: "([^"]*)"'),
        "label": pick(r'langLabel: "([^"]*)"'),
        "lang": pick(r'lang: "([^"]*)"'),
        "theme": pick(r'<body class="([^"]*)"'),
        "color": pick(r'name="theme-color" content="([^"]*)"'),
        "subs": subs,
        "dir": lang,
    }


def page(cfg, path, title, desc, body, depth, crumbs):
    """共通レイアウト。depth は サイトルートからの階層数（相対パス用）。"""
    up = "../" * depth
    crumb_html = " › ".join(
        f'<a href="{up}{href}">{e(t)}</a>' if href is not None else f"<span>{e(t)}</span>" for t, href in crumbs
    )
    ld = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": t, **({"item": f"{SITE}/{href}"} if href is not None else {})}
            for i, (t, href) in enumerate(crumbs)
        ],
    }
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{SITE}/{path}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:type" content="article">
<meta property="og:image" content="{SITE}/assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="{cfg['color']}">
<link rel="stylesheet" href="{up}shared/app.css?v={ASSET_V}">
<script src="{up}shared/adsense.js?v=9"></script>
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
</head>
<body class="{cfg['theme']}">
<!-- tools/gen_seo_pages.py で自動生成。直接編集しない -->
<div class="bg"><div class="blob b1"></div><div class="blob b2"></div></div>
<main class="wrap seo" data-lang="{cfg['lang']}" data-audio="{up}audio/{cfg['dir']}/">
<nav class="crumbs">{crumb_html}</nav>
{body}
<div class="footer">
  <a href="{up}">ひらめき語学シリーズ</a>｜<a href="{up}privacy/">プライバシーポリシー</a>
</div>
</main>
<script src="{up}shared/seo.js?v={ASSET_V}"></script>
{AD}
</body>
</html>
"""


def cta(up, lang, hash_, text):
    return f'<a class="btn cta" href="{up}{lang}/#{hash_}">{e(text)}</a>'


def say(text):
    return f'<button class="say" data-say="{e(text)}" aria-label="発音を聞く">🔊</button>'


def write(path, content):
    full = os.path.join(ROOT, path, "index.html")
    os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, "w", encoding="utf-8").write(content)


def gen_lang(lang):
    cfg = lang_config(lang)
    data = json.load(open(os.path.join(ROOT, "data", lang + ".json"), encoding="utf-8"))
    L, name = cfg["label"], cfg["name"]
    urls = []
    for sub in ("words", "texts"):
        shutil.rmtree(os.path.join(ROOT, lang, sub), ignore_errors=True)

    # ---- 単語一覧 ----
    toc = []
    for lv, lv_label in LEVELS:
        cards = data["vocab"].get(lv, [])
        pages = [cards[i:i + PER_PAGE] for i in range(0, len(cards), PER_PAGE)]
        links = []
        for n, chunk in enumerate(pages, 1):
            a, b = (n - 1) * PER_PAGE + 1, (n - 1) * PER_PAGE + len(chunk)
            path = f"{lang}/words/{lv}/{n}/"
            links.append(f'<a class="chip" href="{lv}/{n}/">{a}〜{b}</a>')
            head = "、".join(c["w"] for c in chunk[:6])
            title = f"{L}{lv_label}単語 {a}〜{b}｜意味と例文つき一覧 - {name}"
            desc = (f"{L}の{lv_label}単語（{cfg['subs'].get(lv, '')}）{a}〜{b}語目を、日本語の意味と例文・訳つきで一覧にしました。"
                    f"{head} など。音声つきで無料で練習できます。")
            items = "".join(f"""
<li class="card wl">
  <div class="wl-head">{say(c['w'])}<span class="wl-w" lang="{cfg['lang']}">{e(c['w'])}</span>{f'<span class="wl-p">{e(c["p"])}</span>' if c.get('p') else ''}</div>
  <div class="wl-m">{e(c['m'])}</div>
  {f'''<div class="wl-ex">{say(c['e'])}<div><div lang="{cfg['lang']}">{e(c['e'])}</div>{f'<div class="wl-p">{e(c["ep"])}</div>' if c.get('ep') else ''}<div class="wl-ja">{e(c.get('ej', ''))}</div></div></div>''' if c.get('e') else ''}
</li>""" for c in chunk)
            pager = []
            if n > 1:
                pager.append(f'<a class="btn" href="../{n - 1}/">‹ 前の{PER_PAGE}語</a>')
            if n < len(pages):
                pager.append(f'<a class="btn" href="../{n + 1}/">次の{PER_PAGE}語 ›</a>')
            body = f"""<h1 class="seo-h1">{e(L)}{lv_label}単語 {a}〜{b}</h1>
<p class="note">{e(cfg['subs'].get(lv, ''))}｜全{len(cards)}語中 {a}〜{b}語目。🔊 で発音を聞けます。</p>
{cta('../../../../', lang, 'study/' + lv, '🃏 この単語をカードで覚える（無料）')}
<ol class="wlist" start="{a}">{items}
</ol>
<div class="pager">{''.join(pager)}</div>
<p class="note"><a href="../../">{e(L)}単語一覧の目次へ戻る</a></p>"""
            write(path, page(cfg, path, title, desc, body, 4,
                             [(name, f"{lang}/"), ("単語一覧", f"{lang}/words/"), (f"{lv_label} {a}〜{b}", None)]))
            urls.append(path)
        toc.append(f"""<section class="card toc">
  <h2>{lv_label}<span class="d">{e(cfg['subs'].get(lv, ''))}｜{len(cards)}語</span></h2>
  <div class="chips">{''.join(links)}</div>
</section>""")
    total = sum(len(v) for v in data["vocab"].values())
    path = f"{lang}/words/"
    body = f"""<h1 class="seo-h1">{cfg['icon']} {e(L)}単語一覧（{total:,}語）</h1>
<p class="note">初級・中級・上級のレベル別に、{e(L)}の単語を日本語の意味と例文つきでまとめました。{PER_PAGE}語ずつ見られます。</p>
{cta('../../', lang, 'vocab', '🃏 単語カードで覚える（無料・音声つき）')}
{''.join(toc)}
<p class="note"><a href="../texts/">{e(L)}のシャドーイング・聞き流し教材の本文はこちら</a></p>"""
    write(path, page(cfg, path, f"{L}単語一覧 {total:,}語｜初級・中級・上級の意味と例文 - {name}",
                     f"{L}の単語{total:,}語をレベル別に、日本語の意味と例文・訳つきで一覧にしました。音声つきの単語カードで無料で覚えられます。",
                     body, 2, [(name, f"{lang}/"), ("単語一覧", None)]))
    urls.insert(0, path)

    # ---- 教材本文 ----
    toc = []
    for kind, kind_label, icon in KINDS:
        books = data["books"].get(kind, [])
        rows = []
        for i, bk in enumerate(books):
            lv_label = dict(LEVELS).get(bk.get("level"), "")
            path = f"{lang}/texts/{kind}-{i}/"
            rows.append(f'<a class="list-item" href="{kind}-{i}/"><span><span class="t">{e(bk["title"])}</span><br>'
                        f'<span class="d">{lv_label}｜{len(bk["sentences"])}文</span></span><span class="chev">›</span></a>')
            sents = "".join(f"""
<li class="card wl">
  <div class="wl-ex">{say(s['t'])}<div><div lang="{cfg['lang']}">{e(s['t'])}</div>{f'<div class="wl-p">{e(s["p"])}</div>' if s.get('p') else ''}<div class="wl-ja">{e(s.get('ja', ''))}</div></div></div>
</li>""" for s in bk["sentences"])
            first = bk["sentences"][0]["ja"] if bk["sentences"] else ""
            body = f"""<h1 class="seo-h1">{icon} {e(bk['title'])}</h1>
<p class="note">{e(L)}{kind_label}教材（{lv_label}）｜全{len(bk['sentences'])}文・日本語訳つき</p>
{cta('../../../', lang, f'play/{kind}/{i}', f'{icon} 音声つきで{kind_label}する（無料）')}
<ol class="wlist">{sents}
</ol>
<p class="note">{'お手本の音声のあとに、同じ文を声に出して言ってみましょう。' if kind == 'shadowing' else '家事や通勤中に流して、耳を慣らしましょう。'}</p>
<p class="note"><a href="../">{e(L)}の教材一覧へ戻る</a></p>"""
            write(path, page(cfg, path, f"{L}{kind_label}「{bk['title']}」（{lv_label}）本文と日本語訳 - {name}",
                             f"{L}の{kind_label}教材「{bk['title']}」（{lv_label}・{len(bk['sentences'])}文）の本文と日本語訳。{first}など。音声つきで無料で練習できます。",
                             body, 3, [(name, f"{lang}/"), ("教材一覧", f"{lang}/texts/"), (bk["title"], None)]))
            urls.append(path)
        toc.append(f'<h2 class="seo-h2">{icon} {kind_label}</h2><div class="list">{"".join(rows)}</div>')
    path = f"{lang}/texts/"
    body = f"""<h1 class="seo-h1">{cfg['icon']} {e(L)}のシャドーイング・聞き流し教材</h1>
<p class="note">日常の場面をテーマにした{e(L)}の短い文章を、本文と日本語訳つきで掲載しています。</p>
{''.join(toc)}
<p class="note"><a href="../words/">{e(L)}単語一覧はこちら</a></p>"""
    write(path, page(cfg, path, f"{L}シャドーイング・聞き流し教材 本文と日本語訳 - {name}",
                     f"{L}のシャドーイング・聞き流し用の教材を、レベル別に本文と日本語訳つきで掲載。音声つきで無料で練習できます。",
                     body, 2, [(name, f"{lang}/"), ("教材一覧", None)]))
    urls.insert(1, path)
    return urls


def main():
    sitemap = [("", "weekly", "1.0")]
    for lang in LANGS:
        sitemap.append((f"{lang}/", "weekly", "0.9"))
        urls = gen_lang(lang)
        sitemap += [(u, "monthly", "0.7" if u.endswith(("/words/", "/texts/")) else "0.6") for u in urls]
        print(f"{lang}: {len(urls)} ページ")
    sitemap.append(("privacy/", "yearly", "0.2"))
    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    xml += [f"  <url><loc>{SITE}/{u}</loc><changefreq>{f}</changefreq><priority>{p}</priority></url>" for u, f, p in sitemap]
    xml.append("</urlset>")
    open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8").write("\n".join(xml) + "\n")
    print(f"sitemap.xml: {len(sitemap)} URL")


if __name__ == "__main__":
    main()
