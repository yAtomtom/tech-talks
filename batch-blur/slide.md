---
marp: true
paginate: true
math: katex
---

<style>
section blockquote>blockquote>blockquote {
  font-size: 50%;
  font-weight: 400;
  padding: 0;
  margin: 0;

  /* 絶対配置の設定 */
  position: absolute;
  bottom: 70px;
  left: 70px;
  right: 70px;

  /* ボーダースタイル */
  border: 0;
  border-top: 0.1em dashed #555;
}

/* コンテンツ画像のセンタリング。twemoji（例: 見出しの ↔）を巻き込むと
   display:block で文中改行されるため除外する */
section img:not([data-marp-twemoji]) {
  display: block;
  margin: 0 auto;
}

/* データ比較表はスライド高に収まるよう字詰め（縦はみ出し防止） */
section table {
  font-size: 0.62em;
  margin: 0.3em auto;
}
section th,
section td {
  padding: 3px 9px;
}
</style>

<!-- _class: lead -->
# batch-blur
## Tauri v2 で作る一括画像ブラー

吉澤亜斗武

---

# なぜ作ったか（1）
社内勉強会のために作った資料を公開しようとすると修正が必要なことがある。
- 社内の機密情報
- 他社のプラットフォーム / プロダクトの情報
- クライアント周りの情報

画像の場合は具体的なコンテンツを隠しつつ、表示の大まかなイメージやレイアウト構成は伝えたい。そのためにぼかし（ブラー）を適用する。

---

# なぜ作ったか（2）
画像が多い場合だと結構大変。
- 一般的な画像編集ソフトは、一括処理は苦手（バッチ機能がない／あっても手順が煩雑で、1枚ずつ処理すると手間がかかる）
- CLI ツールなら一括適用できるが、フィルターの強さが適切かプレビューできない。そもそもCLIは非技術者にはハードルが高く、使える人が限られる。

---

# 成果物
- 複数画像を読み込み → ブラー設定 → **一括書き出し** するデスクトップアプリ
https://github.com/yAtomtom/batch-blur

![batch-blur preview h:360px](./img/batch-blur-preview.png)

---

# アジェンダ

## 1. Tauri v2 の技術選定
## 2. アーキテクチャ（責務分割・IPC 境界・レイヤリング）
## 3. WYSIWYG プレビューの設計
## 4. 画像処理アルゴリズム（書くボックスと合成するモザイク）

---

<!-- _class: lead -->
# 1. Tauri v2 の技術選定

---

## 技術選定の評価軸
- 処理速度は個人で使うスケールでは大きな問題にならず、必要に応じて改善
- → **優先度の高い軸で選定し、速度は決め手にしない**

| 評価軸（候補） | 本アプリでの優先度 |
|---|---|
| 配布容易性（単一バイナリ・小サイズ） | **高** |
| 保守性（WYSIWYG・単一実装・テスト容易） | **高** |
| 安全性（メモリ安全・権限モデル） | **高** |
| メモリ（実行時フットプリント） | 中 |
| 処理速度（ピクセル処理の速さ） | **低**（想定規模では決め手にならない） |

---

## なぜ Tauri v2 か

- **軽量**（バイナリ小・メモリ小）
- **Rust バックエンド**（型安全・ネイティブなピクセル処理）
- **OS 標準 WebView**（Chromium を同梱しない）

| FW | 言語 | 描画 | アイドルRAM | バンドル |
|---|---|---|---|---|
| Electron | JS | Chromium 同梱 | ~150–300MB | ~85–150MB |
| **Tauri v2** | **Rust** | OS WebView | ~30–80MB | **~0.6–3MB** |
| Wails v2 | Go | OS WebView | ~10MB* | ~15MB* |
| Flutter | Dart | Skia | ~20–35MB | ~18MB+ |
| Avalonia | C# | Skia | 低 | 数MB〜 |
| Qt | C++ | ネイティブ | 数十MB | ~50–70MB |

<!-- note: 数値＝「最小〜小規模アプリ・アイドル時」を OS 標準ツール(Task Manager/Activity Monitor)で計測した公開ベンチの目安（*=vendor公称）。RSS/PSS/USS・OS/HW で変動し、vendor公称と第三者実測が混在。詳細な前提と N=1 出典は次頁。出典 levminer 実測（実アプリ Authme）, gethopp ブログ実測, Wails 公式 docs（v3 のページの公称値を v2 行の目安に流用）, Flutter #148641, Qt deploy docs -->

> > > **Skia**＝アプリが自前でピクセルを描く 2D 描画エンジン（全 OS で同一の見た目）／**ネイティブ**＝OS 標準ウィジェットで描画（OS 純正の見た目・挙動）

---

## メモリ優位の前提と限界

- Windows は WebView2 = Chromium → 実行時RAMは Electron と大差なく、**計測法次第で逆転もある**
- 差が明確なのは **macOS / Linux**（OS が WebView を共有し専有コピーを持たない分、実効メモリが小さい）
- 代表ベンチは**測定法依存かつ N=1**（実アプリ1本の単機計測）で、**一般化には注意**

<!-- note: #5889 は公式ベンチ mprof の psutil(RSS) 既定が Chromium 共有メモリを二重計上する点を指摘。WebView 依存の裏返し＝OS 更新に追従で互換差、Linux は WebKitGTK 依存（Electron は同梱で全 OS 一致） -->

> > > 代表実測: Electron ~200–300MB / Tauri ~30–40MB（最小〜小規模アプリのアイドル時, OS 標準ツール計測）。**N=1 出典＝levminer**（実アプリ Authme を単機計測）。測定法の争点＝**Tauri #5889**（RSS が Chromium 共有メモリを二重計上、PSS/USS で結果が変わる）

---

## Tauri v1 → v2: 何が変わったか

- **モバイル対応**（iOS/Android）が目玉 — 本アプリは未使用だが v2 の中核
- **コア機能のプラグイン化** — 本アプリの `tauri-plugin-dialog` も v2 プラグイン
- **セキュリティ刷新**: v1 の allowlist → **Capabilities / Permissions**（`capabilities/default.json`）
- **IPC 強化**: `Channel` でストリーミング（進捗 `ExportProgress` に活用）
- 設定 `tauri.conf.json` 再編・Rust API 変更で **v1 とは非互換**（移行作業が必要）

<!-- note: 本アプリは tauri 2.x 系。capabilities / tauri-plugin-dialog / Channel は v2 固有。v1→v2 移行は allowlist→capabilities 変換と設定キー再編が要注意 -->

---

## プラグイン化・権限・IPC — 何がうれしいか

| 概念 | 何か | うれしさ |
|---|---|---|
| **プラグイン化** | コア機能を本体から切り出し、必要分だけ導入する仕組み | 使う機能だけ＝**軽い・攻撃面が小**／本体と独立に更新・拡張 |
| **Capabilities / Permissions** | 「どの window が どの API を呼べるか」を宣言的に制限する権限モデル | **最小権限を強制**／WebView が触れるネイティブ API を限定・監査可能 |
| **IPC**（Inter-Process Communication／プロセス間通信） | Web(JS) ↔ Rust の別プロセスを繋ぐ呼び出し・データ交換 | 重い/危険な処理を **Rust に隔離**／型付き境界・`Channel` で逐次配信 |

> > > **プラグイン化**＝機能を crates/npm のように付け外し。使わない機能を同梱しない→軽く安全、コミュニティ拡張が容易／**Capabilities/Permissions**＝v1 の allowlist（全体 ON/OFF）を window×API 単位の細粒度 ACL に（permission＝個々の許可、capability＝束ねて window に付与）。XSS/サプライチェーン被害を限定、JSON で監査可／**IPC**＝WebView と Rust は別プロセス。invoke() で呼び出し、Channel/Event で逆方向。v2 の Channel は1件ずつ stream（逐次UI更新に活用。キャンセルは Channel の機能ではなく `cancel_export`＋AtomicBool フラグで実現）

---

## ピクセル処理の言語・ライブラリ選定

- **Canvas**（ブラウザ標準の描画API）でも描けるが、**JS(プレビュー)と Rust(書き出し)の二重実装**は見た目がズレる
- → **Rust に一本化**、同一コードで **見たまま出力（WYSIWYG）**
- **型安全・ネイティブ速度・単一バイナリ**も両立。各言語のライブラリは？

| エコシステム | 主ライブラリ | 種別 | 速度帯 |
|---|---|---|---|
| C/C++ | OpenCV / libvips / Skia | ネイティブSIMD | 最速（gold standard）|
| Node | sharp(libvips) / jimp | native / 純JS | sharp最速 / jimp ~40–50×遅 |
| Python | OpenCV / Pillow | ネイティブbinding | 速い |
| **Rust** | **image / imageproc** | **純Rust** | 中（SIMD薄い）|
| Go | imaging / bimg(libvips) | 純Go / native | まちまち |
| .NET | ImageSharp / SkiaSharp | managed / native | 中 |
| Java | Java2D ConvolveOp | managed | 低（分離実装なし）|

<!-- note: gold standard は OpenCV/libvips。実務論点（EXIF回転・ICC/色空間・I/O ボトルネック・巨大画像時の libvips 切替閾値）は速度とは別軸。出典 sharp 公式 performance ベンチ（jimp 比較込み）, libvips 公式ベンチ, OpenCV filter docs, imageproc docs -->

---

## 技術選定の妥当性と弱み

- **妥当な点**: メモリ安全＋単一バイナリ（libjpeg 等 C 依存を同梱せず配布容易）＋プレビュー/書き出しで同一実装（WYSIWYG）
- **弱み**: 最速ではない — 事実上の標準は OpenCV/libvips。`imageproc` は rayon 並列はあるが SIMD 前面設計ではない（特定条件で数倍改善の報告あり）
- **なぜ今 imageproc か**: `image` crate と統合され**依存最小・実績十分で安定**。**速度が問題化した時の差し替え先**は用途別の特化ライブラリ — ブラーは `libblur`、縮小は `fast_image_resize`（YAGNI）

<!-- note: 出典 apas.tel のベンチ記事（image の fast_blur が特定条件で数倍改善）, libblur README のベンチ。libblur はブラー系・fast_image_resize はリサイズ系で守備範囲が別（本アプリの対応箇所はブラー本体とプレビュー縮小）＝並列の代替ではなく用途別の差し替え先 -->

> > > 並列化の2軸 — **rayon**＝処理を**複数コアに分散**（Rust のデータ並列ライブラリ。`par_iter()` 等）／**SIMD**（Single Instruction, Multiple Data）＝1命令で**複数画素を同時計算**（1コア内）。OpenCV/libvips は SIMD も駆使、`imageproc` は rayon 中心

---

## 最終的な技術選定（結論）

- **結論: 本アプリの要件では Tauri v2 がベスト**
- 決め手は処理速度ではなく「**配布・安全・WYSIWYG**」
  - 想定規模では**速度が問題になりにくく**、一般層への単一バイナリ配布が効く
- 速度が**ボトルネックになったら** **Rust 圏内で差し替え**（`imageproc` → `libblur`）

| もし要件が… | より適する選択 |
|---|---|
| 超大規模・巨大画像で低メモリ | libvips 系（sharp / bimg / NetVips）|
| サーバ / CLI バッチ | Python+OpenCV / Go+bimg |
| GPU・リアルタイム映像 | C++/Skia / wgpu |
| **中規模・配布重視の GUI（＝本件）** | **Tauri v2 × Rust** |

<!-- note: 結論=要件適合。速度が問題化する想定がないため imageproc で十分、差し替え余地を残し現状維持が妥当。ベンチは未整備（4章の note でも同様）なので「速度差が出ない」と断定はせず「決め手にならない」までに留める。この単一実装の選択が次章 lead の「Rust ⇔ Web の責務分割」へ渡る -->

---

<!-- _class: lead -->
# 2. アーキテクチャ
# Rust ⇔ Web の責務分割・IPC 境界・レイヤリング

---

## 責務分割: Rust ⇔ Web

