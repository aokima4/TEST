#!/usr/bin/env python3
"""検証用URL向けのビルドスクリプト。

使い方:
    python3 build-deploy.py <公開先のURL> <出力先フォルダ>
    例) python3 build-deploy.py https://nobori-aeo-test.vercel.app dist

やっていること:
  1. サイト内に書かれた本番ドメインを、指定した公開先URLに置き換える
     （canonical・sitemap・構造化データのURLがずれていると、
       検索エンジンが「本物は別の場所にある」と判断して検証用URLを登録しません）
  2. 「これは検証用のサンプルです」という注意書きを（画面には出ない形で）差し込む
  3. 編集者向けのメモ（HTML/CSSのコメント、仮データの目印 class="todo"）を
     取り除く。閲覧者には何の影響もない情報なので、公開版には入れない。
"""
import re, sys, os, shutil

REAL = "https://www.noboribata-gaityuu-partner.com"

# 画面には出ないが、ページのソースを見た人には分かる形の注意書き。
# 表示されないので、閲覧者の読み心地にも、AIの読み取りにも影響しません。
SAMPLE_NOTE = """<!--
  このページは AEO（AI検索最適化）の効果検証用に作成したサンプルです。
  会社名・代表者名・住所・メールアドレス・料金・納期・実績・導入事例は、
  すべて架空の情報であり、実在の企業・サービスではありません。
-->
"""


def strip_editor_notes(html):
    """編集者向けのメモを取り除く（公開版には不要）。"""
    # 仮データの目印（画面上は見た目が変わらないタグ）を外す
    html = re.sub(r'<span class="todo">(.*?)</span>', r"\1", html, flags=re.S)
    html = re.sub(r'(<[^>]*?class="[^"]*?)\s*\btodo\b\s*([^"]*?")', r"\1\2", html)
    html = re.sub(r'\s*class=""', "", html)
    # HTML コメントと CSS コメント
    html = re.sub(r"<!--.*?-->\n?", "", html, flags=re.S)
    html = re.sub(r"/\*.*?\*/\n?", "", html, flags=re.S)
    # コメント除去で生まれた3行以上の空行を詰める
    return re.sub(r"\n{3,}", "\n\n", html)


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    base, out = sys.argv[1].rstrip("/"), sys.argv[2]
    src = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out, exist_ok=True)

    # Google Search Console の所有権確認ファイル（google...html）も必ず一緒に配る。
    # これが欠けると「所有権が確認できません」と言われ、登録が外れてしまう。
    names = ["index.html", "robots.txt", "sitemap.xml", "llms.txt"]
    names += sorted(f for f in os.listdir(src)
                    if f.startswith("google") and f.endswith(".html"))

    for name in names:
        text = open(os.path.join(src, name), encoding="utf-8").read().replace(REAL, base)
        if name == "index.html":
            text = strip_editor_notes(text)
            text = text.replace("<!DOCTYPE html>\n", "<!DOCTYPE html>\n" + SAMPLE_NOTE, 1)
        open(os.path.join(out, name), "w", encoding="utf-8").write(text)
        print(f"  {name}")
    print(f"\n{base} 向けのファイルを {out}/ に書き出しました。")

if __name__ == "__main__":
    main()
