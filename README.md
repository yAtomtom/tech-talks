# tech-talks

技術発表のスライド資料置き場。

## 一覧
- [youtube-chat-rearranger](./youtube-chat-rearranger/) — YouTubeチャット欄の配置を変更するChrome拡張の解説

## スライドPDFの生成例

`youtube-chat-rearranger/slide.md` をPDF化する例:

```bash
make marp-pdf
```

明示的に指定する場合:

```bash
make marp-pdf PROJECT_DIR=youtube-chat-rearranger MARP_INPUT=slide.md MARP_OUTPUT=slide.pdf
```