- 境界の判断軸は「**ピクセル/ファイルシステム(FS)に触るか**」— 触る処理はすべて Rust へ集約
- ピクセル実装は **Rust に1つだけ** → プレビューと書き出しが構造的に一致（WYSIWYG）

```
  Rust  (pixels / FS)         ║  Web  (UI / state)
  blur / decode / encode      ║  orchestration / history
  repository: FS I/O / cancel ║  keybindings / i18n / save
  domain: filter/save/preset  ║  domain: EditHistory/SaveConfig
```

境界は IPC の 1 本（Web = React 18 + Vite 5）

<!-- note: 出典 lib.rs のモジュールコメント（層構成）, App.tsx, Canvas.tsx（Web は pixel を触らず結果表示のみ）。FS I/O は repository ポート経由（commands.rs が DI）。Web もクライアント固有の純粋ドメイン(EditHistory/SaveConfiguration)を持つ -->

---

## IPC 境界

```
     Web (JS)                           Rust  #[command]
     │  invoke("export_batch", {args})  │
     │─────────────────────────────────>│  camelCase→snake_case・spawn_blocking
     │   ExportProgress {done,total}    │
     │<╌╌╌╌╌╌╌╌╌╌╌╌ Channel ╌╌╌╌╌╌╌╌╌╌╌╌│  1 ファイルごとに逐次
     │       Result<ExportOutcome>      │
     │<─────────────────────────────────│  完了数・キャンセル・失敗一覧を返す
```

- 4コマンド `load_images`/`generate_preview`/`export_batch`/`cancel_export` — pixel は imaging(codec/blur)、ストレージ I/O は repository(DI) へ委譲
- 境界の仕事は**実行手順の組み立てと共有状態の管理** — spawn_blocking への退避、キャンセルフラグ、プレビューキャッシュ、進捗の逐次送出
- ファイル単位の失敗・キャンセルは**エラーではなく結果** — `ExportOutcome` が生エラーを保持し（**握り潰さない**）、`Err` は前提検証とインフラ障害のみ

<!-- note: 登録は lib.rs の invoke_handler、本体 commands.rs。境界型は UI 向け素朴形に射影(types.rs)し「本来関心を持つ引数のみ」受け取る(時刻/ユーザー情報なし=インターフェース分離)。古い応答の破棄はフロント側（usePreview の effect の stale フラグ＋戻り値の render 時 path 照合、次章）。camelCase(JS)↔snake_case(Rust) 自動マップ＋src/ipc/types.ts に手書きミラー、tauri-specta 未導入。共有状態は commands.rs の AppState = cancel / preview_cache / repository、進捗送出は export_batch 内の on_progress.send。ExportOutcome {completed, canceled, failures} は types.rs — 部分失敗は ExportFailure {path, error} で生エラー保持、キャンセルは失敗ではなく正常な中断（いずれも export_batch 内の分岐）、Err に残るのは前提検証（出力パス衝突・別名保存先の既存）とインフラ障害のみ。TS 側の契約は src/ipc/types.ts・commands.ts（exportBatch が Promise<ExportOutcome>）、消費は useExport.ts（runToken 世代管理で完了後の遅延進捗を無視し outcome を正とする。フックを呼ぶのは App.tsx、BatchRunner.tsx は型のみ import して state/onRun/onCancel を props で受ける表示コンポーネント）。spawn_blocking は次頁で詳説 -->

---

## spawn_blocking — なぜ UI が固まらないか

- `spawn_blocking` = **重い同期処理を専用スレッドへ逃がす**関数（`tauri::async_runtime`, tokio）
- 直接実行だと async ワーカーを占有し IPC/イベントが詰まる → 退避すれば即解放され、プレビュー更新・キャンセルなど **UI が応答し続ける**

```
直接実行:
  async worker |==== blur / encode / write ====|   IPC/イベント滞留 → UI 停止
spawn_blocking:
  async worker |-> await 即解放（他の IPC を処理）
  block thread |==== blur / encode / write ====|   完了後に結果を返す
```

<!-- note: 出典 commands.rs（load_images/generate_preview/export_batch が tauri::async_runtime::spawn_blocking を使用）。CPU/IO の重い処理を非同期ワーカーから隔離する定石 -->

> > > **tokio**＝Rust で最も広く使われる非同期ランタイム。`async` タスクのスケジューリングとワーカースレッド管理を担い、`spawn_blocking` 用のブロッキング専用スレッドプールも提供する（Tauri が内部で採用）。

---

## IPC 境界を外殻とするレイヤリング（テスタビリティ）

```
┌──────────────────────────────────────────────────┐
│  commands / types                                │  外殻: IPC 境界（repository を DI）
│  imaging(codec/blur)  repository(port+local_fs)  │  アダプタ: 純粋コーデック／ストレージ・ポート
│  domain (filter/save/preset)                     │  内核: 純粋コア（image/FS/Tauri 非依存）
└──────────────────────────────────────────────────┘
```

依存は内向き 1 方向（外側 → 内核 `domain`）、逆はない

- `domain` は image/FS/Tauri 非依存 → `#[cfg(test)]` で**同ファイル完結**
- `repository` が FS を隔離 → `imaging` も純粋コーデックに（in-memory で差し替えテスト）
- `[lib]` 分離で **GUI 起動なし**に domain/imaging/repository をテスト

<!-- note: 出典 Cargo.toml の [lib]、lib.rs のモジュールコメント（層構成）。依存の直接性 commands→repository→imaging::codec（commands.rs / types.rs / blur.rs / repository/local_fs.rs）。in-memory ポート充足は repository/mod.rs の InMemoryRepository。フロントも同型: domain(純粋TS。SaveConfiguration.ts に ipc/types への type-only import が1本あるがランタイム依存なし)→features/ipc→app -->

> > > **`#[cfg(test)]`**＝テスト時だけコンパイルする Rust の印（実装と同ファイルに書く）／**`[lib]`**＝アプリをライブラリとして切り出す `Cargo.toml` 設定（GUI 本体と別にビルド・テスト可）

---

## 外殻・アダプタ・内核のディレクトリ構成

**Rust バックエンド**

```
src-tauri/src/
├ main.rs, lib.rs        起動・層宣言・IPC ハンドラ登録
├ commands.rs, types.rs  IPC 境界（調整＋契約型・repository を DI）
├ domain/                純粋コア: filter, save, preset
├ imaging/               純粋コーデック＋カーネル: codec, blur
└ repository/            ストレージ・ポート＋アダプタ: mod(ImageRepository), local_fs
```

**Web フロントエンド**

```
src/
├ app/             オーケストレーション（App.tsx）
├ ipc/             IPC 境界ミラー: commands, types
├ domain/          純粋コア(TS): EditHistory, SaveConfig
├ features/        機能: asset-catalog, editor, batch
└ shared/, i18n/   横断: keybindings, 翻訳
```

<!-- note: 両サイドとも domain/ を純粋コアに持ち、境界(commands・ipc)→アダプタ(imaging・repository・features)→app が対応。Rust 側は repository が FS を隔離するポート層。出典 src-tauri/src, src のツリー -->

---

<!-- _class: lead -->
# 3. WYSIWYG プレビューの設計
# 単一実装（imaging/blur）とスケール補正

---

## 課題: プレビューが「別物」になる 2 つのズレ

- **実装のズレ**: JS(Canvas) でプレビュー・Rust で書き出し → 1章の **Rust 一本化で解消済み**
- **解像度のズレ**: プレビューは縮小・書き出しはフル → **同一実装でも**同じ半径で結果が変わる

```
  同じ radius=20 を当てると…
  書き出し   4000px の画像に r=20 → 画像幅の 0.5%
  プレビュー 1600px の画像に r=20 → 画像幅の 1.25%（2.5 倍ぼける）
```

- 本章の WYSIWYG ＝ **プレビューで決めた強度が、フル出力でも同じ見え方になる**こと

<!-- note: 1軸目（実装のズレ）は1章の言語選定で構造的に消えているので、本章は2軸目＝解像度のズレをどう埋めるかに絞る。scale = 1600/4000 = 0.4 -->

---

## プレビュー 1 回の経路

```
 Web  slider → debounce 130ms → invoke generate_preview{…, maxDim, reqId}
 Rust ├ cache hit  → 縮小ベースを再利用
      └ cache miss → read → decode → downscale(長辺を 1600px へ) → cache へ格納
      → apply_stack_scaled(base, stack, scale) → PNG → base64 data URL
 Web  応答を現在の選択と照合（古い応答は捨てる）→ <img src={dataUrl}>
```

- 重い前処理は**キャッシュ**、毎回走るのは**ブラー＋PNG**、UI 側は**間引きと採否**だけ
- 以降のスライドで、上記の図の工夫した点を1つずつ — 競合制御 / スケール補正 / キャッシュ

<!-- note: 出典 commands.rs の generate_preview, usePreview.ts の DEBOUNCE_MS と usePreview の effect, types.rs の PreviewResult。data URL は <img src> にそのまま入るので追加のアセットプロトコルが要らない。プレビュー PNG には原本の ICC を埋めて書き出しと色を揃える（commands.rs の generate_preview が encode_to_bytes に渡す）。base64 で約33%膨らむが、長辺1600の PNG 1枚なので実用上問題にならない。130 という値は初回リリース(2584b07)から変わっておらずコードに根拠コメントはない＝経験的に決めた値。質問されたら「体感で追従し、かつ連打をまとめられる範囲から選んだ」と答える -->

> > > **debounce**＝連続入力を間引き、**最後の入力から一定時間経ってから 1 回だけ**送る仕組み。スライダーを端から端まで動かしても、送信は指を止めた 1 回だけ。130ms は「即応と感じる 0.1 秒前後」かつ連打をまとめられる帯／**1600px**＝プレビュー基準画像の長辺上限。上げるほど忠実・下げるほど毎入力が軽い。元が 1600px 以下なら**縮小せず等倍**（拡大はしない）

---

## 間引きと採否 — 非同期 UI の競合制御

```
  要求A invoke ──────────────> 応答A   effect は cleanup 済み → stale で破棄
      要求B invoke ────> 応答B         現行 effect の要求 → 採用
```

- `DEBOUNCE_MS = 130` で間引き、採否は **effect クロージャの `stale` フラグ**が持つ
- cleanup が旧要求を無効化し、結果は **render 時に path 照合** → 旧画像を出さない
- in-flight は止めない — プレビューは軽く副作用もないので**捨てる方が単純**

<!-- note: 出典 usePreview.ts の usePreview（effect 内の stale フラグと cleanup）, 戻り値の render 時 path 照合, types.rs の PreviewResult。debounce は effect cleanup の clearTimeout、依存配列は settings.kind/radius の「値」（オブジェクト同一性に依存しない）。req_id は Rust へのエコーバック用の一意 ID として残るが採否判定には使わない（usePreview.ts の reqId 生成）。旧実装は reqId >= latestAccepted の単調カウンタ比較 — path と紐付かず画像切替をまたぐ採否を識別できないため、旧画像が一瞬出る・エラー表示が切替後に残る余地があった → stale フラグ＋path 照合で解消（bug-fix）。エラーも {path, message} で保持し切替後に持ち越さない。stale 無効化により state は常に「現在の選択 × 現在の設定」への最新リクエストの結果だけになり、設定のみの変更（path 同一）の間は前回結果を出し続けてチラつきを防ぐ。キャンセルを持つのは書き出しだけ（2章 cancel_export）。in-flight が重なるのは、処理時間が debounce 間隔より長いとき（フルサイズのデコードを伴う初回など） -->

> > > **in-flight**＝送信済みでまだ応答が返っていないリクエスト。処理が debounce の 130ms より長引くと要求が重なり、複数が同時に in-flight になる。`invoke` は発行後に取り消せず Rust 側は最後まで走る ＝ **受け取ってから捨てる**

---

## 単一実装 — Rust の 2 経路が `blur_rgba` に収束

```
  preview  apply_stack_scaled(img, stack, scale) ┐ max(1, round(radius × scale))
                                                 ├→ blur_rgba(img, kind, r)
  export   apply_stack(img, stack)               ┘ radius そのまま
```

