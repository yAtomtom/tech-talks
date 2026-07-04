# tech-talks

技術発表のスライド資料置き場。サイトは [Eleventy](https://www.11ty.dev/)（テンプレート: Nunjucks）で生成する。

**公開サイト**: https://yatomtom.github.io/tech-talks/

## 一覧
- [youtube-chat-rearranger](./youtube-chat-rearranger/) — YouTubeチャット欄の配置を変更するChrome拡張の解説

発表の追加は `src/_data/talks.json` に1エントリ追加するだけ（トップページと紹介ページが自動生成される）。

## サイトのビルド（Eleventy）

```bash
npm ci            # 初回のみ（package-lock.json から依存を復元）
npm run build     # _site/ に静的サイトを生成
npm start         # ローカルプレビュー（http://localhost:8080/tech-talks/）
```

初回は `npm install` で `package-lock.json` を生成してコミットする。

## デプロイ（GitHub Pages）

`main` への push で GitHub Actions がビルドし Pages へ公開する。
リポジトリ設定で **Settings → Pages → Source = GitHub Actions** を選択すること。
ワークフローは `.github/workflows/deploy.yml` に配置する。

## スライドPDFの生成例

`youtube-chat-rearranger/slide.md` をPDF化する例:

```bash
make marp-pdf
```

明示的に指定する場合:

```bash
make marp-pdf PROJECT_DIR=youtube-chat-rearranger MARP_INPUT=slide.md MARP_OUTPUT=slide.pdf
```
