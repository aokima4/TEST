#!/usr/bin/env python3
"""検証用URL向けのビルドスクリプト。

使い方:
    python3 build-deploy.py <公開先のURL> <出力先フォルダ>
    例) python3 build-deploy.py https://nobori-aeo-test.vercel.app dist

やっていること:
  1. サイト内に書かれた本番ドメインを、指定した公開先URLに置き換える
     （canonical・sitemap・構造化データのURLがずれていると、
       検索エンジンが「本物は別の場所にある」と判断して検証用URLを登録しません）
  2. 「これは検証用のサンプルです」という帯をページ上部に差し込む
"""
import re, sys, os, shutil

REAL = "https://www.noboribata-gaityuu-partner.com"

BANNER_CSS = """
.sample-note{background:#16233a;color:#c9d6ea;padding:10px 20px;font-size:13px;line-height:1.7}
.sample-note p{max-width:960px;margin:0 auto}
.sample-note strong{color:#fff}
"""

BANNER_HTML = """<div class="sample-note">
  <p><strong>サンプルページ</strong>：AEO（AI検索最適化）の効果検証用に作成したページです。会社名・代表者名・住所・メールアドレス・料金・納期・実績・導入事例は、すべて架空の情報であり、実在の企業・サービスではありません。</p>
</div>
"""

def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    base, out = sys.argv[1].rstrip("/"), sys.argv[2]
    src = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out, exist_ok=True)

    for name in ("index.html", "robots.txt", "sitemap.xml", "llms.txt"):
        text = open(os.path.join(src, name), encoding="utf-8").read().replace(REAL, base)
        if name == "index.html":
            text = text.replace("</style>\n</head>", BANNER_CSS + "</style>\n</head>", 1)
            text = text.replace("<body>\n", "<body>\n" + BANNER_HTML, 1)
        open(os.path.join(out, name), "w", encoding="utf-8").write(text)
        print(f"  {name}")
    print(f"\n{base} 向けのファイルを {out}/ に書き出しました。")

if __name__ == "__main__":
    main()