- 上が**プレビュー**（縮小画像）、下が**書き出し**（フルサイズ）の経路
- **ブラーを掛けるコードは `blur_rgba` ただ 1 つ**。2 経路の違いは「半径をスケールするか」だけ
- デコードも `decode_rgba` の共通経路 → EXIF 向きの正規化も両経路で一致する
- → ズレうる箇所が構造的に **1 行**に閉じる（レビューで守り切れる粒度）

<!-- note: 出典 blur.rs の apply_stack / apply_stack_scaled（同じ fold 構造で spec ごとに blur_rgba を呼ぶ）, blur.rs のモジュールコメント（WYSIWYG を明記）, codec.rs の decode_rgba（EXIF Orientation 正規化）。テスト apply_stack_single_matches_blur_rgba が「スタック経由 == 直接呼び出し」を固定。※主張の正確な形は「フィルタ適用の入口が blur_rgba ただ 1 つ」。カーネル自体は種別ごとに分かれる（blur_channels の match）が、プレビューも書き出しも同じ blur_rgba を通るので WYSIWYG は種別に依らず成り立つ。画素に触る関数は他にもある（PNG encode・premultiply/unpremultiply） -->

---

## 半径のスケール補正

$$ \text{preview\_radius} = \max\!\left(1,\ \mathrm{round}(\text{radius} \times \text{scale})\right), \quad \text{scale} = \min\left(1, \frac{1600}{\max(w, h)}\right) $$

- 半径は**ピクセル単位の長さ** → 画像を `scale` 倍に縮めれば、同じ見え方になる半径も `scale` 倍
- 補正しないと縮小画像が過剰にぼける（前ページの 0.5% → 1.25%）
- `PREVIEW_MAX_DIM = 1600`（長辺）。元が 1600 以下なら `scale = 1.0` で**拡大はしない**
- 上式が効くのは**正の半径のみ** — `radius = 0` は下限を適用せず **0 のまま**（＝恒等）

| 元画像 | scale | UI radius | preview_radius |
|---|---|---|---|
| 4000×3000 | 0.40 | 20 | 8 |
| 4000×3000 | 0.40 | 1 | 1（round は 0 → **下限 1**）|
| 4000×3000 | 0.40 | 0 | 0（下限の対象外＝**恒等**）|
| 1200×900 | 1.00 | 20 | 20（縮小なし＝完全一致）|

<!-- TODO: scale 補正あり/なしの比較画像 -->
<!-- note: 出典 blur.rs の apply_stack_scaled / scaled_radius（round＋下限 1）, codec.rs の preview_scale / downscale_for_preview（Triangle 補間）, App.tsx の PREVIEW_MAX_DIM=1600。max(1, …) の下限は正の半径のみ＝radius=0 は scaled_radius が 0 を返し恒等のまま（担保はテスト scaled_radius_keeps_positive_radius_above_zero）。下限の理由（round で 0 に落ちると「プレビュー素通し・出力ぼけ」の WYSIWYG 破れ）は「近似が残すズレ」の頁で詳述。min(1, …) は preview_scale が長辺 <= max_dim で 1.0 を返す仕様に対応。妥当性検証: 「フル適用→縮小」を正解として 1 次元で比較すると、補正ありの平均誤差は 0.45–2.0/255（r>=3）、補正なしは 1.8–26 で 5〜25 倍改善。残差は整数丸めが支配的（旧実装は r=1→preview_radius=0＝恒等が最悪ケースだったが、下限 1 で解消。「近似が残すズレ」の頁）。この下限はガウス・ボックス以外の種別でも効く（モザイクは radius_to_block と合成され、担保はテスト mosaic_preview_never_collapses_to_identity）。窓幅を厳密対応させる r'=r*s+(s-1)/2 も試したが、Triangle 縮小自体のローパスがあるため実装の round(r*s) の方が誤差が小さい。ガウスは sigma'=sigma*scale が厳密に成り立ち、sigma=radius/2 なので radius をスケールすれば自動的に満たされる（box は窓幅の離散化ぶんだけ近似）。「ピクセル単位の長さ」の中身＝box は窓幅 2r+1、ガウスは sigma。画像を scale 倍にリサンプルすると画像内のあらゆる長さが scale 倍になるので、カーネル幅も同じ scale 倍にすれば相対的な効き方が変わらない、と口頭で補う -->

---

## スケール補正の限界 — プレビューだけ順序が逆

- プレビューは**縮小 → ブラー**、揃えたい相手は**ブラー → 縮小**（フル出力を画面で見た姿）
- この 2 つは**可換でない** → 一致は保証ではなく実用上の近似
- **なぜ厳密な「ブラー → 縮小」にしないか**: 毎入力でフル解像度のブラーと縮小をやり直す
  → 画素数 **6.25 倍**（4000×3000）。縮小を初回で済ませる今の順序が **LRU(1) キャッシュの前提**

<!-- note: 出典 commands.rs の generate_preview（downscale_for_preview → apply_stack_scaled の順）。厳密一致を取るなら「フル適用→縮小」だが、4000×3000=12.0M px に対し縮小後は 1600×1200=1.92M px で 6.25 倍の差（1/scale^2）。しかも縮小結果がブラー設定に依存するようになり、キャッシュできるのはデコード済みフル画像（48MB）までで、縮小そのものが毎入力の経路に入る。今の順序なら縮小ベース（7.7MB）を LRU(1) に載せられ、毎入力の仕事はブラー＋PNG だけで済む＝この近似が存在する理由。つまり「近似を選んだ」のではなく「キャッシュが成立する順序を選んだ結果として近似になった」 -->

---

## 近似が残すズレ — 丸めと表示側の縮小

- **丸めの量子化**: 4000px の画像で `radius=1` は `round(1 × 0.4) = 0` ＝ 恒等になっていた
  → **プレビュー素通し・出力はぼける**という WYSIWYG 破れ → **下限 1 で修正済み**
- 下限で「ぼけの存在」は保証されるが、弱ブラー × 強縮小では**過剰側に ±1 画素相当の誤差**が残る
- **表示側でもう一段縮む**: CSS の `max-width/max-height` ＋ `object-fit: contain`
- 残る誤差は実用上ほぼ使わない領域 → **問題化したら詰める**（YAGNI）

<!-- note: 出典 blur.rs の blur_rgba（radius 0 は恒等）, blur.rs の scaled_radius（round と下限 1。担保はテスト scaled_radius_keeps_positive_radius_above_zero）, FilterControls.tsx の radius スライダー（min=0 / max=MAX_RADIUS_UI=100 なので radius=1 は到達可能）, styles.css の .preview-image。ガウスは radius→sigma(=radius/2) 変換の前段でスケールするので丸めが sigma にも乗る。縮小後の寸法も round(w×scale)/round(h×scale) なので、返る scale と実効倍率が軸ごとに微差を持つ（codec.rs の downscale_for_preview）。表示側の縮小率はウィンドウサイズ次第で変わるため、厳密に見比べたいなら等倍表示が要る。なお本構成では max-width/max-height だけで箱の比が画像と一致するので object-fit: contain は実質効いていない（比が食い違う場合の保険）。画面上で実際に縮めているのは前者 -->

> > > **max-width / max-height: 100%**＝寸法の上限を親（`.canvas-viewport`）に制限。`<img>` は固有の縦横比を持つので、上限に当たると**比を保ったまま縮む**／**object-fit: contain**＝箱の大きさが決まった後、中の画像をどう収めるかの指定。比を保って収まる最大で描き、余りは余白

---

## 縮小ベースの 1エントリキャッシュ（LRU(1)）

- キー = `(ResourceLocation, max_dim, fingerprint)` ＝ **どの画像を・どこまで縮めたか・どの内容か**
- 値 = **ブラー前の縮小画像 ＋ scale**（＋原本の ICC。結果でないので設定変更でもヒット）
- **1 件で足りる**: プレビューは常に選択中の 1 枚＝ミスは**切替時と内容更新時**だけ
- **ミス時の実費** = read → decode → downscale（画素数比例、12MP で 300ms）
- → N 件の是非は**切替の待ち時間**次第。1 件 約 6〜10MB で有界（縦横比で変動）＝大きい画像ほど得
- → 毎入力で走るのは **ブラー ＋ PNG encode**。それを速くする話が次章

<!-- note: 出典 commands.rs の PreviewBase, generate_preview のロックスコープ（先頭で lock, ブロック終端で解放）とロック外のブラー/encode。ミス時は read→decode→downscale_for_preview までロック保持のまま（単純さを優先）。fingerprint は内容の鮮度トークン（ImageRepository::fingerprint、照合は generate_preview のキャッシュキー比較）。FS 実装は len:mtime_nanos の近似で、mtime 粒度内に同サイズで書き換わった変更は検出できない割り切り＝上書き export 後に同じ画像を選び直しても保存前の stale なベースを掴まない（bug-fix で追加）。キーは ResourceLocation の生文字列比較で正規化しない＝表記違いはミス（repository/mod.rs の ResourceLocation）。max_dim をキーに含めるのは将来ズーム等で変わりうるため。ResourceLocation は画像の所在を表す値（FS ではパス文字列、将来 Drive なら file-id）で、非空を不変条件に持ち scheme 解析は持たない（単一 FS のため過剰、将来ルーティング導入時に追加）。max_dim は縮小後の長辺上限で現状 1600 固定。ヒット時はベースを clone してロックを即解放し、ブラーと PNG encode は常にロック外。省けるのは 4000×3000 の JPEG 再デコードなど。キャッシュ値がブラー前なのが要点で、結果をキャッシュしていたら radius/kind を変えるたび必ずミスになる。PreviewBase の doc コメント通り目的は「スライダー連打で再デコード/再縮小を避ける」ことで、この用途は同一キーへの連打なので容量 1 で足りる（ミスするのは画像を切り替えた瞬間だけ）。N 件にする利点は上下キーの前後送り（判定は shared/keybindings.ts の useKeybindings の ArrowUp/ArrowDown、App.tsx の doPrev/doNext を useKeybindings へ配線）で行き来する場合にあるが、常駐メモリが約 6〜10MB×N（縮小後 w×h×4B）に増え、追い出し順序の管理とテストも要る＝YAGNI。fingerprint がキーに入ったため、N 件化しても stale ベースの窓は（mtime 粒度の限界を除き）広がらない＝N 件化の論点は純粋にメモリ × 切替時間のトレードオフ。実測（image 0.25 / release / decode+downscale, 読み込みは除く）: 1.9MP=13ms（縮小自体が起きない）, 4.3MP=139ms, 12MP=304ms, 24MP=421ms, 48MP=760ms。decode が約 10ms/MP で支配的。ベースは長辺 1600 にクランプされるのでサイズは縮小後 w×h×4B で有界 — 16:9 なら 1600×900×4B≈5.8MB、4:3 なら 1600×1200×4B≈7.7MB、正方形が最大の 1600×1600×4B≈10.2MB（スライドの「約 6〜10MB」はこの範囲の丸め。元画像がどれだけ大きくても超えない）。4:3 換算の 7.7MB で買える時間が 1.9MP では 13ms、48MP では 760ms と 58 倍違う。境界はおよそ 10MP（切替 300ms＝もたつきとして知覚され始める線）。本アプリの想定はスクショ 1920x1080≒2MP なので検討不要、カメラ写真 12MP 超＋前後送りの使い方が出てきたら N=3 の LRU か先読みを比較する -->

> > > **LRU(1)**＝容量 1 の LRU。直近の 1 件だけ保持し、別のキーが来たら捨てる（容量 1 では追い出し戦略が退化し、実装は `Option<PreviewBase>` の上書きだけ）

---

<!-- _class: lead -->
# 4. 画像処理アルゴリズム
# 書くボックスと合成するモザイク — 速さ・端・正しさの決め方

---

## 4 章の要点 — 書くか合成するかで、核と格子の扱いは逆になる

- 同じ「隠す」でも、ボックスとモザイクは**判断が逐一反転する**

| | **ボックス**（核で混ぜる） | **モザイク**（格子で潰す） |
|---|---|---|
| 作り方 | 型が合わず**書く** | `resize` 2 回の**合成** |
| $O(n)$ の作り方 | **状態の再利用** | **出力の縮小**で相殺 |
| 端の解き方 | `clamp` を**選んで**解く | **仕様として受け取る** |

- **残る課題**: モザイクの**格子だけ WYSIWYG が届かない**（プレビューと書き出しでセルがズレる）

> > > **核（カーネル）**＝出力 1 画素を決めるとき、周囲の画素に掛ける**重みの表**。形がぼけの質を決める／**格子**＝入力に依らず**位置だけで決まるセルの区切り**。モザイクはこの中を 1 色に潰す

<!-- note: この 1 枚は結論の先出し。表の 3 行は「どちらが優れているか」ではなく「同じ問いに逆の答えが出る」ことを見せるためのもので、行ごとに左右を読み比べる。各行が以降のどこで回収されるか: 「作り方」→「固定変換の先で詰まる」「ボックスは端まで自前、モザイクは合成で済む」、「O(n) の作り方」→「分離の次は r を消す」「厳密でなくても O(n)」「計算量が同じでも中身は逆」、「端の解き方」→「running-sum の端」「逆なのは端の扱いも」、表の下の「残る課題」→ 最後の 3 枚。テスト設計（golden でなく性質）はこの要約に置いていない — ボックス／モザイクの対比にならず、「〜も逆」で並べた行の中で 1 行だけ構造が外れるため。「resize 任せの代償」で単独に扱うので、そこで初出として話す。整理の方針として 4 観点（工夫・ハマり・汎用・本件固有）を置いてあるが、これはスライドに出さず質疑の引き出しとして持つ: 工夫＝固定変換の1関数化/境界の局所化/合成13行/端をライブラリに委ねる、ハマり＝型が合わない/端が暗くなる/縮小は平均とは限らない/隠蔽にならない縮小、汎用＝分離とrunning-sum/計算量の会計/性質テスト、本件固有＝格子の位相ズレ（ボックス側は滲みの差に埋もれて見えない）。時間が押したらボックス側（分離・running-sum）を軽く流し、モザイク側の本件固有（格子のズレ 3 枚）を必ず残す。逆にアルゴリズム寄りの聴衆なら分離と running-sum を厚くする。表の「滲みの差に埋もれて見えない」＝ボックスにも半径のスケール補正に伴うズレはあるが（3章）、ぼけの滲みの中に埋もれて知覚できない。数えられる格子を持つモザイクだけが本件固有の問題として立ち上がる。「工夫」と「汎用」の線引き＝本アプリの事情に依存する判断が工夫、他所へ持って行けるのが汎用。境界が曖昧なものは汎用側に寄せた。 -->

---

## 核と格子の前提 — 重みで混ぜるか、位置で潰すか

- **ガウス**: 中心ほど重い**釣鐘型の加重平均** → 滑らかなぼけ
- **ボックス**: **重みが一律**の単純平均 → **$O(n)$ 化の余地**がある（$n$＝画素数）
- **モザイク**: 核を持たず**セル**（1 辺 $b$ 画素）単位で 1 色に潰す＝**区分一定**
- モザイクだけ**平行移動不変でない** — 格子に**位相**がある（章末で効く）

```
 重み        ガウス核                重み        ボックス核
  │           █ █ █                   │   █ █ █ █ █ █ █ █ █  ← すべて同じ重み
  │         █ █ █ █ █                 │   █ █ █ █ █ █ █ █ █
  │     █ █ █ █ █ █ █ █ █             │   █ █ █ █ █ █ █ █ █
  └──────────────────────→ x          └──────────────────────→ x
 in  : 1 2 4 7 8 6 3 1 2 5 8 6   ← モザイクだけ核を持たない（格子で潰す）
 out : 2 2 2 7 7 7 2 2 2 6 6 6   ←[--b=3--] セル内は同値。格子は入力に依らず固定
```

<!-- note: 出典 blur.rs の blur_channels（match が種別ごとの分岐点。blur_rgba がアルファ処理を挟んで委譲する）, domain/filter.rs の FilterKind（Gaussian / Block / Mosaic）, mosaic_rgba の doc コメント「block >= 2 の出力は ceil(w/b) x ceil(h/b) 個のセルで区分一定」。本章は前半でボックス（畳み込み）、後半でモザイク（resize ベース）を扱う。2D で書くとボックス核は K = (1/d²)·1_{d×d} だが、d（窓幅）や 1/d² の記法は次ページ以降で導入するため、このページは形の対比だけに留める。ガウスの重みは exp(-x²/2σ²) 型で ±2σ からほぼゼロ。O(n) 化の話は「ボックス」経路に限る点をここで明言する。同じ「隠す」でも捨てるものが違う: ぼかし＝高周波／モザイク＝セル内の位置情報。想定QA「モザイクも畳み込みで書ける？」→ セル平均は box 畳み込み＋ダウンサンプルの合成であって、格子が入力に依らず固定されるぶん平行移動不変にならない＝厳密には畳み込みではない。この非不変性が章末の「プレビューと書き出しで格子がズレる」話の根になる。想定QA「ぼかしとどちらが強く隠せる？」→ 本アプリはどちらも秘匿の保証はしない。強度はブロックを大きくする運用側の話。【用語】核（カーネル）と格子は前ページ「4 章の要点」の脚注で定義済み。以下はスライド高の都合で脚注に置かず口頭で補う: 畳み込み（convolution）＝窓をずらしながら「重み×画素値」の総和を取る演算。ブラー＝カーネルとの畳み込み／区分一定（piecewise constant）＝出力が有限個の領域ごとに一定値になる性質。モザイクのセルがこれ／平行移動不変＝入力を1画素ずらすと出力もちょうど1画素ずれる性質。畳み込みは満たすが、格子が固定されるモザイクは満たさない／ボックス（box）＝UI 表記の「ブロック」と同一（コードは FilterKind::Block）。本文は「ボックス」で統一 -->

---

## 混ぜ方も潰し方も半径 1 本 — スライダーからの固定変換

$$ \sigma = \frac{r}{2}, \qquad d = 2r + 1, \qquad b = r + 1 $$

- UI は **radius（$r$）1 本**。種別ごとの強度へ**固定変換**で接続する
- 変換は **1 関数に固定**（`radius_to_sigma` / `radius_to_block`）— 変えるなら 1 行
- `radius=0` で imageproc は `assert!(sigma > 0)` で **panic**
  → 早期 return で恒等を返し、**防御を境界 1 箇所に置く**
- 効き幅は揃えていない（$b = r+1$ < $d = 2r+1$）＝モザイクが弱い

<!-- note: 出典 blur.rs の radius_to_sigma / radius_to_block / blur_rgba の radius==0 早期 return, box_blur_rgba 冒頭（let r = radius as i64; let d = 2 * r + 1; コメント「window 幅（除数, 一定）」）; imageproc の gaussian_blur_f32 の assert!(sigma > 0.0)。radius_to_block の事前条件は radius <= MAX_RADIUS、事後条件は >= 1（radius==0 → 1 ＝恒等、radius>=1 → 2 以上＝可視のピクセル化。担保はテスト radius_to_block_contract）。MAX_RADIUS=500（domain/filter.rs）、UI 上限は MAX_RADIUS_UI=100（FilterControls.tsx）＝ドメインの上限はプリセット等将来の入力経路も縛る契約で、UI スライダーはその部分集合。σ=r/2 の導出の向きは「揃えたい範囲が先、σ が後」: box の ±r という見た目の効き幅を基準に、ガウスの実効範囲 ±2σ をそこへ一致させると σ=r/2 が出る。実装も一致していて、imageproc の gaussian_kernel_f32 は kernel_radius = ceil(2.0*sigma) で打ち切るため σ=r/2 なら読む近傍はちょうど ±r。分散を一致させる厳密値は離散窓 [-r,r] で σ=√(r(r+1)/3)（連続近似で r/√3 ≈ 0.577r）＝採用値 0.5r との差は約15%で、厳密対応を捨てて「2で割る」単純さを優先した取り決め。r=0 は d=1（自分1画素の平均＝恒等）で早期 return と整合する。以降の使い分け: 計算量の話は UI 入力である r で語り（O(n·r²) など）、実装の窓幅・除数の話は d で語る（(sum+half)/d など）。r と d は 1 対 1 なのでどちらで語っても同じことの言い換え。b はモザイクのブロック辺長で d とは別物。3章との接続: プレビューは radius を scale 倍してから変換するので sigma も block も自動で scale 倍される（スケール補正が種別を問わず通る）。想定QA「なぜ UI を sigma にしない？」→ box に sigma は無く、共通の直観は「何ピクセルぼかすか」＝radius。blur.rs は事前条件・事後条件を doc コメントで明文化し（blur_rgba / apply_stack / apply_stack_scaled）radius_to_sigma を「契約」と呼ぶ（DbC の実践） -->

> > > $r$＝UI の radius（ぼかす半径の画素数）／$\sigma$＝ガウスの広がり幅（重みの約95%が ±2σ）。**σ = r/2** は実効範囲 ±2σ をボックスの ±r に揃えた**取り決め**で等価変換ではない／$d$＝ボックスが平均する**窓幅**（画素数）。**奇数**なのは窓の中心を 1 画素に定めるため（偶数だと半画素ずれる）／$b$＝モザイクの**セル 1 辺**の画素数

---

## 固定変換の先で詰まる — ボックスは型が合わずライブラリを使えない

- **ガウス**: `imageproc::gaussian_blur_f32` に**委譲** — ジェネリックで `RgbaImage` をそのまま渡せる
- **ボックス**: `imageproc::box_filter` は **`GrayImage` 専用** → **アルゴリズムでなく型で**弾かれる
- `image` の `blur` / `fast_blur` も**ガウス系のみ**。ボックス平均そのものは提供なし
- **「無い」の判定は 3 段階**: ①そのまま使える ②型を合わせれば使える ③本当に無い
- ボックスは②（分解4回＋再合成）を経て③扱い → **「無い車輪」だけ作る**

<!-- note: 出典 imageproc 0.25.1 の filter::box_filter（box_filter(image: &GrayImage, ...) で Luma<u8> 固定シグネチャ）, filter::gaussian_blur_f32<P: Pixel>（ジェネリック）。box_filter を RGBA に使うにはチャネル分解4回＋再合成が必要で、それを書くくらいなら running-sum ごと自前化した方が単純＝②を捨てて③扱いにした理由。fast_blur はボックス3回反復によるガウス近似（Kovesi 2010）で「ブロック平均そのもの」ではない。実は imageproc の box_filter も内部は running-sum 系 O(n)＝自前化の動機はアルゴリズムではなく「型」。ただし box_filter は除算が切り捨てで、自前版は (sum+half)/d の四捨五入という品質差もある。想定QA「ガウスも自前で O(n) 化できるのでは？」→ ボックス3回反復で近似可能（fast_blur がまさにそれ）だが MVP では YAGNI。1章の「速度が問題化したら libblur へ差し替え」と同じ判断軸。この「型で弾かれて書くしかない」が、後半のモザイク（合成で済む）と対になる -->

> > > **ジェネリック**＝画素型を差し替えられる関数の書き方（`<P: Pixel>`）。`gaussian_blur_f32` は RGBA でも Gray でも呼べるが、`box_filter` は引数の型が `GrayImage` に固定されている

---

## 型が合わないので自前で書く — 素朴な 2D は $O(n \cdot r^2)$

- 各画素で $d \times d$ の窓を総和して平均 → 仕事量 ＝ $n \times d^2$
- **半径2倍で4倍遅い**: 12MP・r=20 → 窓 41²=1681 → **約200億サンプル/チャネル**
- 磨いても消えない構造 → **窓の「形」に注目する**（次ページ）

```
 出力1画素ごとに窓 d×d を丸ごと読み直す（r=1, d=3 → 9 画素）
  ┌──┬──┬──┬──┬──┐     ┌──┬──┬──┬──┬──┐
  │▓ │▓ │▓ │  │  │     │  │▓ │▓ │▓ │  │    ● = 出力画素
  │▓ │● │▓ │  │  │  →  │  │▓ │● │▓ │  │    ▓ = 読む近傍（d² = 9）
  │▓ │▓ │▓ │  │  │     │  │▓ │▓ │▓ │  │    1 画素進むと 9 画素を読み直し
  └──┴──┴──┴──┴──┘     └──┴──┴──┴──┴──┘
```

<!-- note: この素朴版はコード上に存在しない対比用の理論値で cost = n·(2r+1)² = O(n·r²)。r=20 なら窓 41×41 = 1681。d の定義は blur.rs の box_blur_rgba、半径上限は domain/filter.rs の MAX_RADIUS=500、UI 上限は FilterControls.tsx の MAX_RADIUS_UI=100 → r=100 なら窓 201×201 = 40401 画素を読んで出力1画素。200億の内訳 = 12M 画素 × 1681 ≈ 2.0×10^10/チャネル（×4チャネル）。1サンプル 1ns でも 20秒/チャネル級で、3章のスライダー追従（debounce 130ms）とは3桁合わない。「r² が効く」の直観＝窓は面積なので、1次元の半径を2倍にすると読む量は4倍。想定QA「実測は？」→ 素朴版は実装していないので理論値。ただし仕事量が窓面積に比例するのは自明で、以降の削減率（1681→82→約4）はこの値を分母に語れる。想定QA「UI が 100 までなのに MAX_RADIUS が 500 なのは？」→ ドメインの上限はプリセット等将来の入力経路も縛る契約で、UI スライダーはその部分集合 -->

> > > **O 記法**＝入力が大きくなったとき計算量が「どう増えるか」の形だけを比べる記法（定数倍は無視）。ここでは $n$＝画素数、$r$＝ブラー半径。$O(n \cdot r^2)$＝「画素数に比例、かつ半径の2乗に比例」

---

## 2D の窓は縦横に分離できる — $d^2 \to 2d$

- 重みが一律 → $1/d^2$ を $1/d \times 1/d$ の**外積に分解できる**（**分離可能**）
- 「$d \times d$ の平均」＝「**横 → 縦の 1D 平均**」の2段。読みは **1681 → 82**
- 実装も **水平 src→tmp / 垂直 tmp→out** の 2 パス。ランク1核なら効く定石

```
    2D 窓を一括（読み d² = 9）      水平パス src→tmp      垂直パス tmp→out
    ┌───┬───┬───┐                                              ▓
    │ ▓ │ ▓ │ ▓ │                                              │
    │ ▓ │ ● │ ▓ │        =        ▓ ─ ● ─ ▓         ∘          ●
    │ ▓ │ ▓ │ ▓ │                                              │
    └───┴───┴───┘                                              ▓
```

<!-- note: 出典 blur.rs の box_blur_rgba（tmp 確保 → 水平パス → 垂直パス）。素朴版はコード上に存在しない対比用の理論値で cost = n·(2r+1)² = O(n·r²)。200億の内訳 = 12M 画素 × 1681 ≈ 2.0×10^10/チャネル（×4チャネル）。1サンプル 1ns でも 20秒/チャネル級で、3章のスライダー追従（debounce 130ms）とは3桁合わない。「r² が効く」の直観＝窓は面積なので1次元の半径を2倍にすると読む量は4倍。r=100（UI 上限）なら窓 201×201 = 40401 画素を読んで出力1画素。想定QA「実測は？」→ 素朴版は未実装なので理論値。ただし仕事量が窓面積に比例するのは自明で、削減率（1681→82→約4）はこの値を分母に語れる。分離できる条件はカーネルがランク1（外積1組で書ける）こと。ガウス・ボックスは該当、円形カーネルは非該当。「平均の平均=全体平均」が成り立つのは重みが一律だから（総和の順序交換）。imageproc も gaussian_blur_f32 が separable_filter_equal を呼んで分離実装している。実装はチャネル c を走査軸の外側に置き（水平は y→c→x、垂直は x→c→y の三重ループ）sample クロージャで src を引く構造。カーネル自体は 4 チャネル独立で、アルファの解釈は blur_rgba に集約 — 半透明を含む画像は premultiply→blur→unpremultiply（適用は blur_rgba、ヘルパーは premultiply / unpremultiply）で透明画素の色にじみを防ぎ、a=0 の出力は (0,0,0,0)。全不透明（スクショ等の大多数）は変換を省く fast path で結果は同一。担保はテスト transparent_pixels_do_not_bleed_color。tmp を u8 で持つため水平パスの丸め誤差（±0.5LSB 程度）が垂直パスへ伝播する割り切りもある（i16/f32 中間ならメモリ2〜4倍。imageproc の box_filter も同じ構造で、ソースに「x/y 両方で丸め誤差を払う」TODO コメントが残る＝標準的な割り切り。一様画像では丸めが発生しないので、境界の不変性テストはこの誤差の影響を受けない）。σ=r/2 だと imageproc のカーネル半径は ceil(2σ)≒r なので、ガウス経路は O(n·r) のまま＝半径を上げるとガウスだけ遅くなる（体感差の説明）。ここまでは両者同じ土俵で、「r に比例して遅くなる」構造は残る → 次ページで r を消す -->

> > > **分離可能性（separability）**＝2D カーネルが「横1本 ⊗ 縦1本」の外積に分解できる性質。ボックス核なら $K_{\text{box}} = k \otimes k,\ k = \tfrac{1}{d}[1,\dots,1]$ で、$d \times d$ の読みが $d + d$ に減る（分解できない例: 円形の窓）

---

## 分離の次は $r$ を消す — running-sum で $O(n)$

```rust
let mut sum: i64 = (-r..=r).map(sample).sum();  // 初期和: 行・列の先頭で1回だけ O(r)
sum += sample(x + r) - sample(x - 1 - r);       // 差分更新: 入る1画素を足し、出る1画素を引く
tmp[i] = ((sum + half) / d) as u8;              // 固定除数 d の整数四捨五入（half = d/2）
```

- 窓を1つ右へ → **総和は作り直さない**。更新は $d$ に依存せず**約4更新/画素**
- `u8 → i64` 昇格（負の座標と桁あふれ）＋ `(sum+half)/d` の**四捨五入**
- 整数の加減算は正確 → **移動和に誤差が蓄積しない**（パス間の u8 丸めは別）。状態は `sum` **1変数**
- **ガウス不可**（重みが位置で変わる）→ 分離止まり。ボックスだけ **1681 → 82 → 約4**

<!-- note: 出典 blur.rs の box_blur_rgba（水平パス・垂直パスとも「初期和 → 差分更新」の形。実コードの添字は tmp[(row + x as usize) * 4 + c]）。式の s(i) は各パスの sample クロージャ（境界 clamp 込みの画素読み出し、clamp の中身は次ページ）。窓を丸ごと総和するのは各行・各列の先頭の1回だけ＝厳密な時間計算量は O(n + (w+h)·r) で、r ≪ min(w,h) なら実質 O(n)。また O(n) は時間の話で、空間は tmp バッファ1枚ぶん O(n) の追加メモリを使う。和の最大は 255×d（r≤500 で d=1001 → 約 255K）で i64 には大余裕だが、x-1-r で負の座標計算があるため符号付きが必須。(sum+half)/d は正数の四捨五入イディオム。浮動小数の running-sum は加減算のたびに丸めが乗って誤差が蓄積しうるが、整数なら sum は常に窓総和と厳密一致。ただし「正確」の範囲は移動和 sum まで — 水平パスの結果を u8 に丸めて渡すため、理想の 2D 平均との差は ±1LSB 程度残る（前ページ note の割り切りと同じ話）。running-sum は状態が sum 1変数でキャッシュ局所性も良い。想定QA「除算が毎画素あるのに定数？」→ d は固定なので O(1)。「並列化・SIMD は？」→ 行・列単位で自明に並列化可能だが未実施（1章の「速度が問題化したら libblur」と同じ YAGNI 判断）。「実測は？」→ ベンチ未整備。検証するなら「r を変えても実行時間がほぼ変わらないこと」を criterion で -->

> > > **running-sum（移動和）**＝直前の窓の合計を使い回し、端の差分だけで次の合計を得る技法。総和の再計算 $O(d)$ が $O(1)$ になる

---

## running-sum の端 — ゼロ埋めは端を暗くする

| 方式 | 端の見え方 | running-sum との相性 |
|---|---|---|
| ゼロ埋め | **端が黒ずむ**（0 が混ざる） | ○ そのまま使える |
| 除数を実画素数に縮小 | 暗くならない | × 端分岐＋除数の再計算で単純さが崩れる |
| ミラー（折り返し） | clamp とほぼ同等 | △ 添字の折り返し計算が複雑になるだけ |
| **エッジ複製（採用）** | **暗くならない** | **○ `clamp` 1行で済む** |

- **エッジ複製**＝画像の外側を**最も近い端の画素が続いている**とみなす境界規則
- 端を複製しても除数 $d$ は**縮めない** → 窓に 0 が混ざらず**端が暗くならない**
- 境界の読み出しは**クロージャ 1 つに閉じ込め**、ループ本体は端を意識しない
- **一様画像は端まで不変**の性質テスト1本で境界バグを捕まえる

<!-- note: 出典 blur.rs の clamp_idx, box_blur_rgba の doc コメント「端でも減算されない（暗くならない）」, テスト box_blur_of_uniform_image_is_unchanged（半径3・9×9 一様画像 [40,80,120,200] の完全一致テスト。premultiply 往復込みの blur_rgba 経路でも同じ一様画像が不変なことはテスト semi_transparent_uniform_image_is_unchanged が担保）。左端 x=0（r=2, d=5）の窓は [s(0) s(0) | s(0) s(1) s(2)] となり clamp_idx(−2) = clamp_idx(−1) = 0 で端画素を複製、除数は d=5 のままなので一様画像なら端でも平均＝元の値。clamp_idx(i, n) の n は走査軸の長さで、水平パスなら幅 w、垂直パスなら高さ h（同じ関数を両軸で使い回す）。O 記法の n（画素数）とは別物なので、口頭では「軸の長さ」と言う。clamp は端画素の重みが実質増える（端1画素が最大 r+1 回サンプルされる）バイアスと引き換えに、ループ本体を単純に保つ。ぼかしの目的（隠す）には十分。ゼロ埋めは窓総和に 0 が混ざり端が周辺減光状に暗くなる。「除数を窓内の実画素数にする」正規化でも暗化は防げるが、差分更新に端専用の分岐と除数の再計算が入り running-sum の単純さが崩れる。ミラーは効果がほぼ同等な一方、running-sum の差分更新で添字の折り返し計算が入り、clamp（i.clamp(0, n-1) の1行）より複雑になる。imageproc の horizontal_filter / vertical_filter も同じ edge clamp（max(0, min(x, w-1))）で、ガウスとボックスの境界の見え方が揃う（3章の「単一実装」は経路の話、ここはガウス／ボックス間の整合の話）。モザイクは resize が境界の重みを正規化するため別系統だが、一様画像不変はテスト mosaic_uniform_image_is_unchanged が同じく担保する。想定QA「幅より半径が大きい画像（w < r）は？」→ clamp が全部端に張り付くだけで安全。事前条件は 1x1 以上（blur_rgba の doc コメント）で 1x1 でも成立。ここまでが畳み込み族。次から核を持たない3つ目（モザイク）へ移る。エッジ複製の定義は本文へ出した（英語名 edge clamp / replicate padding は出していないので、質問が出たらこの名前で答える。ゼロ埋め・ミラーと並ぶ定番の1つ）。本文からコード上の名前（clamp_idx / sample クロージャ）は外してあるが、実体はこの 2 つ＝聞かれたら名前で答えられるようにしておく。3 本目の「クロージャ 1 つ」は sample のことで、i.clamp(0, n-1) の n（走査軸の長さ）をスライドに出すと O 記法の n（画素数）と衝突するため、式そのものは口頭でも出さない -->

---

## ボックスは端まで自前、モザイクは合成で済む

- `image` / `imageproc` に **pixelate / mosaic は無い** — ボックスと同じ「無い」
- だがモザイクは**既にあるもので書ける**: `resize` を 2 回呼ぶだけ（**依存追加ゼロ・実体 13 行**）
- ボックス＝**書くしかない**（型が合わない）／モザイク＝**合成で済む**
- **実装方針**: まず**合成を探し**、合成できない時だけ書く — 「無い」＝「**合成でも作れない**」

```rust
fn mosaic_rgba(img: &RgbaImage, block: u32) -> RgbaImage {
    if block <= 1 { return img.clone(); }              // 恒等
    let (w, h) = img.dimensions();
    let small = resize(img, w.div_ceil(block), h.div_ceil(block), Triangle); // 縮小＝平均
    resize(&small, w, h, Nearest)                      // 拡大＝複製
}
```

<!-- note: 出典 blur.rs の mosaic_rgba（doc コメントを除く実体は 13 行。スライドは use 省略・改行を詰めた表示）, image::imageops の resize / FilterType。imageproc 0.25.1 の filter に pixelate 相当は無く、image 側にも無い（探した上で「合成」に倒した）。image は既に必須依存なので依存追加はゼロ。同じ resize(…, Triangle) は codec.rs の downscale_for_preview でも使っており、既存イディオムの再利用でもある。1章「速度が問題化したら差し替え」の伏線に対しては、モザイク経路の差し替え先は libblur ではなく fast_image_resize になる。想定QA「13 行で終わるなら自前ブロック平均でもよかったのでは？」→ 書けるが、正規化・端の扱い・分離パスを自分で持つことになり、ボックスと同程度のコード量に戻る（速度の比較は「計算量が同じでも中身は逆」のページで扱う） -->

---

## 合成の中身 — 縮小 Triangle・拡大 Nearest の非対称

- **Triangle（三角）**＝重み $1-|x|$ の**加重平均**。混ぜる幅は**縮小率ぶん伸びる**
  **Nearest（最近傍）**＝入力を **1画素だけ**読み、値をそのまま使う（混ぜない）
- セル辺長は半径から決まる **$b = r+1$**、セル数は $\lceil w/b \rceil \times \lceil h/b \rceil$（**切り上げ**＝端が半端でもセルを捨てない）
- **縮小で情報を捨て、拡大で戻さない** — この非対称がモザイクの本体

| 縮小 ＼ 拡大 | **Nearest（複製・採用）** | Triangle（補間） |
|---|---|---|
| **Triangle（平均・採用）** | **モザイク**（セルが立つ） | ただのぼかし（セルが溶ける） |
| Nearest（点サンプル） | **隠蔽にならない**（代表1画素が原寸で復活） | 弱いぼかし |

- **左下が事故**: 縮小を Nearest にすると代表 1 画素が原寸で戻り、**文字の芯が読める**

<!-- note: 出典 image の FilterType（Nearest は support 0.0、Triangle は support 1.0）, imageops/sample.rs の resize（vertical_sample → horizontal_sample の 2 パス＝resize 自体が分離可能フィルタ。「型が合わないので自前で書く」ページの分離がここで再登場）, blur.rs の radius_to_block（b = r+1）と mosaic_rgba の w.div_ceil(block)。フィルタ名は「縮小用/拡大用」ではなくカーネルの形の名前で、方向で挙動が切り替わるのではなくタップ数が縮小率で決まる: src_support = support × max(1, ratio) なので、拡大（ratio<1）では Triangle は隣 2 画素の線形補間（2D なら bilinear）、縮小では ratio 倍に伸びて多数画素の平均になる。この伸びは次ページで数値まで扱う。Nearest は support 0 なので伸びようがなく、拡大では各出力が floor((x+0.5)·small_w/w) の 1 画素を読むだけ（タップ 1・重み 1）＝セル内が厳密に同値、縮小では読まれなかった画素がそのまま捨てられる（表の「隠蔽にならない」＝セルの代表 1 画素が原寸で復活して文字の芯が読める＝隠す目的そのものを達成しない事故）。記号の使い分けを明言: b はモザイクのブロック辺長で、ボックス節の d（窓幅 2r+1）とは別物。w=7・b=3 ならセル数 ceil(7/3)=3 で、概念上の block は [0,1,2][3,4,5][6] の 3/3/1 分割（実際に拡大後へ割り当てられるセル幅は「端も resize 任せ」のページで扱う別物）。想定QA「なぜ b = 2r+1 に揃えないのか」→ 契約が「0 は恒等・1 以上は可視」だけで、ボックスと効き幅を揃える設計にはなっていない。結果として同じスライダー値ならモザイクの方が効きが弱い（b=r+1 vs d=2r+1）という割り切りで、正直にそう話す。想定QA「Lanczos 縮小では？」→ リンギングでセル値が元の値域外へ振れる（clamp される）ので、平均としては不適。想定QA「拡大を Nearest 以外にする用途は？」→ いわゆるソフトモザイク表現。本アプリは隠す目的なので硬いセルを選ぶ -->

> > > **$\lceil x \rceil$（天井関数）**＝x 以上の最小の整数。コードでは `u32::div_ceil` が対応／**block**＝コード上の引数名（本文の $b$）。UI の radius とは**変換関数 1 つ**だけで接続する

---

## 縮小の Triangle は「厳密なブロック平均」ではない

- `resize` の **ratio ＝ 入力幅 ÷ 出力幅**。カーネルはこの **ratio 倍**に引き伸ばされる
- 幅 7 画素・b=3 なら **7 → 3 セル**の縮小 → **ratio = 7/3 ≈ 2.3**＝タップは ±2.3
- 隣の block まで届く → セル値は「block 内 b 画素の平均」ではなく**テント加重平均**
- 厳密なブロック平均なら **`thumbnail` が実在する** — **型制約と整数比前提**があり不採用

```
 pixel :   1      2      3      4      5     ← 出力セル 1（自分の block = 画素 3,4,5）
 weight:  0.06   0.24   0.41   0.24   0.06   中心は画素 3、±2.3 の外の 0 と 6 は重み 0
 block :[------------][-------------------]  左＝隣の block ／ 右＝自分の block
 sum   :     0.29              0.71          ← 約 29% が隣の block から来る
```

<!-- note: 出典 image 0.25.10 の imageops/sample.rs の horizontal_sample / vertical_sample（let ratio = width as f32 / new_width as f32; let sratio = if ratio < 1.0 {1.0} else {ratio}; let src_support = filter.support * sratio; と重み正規化 *w /= sum）。ratio は「入力幅 ÷ 出力幅」なので縮小パスでは 1 より大きい。7 は前ページと同じ w=7 の例で、出力幅は ceil(7/3)=3 セル＝縮小パスの ratio が 7/3。拡大パスは 3→7 なので ratio=3/7 と逆数になり、こちらは sratio が 1.0 に丸められてカーネルが伸びない（「逆なのは端の扱いも」ページの 3/7 はこちら）, triangle_kernel(x) = 1 - |x|, thumbnail → thumbnail_sample_block（矩形の厳密平均）。出力 x=1 の具体値: inputx = (1+0.5)×7/3 = 3.5 → 走査範囲 left = floor(3.5−2.33) = 1, right = ceil(3.5+2.33) = 6 なので読むのは画素 1〜5。中心は inputx−0.5 = 3.0 で、画素 0 と 6 は中心から 3.0 離れており kernel((0−3.0)/2.33) = 1−1.29 < 0 ＝台の外なので重み 0。想定QA「なぜ 0 と 6 は効かないのか」→ テントの半幅 2.33 画素の外だから、で答える。support を縮小率ぶん伸ばすのは定石で、伸ばさないと入力画素を飛ばし読みして折り返し（エイリアシング）ノイズが出る — 脚注の字数の都合で口頭に回した補足。「タップ」は信号処理・FIR フィルタの用語で、一般語ではないので脚注で定義している。本文で「カーネルの幅」と呼んでいるものがソース上の filter.support（台＝カーネルが非ゼロになる範囲の半幅）で、スライドに出さない語なので脚注からは外した — 質問が出たらこの対応で答える。数値は ratio=7/3・出力 x=1 の手計算＝ソースからの導出であって実測ではない。thumbnail を採らなかったのは Enlargeable 制約と整数比前提の設計があり、resize 1 行の単純さを崩すため。ここで言う block は b で区切った概念上の分割で、「逆なのは端の扱いも」ページで扱う「拡大後に実際に割り当てられるセル」とは別物である点を口頭で必ず区別する。想定QA「にじむのは悪い？」→ 隠蔽の観点ではむしろ安全側だが、「セル＝ブロック平均」と説明すると嘘になるので明示する -->

> > > **タップ**＝1 出力を作るために読む入力画素とその本数（加重平均の項数）。Nearest は 1 タップ、Triangle は引き伸ばした幅のぶんだけ増える／**`thumbnail`**＝`image` にあるサムネイル生成用の縮小関数。`resize` と違い、ブロックを**矩形のまま厳密に平均**する

---

## 厳密でなくても $O(n)$ — $b$ が相殺する計算量の会計

- **会計の作法**: コスト ＝ **出力画素数 × タップ数**。縮小は出力 $1/b^2$・タップ $b^2$ 倍で**相殺**
- 素朴 2D は $\frac{n}{b^2}(2b)^2 + n = 5n$、分離すると **$3n + 3n/b$**（b=21 で 3.1）

| パス | 出力画素数 | タップ | コスト（総計） |
|---|---|---|---|
| ① 縮小・垂直 | $w \times h/b$ | $2b$ | $2n$ |
| ② 縮小・水平 | $w/b \times h/b$ | $2b$ | $2n/b$ |
| ③ 拡大・垂直 | $w/b \times h$ | $1$ | $n/b$ |
| ④ 拡大・水平 | $w \times h$ | $1$ | $n$ |

- オーダーに $r$ が残るかは「**出力数がどう変わるか**」だけで決まる

<!-- note: 出典 image 0.25.10 の resize（let tmp = vertical_sample(image, nheight); horizontal_sample(&tmp, nwidth) の順）。①②が mosaic_rgba の 1 回目の resize(Triangle)、③④が 2 回目の resize(Nearest)。出力数 n/b^2 の根拠: セル数は ceil(w/b) × ceil(h/b) で、切り上げを外すと (w/b)(h/b) = wh/b^2 = n/b^2。外した端数は 1 軸あたり最大 1 セルぶん（合計で O(w/b + h/b)）なので、b が相殺することを見せる会計には効かない。タップ数 (2b)^2 の根拠: 縮小パスの ratio ≈ b なので src_support = 1.0 × b ＝ カーネルが中心から ±b 画素まで届く。1 軸で約 2b 画素、2 軸ぶんの矩形なので (2b)^2 = 4b^2。前ページの w=7・b=3 では ±2.33 で 1 軸 5 画素だった（2b=6 の目安どおり）。パスごとに出力画素数が違うのが肝で、①は高さだけ 1/b になった w×(h/b) が出力なので w·(h/b)·2b = 2n、②は幅も 1/b になって (w/b)(h/b)·2b = 2n/b。③④は Nearest がタップ 1 なので出力画素数そのものが cost で、(w/b)·h = n/b と w·h = n。分離の損得の内訳: 縮小は素朴 2D なら 4n だが分離で 2n+2n/b になり必ず得。拡大は Nearest がもともと 1 タップなので分離しても減らしようがなく、中間画像 (w/b)×h を一度作るぶん n/b だけ増える（n → n+n/b）。それでも合計は素朴 2D の 5n に対し 3n+3n/b で、b≥2 なら必ず速い（b=2 で 4.5 対 5、b=21 で 3.1 対 5）。resize は filter に関わらず vertical_sample → horizontal_sample を必ず通るので、この n/b は Nearest でも避けられない。すべて image 0.25.10 のソースからの導出で未実測（criterion 未整備＝ボックス節と同じ立場）。ボックスの running-sum 約 4 更新/画素と同じ帯で、次ページの表に並べる。想定QA「n の定義は？」→ 画素数 w×h。「running-sum の端」ページの clamp_idx(i, n) の n（走査軸の長さ）とは別物。【記号の再掲（スライド高の都合で脚注に置かず口頭で補う）】n＝画素数（画像1枚の総ピクセル数 w×h）／b＝セル1辺の画素数（radius_to_block で b = r+1）。表と式はすべて画像全体の総読み回数で、n で割ると 1 画素あたりになる -->

---

## 計算量が同じでも中身は逆 — 状態の再利用 vs 出力の縮小

| | ボックス | モザイク |
|---|---|---|
| 窓の大きさ | $d = 2r + 1$ | $b = r + 1$ |
| 1画素あたり・素朴 2D | $d^2 \approx 4r^2$（r=20: 1681） | $5$ |
| 1画素あたり・分離後 | $2d \approx 4r$（r=20: 82） | $3 + 3/(r+1)$（r=20: 3.1） |
| $r$ を上げると | **$r$ に比例して増える** | **減る**（4.5 → 3 に漸近） |
| オーダー（総計） | $O(n \cdot r)$ → running-sum で $O(n)$ | $O(n{+}n/r)$ ＝ **$O(n)$**（$1 \le r \le n$ で有界） |
| 中間バッファ | u8 1 枚 ＝ **48MB 固定** | f32 ＝ **96MB（b=2）〜9.2MB（b=21）** |

- **読み回数は近いが中身が違う**: ボックスは**整数の加減算**、モザイクは **f32 の乗加算**
- **メモリは逆**: モザイクは**弱いほど重い**（縮小率が小さいほど中間が大きい）
- **モザイクは自前で書く方が速い**（1画素あたり 2 対 3.1）— それでも合成＝**自前のコードを増やさず、端と正規化も任せられる**

<!-- note: 「1画素あたり」の 2 行が本ページの肝。総コストは n×（1画素あたり）なので、O() の中に r が入るかどうかはこの列が r で増えるかだけで決まる。ボックスは窓を広げても出力が n 個のままなので 1画素あたりが d^2（素朴）や 2d（分離）と r で増え、r がオーダーに残る。モザイクは窓を広げると出力が 1/b^2 に減って相殺するので 1画素あたりが 5（素朴 2D）や 3+3/(r+1)（分離）で r によらず 3〜6 に収まり、O(n) がタイトになる。1681 → 82 → 約 4 は「自前ボックスの窓」「running-sum」各ページの数字をそのまま持ってきているので、聞き手はボックス側を思い出せる。想定QA「モザイクも O(n + n/r) や O(n(1+1/r)) と書くべきでは？」→ 書いても間違いではないが O(n) と同じもの。n/r ≤ n で第2項が吸収され、1 ≤ 1+1/r ≤ 2 で係数が有界なので、O 記法の定義上どちらも O(n) に簡約される（O(n + log n) を O(n) と書くのと同じ）。残すと「r が漸近的に効く」という誤った印象になる。逆にボックスの r は有界でないので落とせない — この「落とせる/落とせない」が両者の差そのもの。r は両方の正確なコスト関数には入っている（ボックス 2n(2r+1)、モザイク 3n + 3n/(r+1)）ので、表の「1画素あたり」2 行がその居場所を示している。想定QA「2 変数 (n, r) で n/r を落として比較するのは一般的か」→ 一般的。多変数の O は「定義域全体で一様に押さえられるか」で判断する。表は定義域を 1 ≤ r ≤ n と両側で書いているが、有界性に効いているのは下側の r ≥ 1（r=0 は恒等で早期 return）で、n/r ≤ n から 3n ≤ 3n + 3n/r ≤ 6n と r によらない定数 6 で挟める＝O クラスとしての等号であって近似ではない。上側の r ≤ n は n/r ≥ 1 という下界を与えるだけで、簡約の根拠ではない（定義域を明示するために併記している）。質問されたらこの順で答える。落とせない例は O(n + m)（n, m が独立で m を n で押さえられない）や r が 0 に近づける場合。想定QA「r は MAX_RADIUS=500 で有界だからボックスも O(n) では？」→ 厳密にはそのとおりで、O(n·r) は r を自由変数として扱う慣習の表現。r 依存性を示すための約束事だと断ってよい。想定QA「b = r+1 なのにモザイクのオーダーに r も b も入らないのは変では？」→ 入っている。ただしオーダーではなく定数倍で、3 + 3/(r+1) が r=1 で 4.5、r=20 で 3.14、r→大 で 3 に漸近する。b が MAX_RADIUS 由来で 501 を超えないこと、b が画像サイズを超えてセル 1 個になっても div_ceil で 1 セルに落ちて 3n + O(w+h) に退化するだけであることも、必要なら補足する。3 つ目の箇条書きの根拠: 自前でセル平均を書けば読みは n（平均）＋ n（敷き詰め）＝約 2 サンプル/画素で、採用実装の 3.1 より速い。それでも合成を選んだのは 13 行・依存追加ゼロ・境界と正規化をライブラリに任せられる方を採ったから。この 3 つはいずれも保守のコストで、速度差 2 対 3.1 は書き出しの実時間で見れば誤差の帯（どちらも未実測）＝1章「速度は決め手にしない」と同じ判断軸だが、ここでは口頭で繋ぐだけにして本文は理由そのものを出している。1 つ目の箇条書きは表の数値の読み違い防止で、約 4 と 3.1 は近いが、ボックスは running-sum の整数加減算、モザイクは resize の f32 乗加算なので、読み回数が近くても実時間が同じとは限らない（どちらも未実測）。中間は Rgba32FImage（16B/px）を vertical_sample が ImageBuffer::new(width, new_height) で確保するので、4000×3000・b=2 なら 4000×1500×16B ≈ 96MB、b=21 なら約 9.2MB。ボックスの tmp は u8 で w·h·4B = 48MB 固定（out も含めれば実質 2 枚）。数値はすべてソースからの導出で未実測。想定QA「弱いモザイクで 96MB は困らない？」→ 一時的な確保で即解放され、プレビューは長辺 1600 に縮小済みなので実際に効くのは書き出し時のみ。想定QA「なぜボックスだけ整数演算？」→ 移動和を整数で持てるのが running-sum の利点で、resize は f32 中間が前提（running-sum ページの「誤差の蓄積が構造的にゼロ」と対になる） -->

---

## 逆なのは端の扱いも — resize 任せとエッジ複製の対比

- 端専用の分岐は **1 つも無い** — **切り上げ**でセル数を決め、`Nearest` が幅を割り振るだけ
- 7px を 3 セルに割ると **3/3/1 ではなく 2/3/2** — 中心座標で選ぶ結果、**均等に再配分**される
- 端が暗くならないのも `resize` **任せ**（重みを正規化）— ボックスが**エッジ複製**で**選んで**解いた問題を、モザイクは**ライブラリの仕様として**受け取っている
- 代償: `image` がサンプル位置を変えれば**セル境界も静かに変わる** → 気づく手立てが次ページ

```
 out   :  0     1     2     3     4     5     6     w = 7 → セル 3（ratio = 3/7）
 center: 0.21  0.64  1.07  1.50  1.93  2.36  2.79
 floor :  0     0     1     1     1     2     2
 cell  :[----------][----------------][----------]  ← 幅 2/3/2。3/3/1 にはならない
```

<!-- note: 出典 blur.rs の mosaic_rgba の w.div_ceil(block) と doc コメント「セル境界は Nearest により均等配分され、寸法が block の整数倍なら block 格子と一致」, image の horizontal_sample（inputx = (outx+0.5)*ratio, left..right を画像範囲へ clamp, *w /= sum）。表の数値は ratio=3/7 の手計算・未実測。担保はテスト mosaic_uniform_image_is_unchanged（一様画像は端まで不変＝重みが正規化されている性質テスト）と mosaic_bounds_distinct_colors_on_non_multiples（色数 <= セル数 6 の上界。境界の丸め実装に依存しない形で書かれている）。「running-sum の端」ページのボックス側の代替案比較（ゼロ埋め／除数縮小／ミラー／エッジ複製）に対応する話だが、こちらは選択肢を持たない代わりに実装の仕様に縛られる。この「選んで解く vs 仕様として受け取る」の対比が、本章のもう一つの持ち帰り -->

---

## resize 任せの代償 — golden でなく性質で縛る

- golden（期待画像との完全一致）は**書ける**が、`image` の実装に**過剰固定**され依存更新で落ちる
- 代わりに**入力によらず成り立つ関係**＝性質だけを並べ、「壊れ方」を捕まえる網にする

| テスト | 何を固定するか |
|---|---|
| `radius_zero_is_identity` | radius 0 は恒等（3 種別共通） |
| `mosaic_preserves_dimensions_on_non_multiples` | 寸法不変（7×5, b=3） |
| `mosaic_is_piecewise_constant_on_exact_grid` | 整数倍寸法ならセル内一定（8×6, b=2） |
| `mosaic_bounds_distinct_colors_on_non_multiples` | **色数 ≤ セル数**（境界の丸め実装に依存しない上界） |
| `mosaic_uniform_image_is_unchanged` | 一様画像は不変（重みの正規化） |
| `mosaic_preview_never_collapses_to_identity` | 縮小率 0.1 でも素通しにならない |

<!-- note: 出典 blur.rs の #[cfg(test)] mod tests の上記 6 本と、ALL_KINDS へ Mosaic を足したことで自動的に覆われる transparent_pixels_do_not_bleed_color / semi_transparent_uniform_image_is_unchanged / fully_transparent_pixels_come_out_zeroed（＝ALL_KINDS に足しただけで透明系 3 本も自動的にモザイクを覆う。ALL_KINDS はモザイク追加時に導入した定数で、それまで [Gaussian, Block] が 3 箇所に直書きされていた＝種別リストの重複が 3 個目を足して初めて露見した）。golden を書けば「セル値が厳密平均でない」ことも「境界の割り当てが 2/3/2 になる」ことも同時に固定できるが、それは image の resize 実装そのものを仕様として固定することになる。区分一定・色数上界・一様不変は resize の仕様として成り立ち続けるはずのもので、これらが壊れたときだけ落ちてほしい。逆に golden だと「仕様は保たれているのに依存更新で落ちる」偽陽性になる。色数上界テストのテスト内コメント「境界の丸め実装に依存しない検証」が設計意図そのもの。gradient(w,h) は全画素が異なる勾配画像でピクセル化の検出用。想定QA「回帰は検出できる？」→ ピクセル化の消失・寸法崩れ・端の暗化はすべてこの 6 本で捕まる。ボックスが box_blur_of_uniform_image_is_unchanged 1 本でほぼ足りたのに対し、モザイクは中核実装より明らかにテストが厚い（行数の比は数え方に依存するので断定しない）＝「ライブラリ任せ」の代償がテスト側に出ている。【用語（スライド高の都合で脚注に置かず口頭で補う）】性質テスト＝個別の入出力ではなく「入力によらず成り立つ関係」を検証するテスト。期待画像を用意できない／したくないときの定石 -->

---

## 性質でも縛れないもの — $b = r+1$ はスケールと可換でない

<!-- 各ラベル末尾の \rule は幅0・深さ0.3em の不可視ストラット。KaTeX は CJK の
     フォントメトリクスを持たず、日本語の字面が算出ボックスより下へ出て Marp の
     auto-scaling SVG のビューポートに切られるため、深さを明示的に確保している -->

$$ \underbrace{\mathrm{round}(rs) + 1}_{\text{実装（スケール → 変換）}\rule[-0.3em]{0pt}{0pt}} \;\neq\; \underbrace{\mathrm{round}\bigl(s(r+1)\bigr)}_{\text{順序を直した案}\rule[-0.3em]{0pt}{0pt}} \;\neq\; \underbrace{s(r+1)}_{\text{理想（整数でない）}\rule[-0.3em]{0pt}{0pt}} $$

- $s$＝プレビューの**縮小率**（3章の `scale`。4000px → 1600px なら $s = 0.4$）
- **プレビューだけ**半径を $rs$ にして丸めてから変換へ（書き出しは $r$ のまま）
- ガウスの $\sigma = r/2$ は**線形** → 丸めを除けばスケールと**可換**
- モザイクの $b = r+1$ は **+1 のオフセット** → 丸めを除いても**可換でない**
- しかも $b$ は**整数**（`u32`）→ 一致する理想 $s(r+1)$ は**そもそも表現できず**、順序を直しても `round` の誤差が残る

<!-- note: 出典 blur.rs の apply_stack_scaled / scaled_radius（round＋下限 1）/ radius_to_block。3章「半径のスケール補正」ページのノートにある「ガウスは sigma'=sigma*scale が厳密に成り立つ」の裏返しだが、実装は radius を丸めてから変換に渡すので、厳密に言えるのは「変換が線形なので丸めを除けば可換」まで。厳密にするなら「radius をスケール→変換」ではなく「変換→block をスケール」＝ block' = max(1, round(b·s)) = round(21×0.4) = 8 とすべきで、これは apply_stack_scaled が種別に依らず radius だけをスケールする設計と衝突する＝未実装の改善案。数式の 3 項目を「理想（整数でない）」としたのは、b が u32 のため s(r+1) = 0.4×21 = 8.4 をそのまま持てないから — つまり中央の「順序を直した案」は理想に一致するのではなく、理想を round した別の近似にすぎない（次ページの ideal 8.4 行と round 8 行がこの 2 つに対応し、ズレの向きが 7% 大きい側から 5% 小さい側へ変わるだけ）。落ちた本文行「丸め由来のズレは 3 種別に共通（ここは差にならない）」＝ round(rs) の丸めはガウス・ボックス・モザイクのどれにも同じく乗るので、種別間の差を生むのは +1 のオフセットと b の整数制約だけ、と口頭で補う。ボックスの d = 2r+1 も +1 を持つが、窓幅は「効き幅」であって格子ではないので、ズレは滲みの差に埋もれて見えない。s は 3章「スケール補正の限界」「近似が残すズレ」で scale と呼んでいたものと同じで、記号として s を使うのは本ページが初出なので必ず口頭でも言い直す。見出しの「性質でも縛れない」＝前ページの 6 本は素通しの回避までしか縛れず、書き出しとの格子一致は縛れないこと（次ページ最終行で明示する） -->

---

## 可換でないズレの実際 — 書き出しとプレビューでセル数が食い違う

```
 export : 4000px / b = 20+1 = 21           → ceil(4000/21)  = 191 セル
 preview: 1600px / b = round(20*0.4)+1 = 9 → ceil(1600/9)   = 178 セル
 ideal  : 1600px / b = 0.4*(20+1) = 8.4    → ceil(1600/8.4) = 191 セル（書き出しと一致）
 round  : 1600px / b = round(8.4) = 8      → ceil(1600/8)   = 200 セル

 プレビューのセルが約 7% 大きく、格子の位相もずれる
 理想の 8.4 なら一致するが b は整数 → 丸めた 8 では今度は 200 セルになる
```

- ぼかしのズレは**滲みの差**、モザイクのズレは**数えられる格子の差** → 目につきやすい
- それでも**プレビューが素通しになる**ことは無い: 丸めた半径の下限が 1
  → $b = r + 1 \ge 2$ ＝ **セルは必ず 2 画素以上**（$b = 1$ なら恒等＝素通し）
- 性質テストが縛るのは**素通しの回避だけ** — **書き出しとの一致は縛れない**

<!-- note: 数値は 4000×3000・radius=20・scale=0.4 の手計算で未実測。プレビュー経路ではリサンプルが 3 回積み重なる（downscale_for_preview の Triangle → モザイクの Triangle 縮小 → Nearest 拡大）。章頭の「平行移動不変でない」がここに効く: 格子に位相があるので、拡大縮小で位相が合わなくなる。想定QA「実用上困る？」→ 隠す目的なので「どの程度隠れるか」は伝わる。厳密な格子合わせが要るのは印刷入稿などの用途で、そのときは「変換→block をスケール」へ直す。ideal / round の 2 行は前ページの右辺 s(r+1) を数値にしたもの: 0.4×21 = 8.4 は 1600/8.4 = 190.47 で ceil すると書き出しと同じ 191 セルになり、右辺が「理想」である根拠がここで見える。ただし block は u32 なので 8.4 は使えず、max(1, round(8.4)) = 8 に丸めると 1600/8 = 200 セルちょうどで、今度は約 5% 小さい側へ外れる。つまり順序を直しても厳密一致は作れず、改善されるのは外れの向きと量だけ（7% 大きい → 5% 小さい）。最終行の根拠は mosaic_preview_never_collapses_to_identity（「golden でなく性質で縛る」ページの 6 本目、縮小率 0.1 でも素通しにならない）で、これは「モザイクが存在すること」の保証であって「書き出しと同じ格子であること」の保証ではない。名前を出さずに「性質テストが縛るのは素通しの回避だけ」と言い換えているので、質問が出たらこのテスト名で答える。想定QA「なぜ ceil で切り上げるのに 1600/8 は端数が出ないのか」→ 1600 が 8 の倍数だから。b が画像幅を割り切るときだけ格子が端まで揃う（「逆なのは端の扱いも」ページの「寸法が block の整数倍なら block 格子と一致」）。次ページで対策の候補を並べる -->

---

## ズレを詰める 4 案 — どれも別のものと引き換え

| 改良案 | 効果 | 代償 | 既存ソフト |
|---|---|---|---|
| 変換→block の順でスケール | **200 セル**＝ズレ 7%→5% | 一致しない。種別ごとの分岐 | 規約あり |
| プレビューも原寸で計算 | **ズレゼロ** | 画素数 **6.25 倍**。可視領域だけ評価する基盤 | **既定で採用** |
| $sb$ が整数になる縮小率 | **格子も位相も一致** | 寸法が半径依存＝縮小キャッシュ無効 | 例なし |
| 「等倍でだけ正確」と明示 | 実装コスト**ゼロ** | WYSIWYG を UI 側に降ろす | **UI で採用** |

- **採っているのは現状**（7% 大きい）— 隠す用途では見え方が伝われば足りる
- 「規約あり」＝縮小レベルを**フィルタに渡して追従させる**（未追従はバグ扱い）
- **前例が無いのは 3 案目だけ** — 縮小して計算するのは**既知の天秤**

<!-- note: 出典 blur.rs の apply_stack_scaled / scaled_radius / radius_to_block, codec.rs の preview_scale / downscale_for_preview, commands.rs の PreviewBase（LRU(1) の縮小ベースキャッシュ）。4 案とも未実装で、数値はすべて手計算・未実測。①「変換→block の順でスケール」: block' = max(1, round(b*s)) = round(21×0.4) = 8 で、前ページの round 行がこれ。格子は 200 セルになり一致しないうえ、apply_stack_scaled が種別に依らず radius だけをスケールする今の設計を崩す＝種別が増えるたびにスケール規則を書くことになる。②「プレビューも原寸で計算」: 3章「スケール補正の限界」で却下した「ブラー→縮小」そのもの。4000×3000 = 12.0M px 対 1600×1200 = 1.92M px で 6.25 倍（1/s^2）。ただしこの 6.25 倍は「プレビュー画像を丸ごと 1 枚作る」設計に由来するもので、画面に出ている領域だけをタイル単位で遅延評価すれば倍率は問題にならない。既存の画像編集ソフトはこの方式で、原寸計算のままズレを出していない。代償は「縮小画像 1 枚を作って PNG で返す」という今の IPC 設計を、需要駆動のレンダリング基盤に置き換えること。③「sb が整数になる縮小率」: b=21 なら s = 8/21 ≈ 0.381 → プレビュー 1524px、b'=8 で ceil(1524/8) = 191 セル。位相まで一致する唯一の案だが、プレビューの寸法が radius ごとに変わるので max_dim をキーにした縮小ベースのキャッシュが半径を動かすたび無効になる＝スライダー連打という本来の用途で必ずミスする。④「等倍でだけ正確と明示」: アルゴリズムを変えず UI で解く案。大手の画像編集ソフトが「正確なのは 100% 表示のときだけ」を仕様として公開し、フィルタのダイアログに等倍のプレビュー窓を別に持たせているのがこの形。最終行の「既知の天秤」の根拠: GEGL は縮小レベルでのプレビュー描画を GEGL_MIPMAP_RENDERING という環境変数で持つが default: false の実験的機能で、level は全 op の process(GeglOperation*, void*, void*, glong, const GeglRectangle*, gint level) に必ず渡る一方、追従するかは op ごとの責務。追従できていない op は「縮小プレビューが誤る」バグとして個別に修正されてきた（emboss / linear-gradient / radial-gradient）。つまり本アプリの b = r+1 が可換でない件は固有の粗さではなく、速度を採ったときにフィルタ側が引き受ける既知の課題。出典は gegl.org/environment.html と gegl.org/release-notes.html、および Adobe の公式コミュニティ回答。未確認が 2 点あるので断定しない: ①GEGL の pixelize が level を honor するかはソース未読 ②Adobe 側の出典は調整レイヤーとブレンドについての記述で、フィルタも同経路かは非公開。質問されたら製品名を出して答えてよいが、スライドには出さない方針。判断: 隠蔽が目的なので格子の一致は要件でない。格子そのものが成果物になる用途（印刷入稿など）が出てきたら ① か ③ を検討する＝YAGNI。想定QA「モザイク以外は？」→ ガウスの σ=r/2 は線形なので丸めを除けば一致し、ボックスの窓幅も滲みの差に埋もれる。この表が要るのはモザイクだけ。本編はここまでで、次はまとめ -->

---

# まとめ

- **1. 技術選定**: Tauri v2、ピクセル処理は **Rust に一本化** — 自前はボックスだけ
- **2. アーキテクチャ**: Rust=ピクセル/FS、Web=UI/状態 — **境界は IPC 1 本**
- **3. WYSIWYG プレビュー**: 書き出しと**同一経路** — ズレは**スケール補正**に集約
- **4a. ボックス（書くしかない）**: 型が合わず自前 → **分離＋running-sum**で $O(n \cdot r^2) \to O(n)$
  — 端は `clamp` を**選んで**解き、境界処理は **1 箇所に閉じる**
- **4b. モザイク（合成で済む）**: `resize` 2 回・13 行 — 端は**ライブラリ仕様として受け取る**
  — 正しさは **golden でなく性質**で縛る／**格子のズレ**は詰め切れず残る

<!-- note: 各章末にあった持ち帰り行はこの1枚に集約した（番号は章番号と対応。4 は章タイトルの二部構成に合わせて 4a/4b に割った）。1 行目の末尾は「ライブラリに無いボックスブラーだけ自前」→「合成できないボックスだけ自前」と直したうえで、最終的に「自前はボックスだけ」まで詰めた（前者は 1 行に収まらず 2 行目に数文字だけ落ちていた）。「合成でも作れないものだけ自前」という基準そのものは 4a「書くしかない」／4b「合成で済む」が真下で言い切っているので、1 行目で繰り返す必要がない。口頭では「モザイクも image/imageproc には無いが resize の合成で済んだ＝『無い』の基準は『合成でも作れない』」と補う。質問の入り口になりやすいのは 4a の O(n) 化、4b の格子のズレ、3 の WYSIWYG。3 と 4b は対で話す: ズレの発生源は半径のスケール補正 1 箇所に集約できているが、モザイクだけは b = r+1 がスケールと可換でないため補正しても消えない。4b の「詰め切れず残る」は前ページの 4 案の要約で、どれも別のコストと引き換えなので現状維持を選んでいる。4b の「golden でなく性質」は本発表で唯一のテスト設計の持ち帰りなので、テスト寄りの聴衆にはここを入り口にする。4 章の見出しは観点名ではなく前スライドの用語を引き継ぐ連鎖にしてあるので、質疑で観点別に拾い直したいときは 4 章冒頭「4 章の要点」のノートに置いた観点別の対応表を使う -->
