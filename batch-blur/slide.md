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

画像の場合は具体的なコンテンツは隠したいが、表示の大まかなイメージやレイアウト構成などを提示したいためにぼかし（ブラー）を適用したいことがある。

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
## 4. 画像処理アルゴリズム — ボックスブラーの O(n) 化と、モザイクの合成

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
| 処理速度（ピクセル処理の速さ） | **低**（中規模バッチで差が出ない） |

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
  - 中規模バッチでは**速度差が出ず**、一般層への単一バイナリ配布が効く
- 速度が**ボトルネックになったら** **Rust 圏内で差し替え**（`imageproc` → `libblur`）

| もし要件が… | より適する選択 |
|---|---|
| 超大規模・巨大画像で低メモリ | libvips 系（sharp / bimg / NetVips）|
| サーバ / CLI バッチ | Python+OpenCV / Go+bimg |
| GPU・リアルタイム映像 | C++/Skia / wgpu |
| **中規模・配布重視の GUI（＝本件）** | **Tauri v2 × Rust** |

<!-- note: 結論=要件適合。速度差が出ないため imageproc で十分、差し替え余地を残し現状維持が妥当。この単一実装の選択が次章 lead の「Rust ⇔ Web の責務分割」へ渡る -->

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

| 元画像 | scale | UI radius | preview_radius |
|---|---|---|---|
| 4000×3000 | 0.40 | 20 | 8 |
| 4000×3000 | 0.40 | 1 | 1（round は 0 → **下限 1**）|
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
- 割り切り: 残る誤差は実用上ほぼ使わない領域 → **問題化したら詰める**（YAGNI）

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
# ボックスブラーの O(n) 化と、モザイクの合成

---

## ガウス vs ボックス — 核の形がぼけの質を決める

- **ガウス**: 中心ほど重い**釣鐘型の加重平均** → 滑らかで自然なぼけ
- **ボックス**: **すべて同じ重み**で足して割る**単純平均** → 均一に均す
- 重みが一律 → 後述の **O(n) 化の余地**（前半の主役はボックス経路）

```
 重み        ガウス核                重み        ボックス核
  │           █ █ █                   │   █ █ █ █ █ █ █ █ █  ← すべて同じ重み
  │         █ █ █ █ █                 │   █ █ █ █ █ █ █ █ █
  │     █ █ █ █ █ █ █ █ █             │   █ █ █ █ █ █ █ █ █
  └──────────────────────→ x          └──────────────────────→ x
   中心ほど重い＝滑らかなぼけ          窓内すべて同じ重み＝単純平均
```

<!-- note: 出典 blur.rs の blur_channels（match が種別ごとの分岐点。blur_rgba がアルファ処理を挟んで委譲する）, domain/filter.rs の FilterKind（Gaussian / Block / Mosaic）。本章は前半でボックス（畳み込み）、後半でモザイク（resize ベース）を扱う。2D で書くとボックス核は K = (1/d²)·1_{d×d} だが、d（窓幅）や 1/d² の記法は「自前ボックスの前提」ページ以降で導入するため、このページは形の対比だけに留める。ガウスの重みは exp(-x²/2σ²) 型で ±2σ からほぼゼロ。前半の O(n) 化の話は「ボックス」経路に限る点をここで明言する -->

> > > **カーネル（核）**＝出力1画素を決めるとき、周囲の画素に掛ける重みの表。形がぼけの質を決める／**畳み込み（convolution）**＝窓をずらしながら「重み×画素値」の総和を取る演算。ブラー＝カーネルとの畳み込み／**ボックス（box）**＝UI 表記の「ブロック」と同一（コードは `FilterKind::Block`）。本文は「ボックス」で統一

---

## ガウスは委譲、ボックスは自前 — 型が合うものは使い、無いものだけ書く

- **ガウス**: `imageproc::gaussian_blur_f32` に**委譲** — ジェネリックで `RgbaImage` をそのまま渡せる
- **ボックス**: `imageproc::box_filter` は **`GrayImage`（グレースケール）専用**
  → 全面 `RgbaImage` の本アプリでは使えない
- `image` crate の `blur` / `fast_blur` も**ガウス系のみ**で、ボックス平均そのものは提供なし
- → **ボックスだけ自前実装**。再発明ではなく「無い車輪」だけ作る

<!-- note: 出典 imageproc 0.25.1 の filter::box_filter（box_filter(image: &GrayImage, ...) で Luma<u8> 固定シグネチャ）, filter::gaussian_blur_f32<P: Pixel>（ジェネリック）。box_filter を RGBA に使うにはチャネル分解4回＋再合成が必要で、それを書くくらいなら running-sum ごと自前化した方が単純。fast_blur はボックス3回反復によるガウス近似（Kovesi 2010）で「ブロック平均そのもの」ではない。実は imageproc の box_filter も内部は running-sum 系 O(n)＝自前化の動機はアルゴリズムではなく「型」。ただし box_filter は除算が切り捨てで、自前版は (sum+half)/d の四捨五入という品質差もある。想定QA「ガウスも自前で O(n) 化できるのでは？」→ ボックス3回反復で近似可能（fast_blur がまさにそれ）だが MVP では YAGNI。1章の「速度が問題化したら libblur へ差し替え」と同じ判断軸 -->

> > > **ジェネリック**＝画素型を差し替えられる関数の書き方（`<P: Pixel>`）。`gaussian_blur_f32` は RGBA でも Gray でも呼べるが、`box_filter` は引数の型が `GrayImage` に固定されている

---

## 自前ボックスの前提 — 半径 $r$ と窓幅 $d = 2r + 1$

- **r（半径）**: 中心画素から**左右いくつ先まで**混ぜるか — UI スライダーの値そのもの
- **d（窓幅）**: 左 $r$ + 中心 $1$ + 右 $r$ = $2r+1$ — **必ず奇数**（中心が 1 画素に定まる）
- 例: r=1 → d=3、r=20 → d=41。2D では窓は $d \times d$ の正方形（面積 $d^2$）

```
 半径 r = 2 の窓を 1D で見る

        ←── r ──→       ←── r ──→
  … │  ▓  │  ▓  │  ●  │  ▓  │  ▓  │ …

    └───────  窓幅 d = 2r+1 = 5  ───────┘

  ● = 中心画素、▓ = 一緒に平均する近傍
```

<!-- note: 出典 blur.rs の box_blur_rgba 冒頭（let r = radius as i64; let d = 2 * r + 1; コメント「window 幅（除数, 一定）」）。d を偶数にしないのは、窓の中心が画素と画素の間に落ちて出力が半画素ずれる（位相シフト）ため。奇数窓は畳み込みの標準的な取り方。r=0 は d=1（自分 1 画素の平均＝恒等）で、blur_rgba の radius==0 早期 return と整合する。以降の使い分け: 計算量の話は UI 入力である r で語り（O(n·r²) など）、実装の窓幅・除数の話は d で語る（(sum+half)/d など）。r と d は 1 対 1 なのでどちらで語っても同じことの言い換え -->

---

## 素朴な 2D 実装 — 窓 $d \times d$ の総和で $O(n \cdot r^2)$

- 各画素で $d \times d$ の窓を総和して平均 → 仕事量 = $n \times d^2$
- **半径2倍で4倍遅い**: 12MP・r=20 → 窓 41²=1681 → **約200億サンプル/チャネル**
- この構造は磨いても消えない → **窓の「形」に注目**（次ページ）

```
 出力1画素ごとに窓 d×d を丸ごと読み直す（r=1, d=3 → 9 画素）
  ┌──┬──┬──┬──┬──┐     ┌──┬──┬──┬──┬──┐
  │▓ │▓ │▓ │  │  │     │  │▓ │▓ │▓ │  │     ● = 出力画素
  ├──┼──┼──┼──┼──┤     ├──┼──┼──┼──┼──┤
  │▓ │● │▓ │  │  │  →  │  │▓ │● │▓ │  │     ▓ = 読む近傍（d² = 9）
  ├──┼──┼──┼──┼──┤     ├──┼──┼──┼──┼──┤
  │▓ │▓ │▓ │  │  │     │  │▓ │▓ │▓ │  │     1 画素進むと 9 画素すべて読み直し
  └──┴──┴──┴──┴──┘     └──┴──┴──┴──┴──┘
```

<!-- note: この素朴版はコード上に存在しない（対比用の理論値）。cost = n·(2r+1)² = O(n·r²)、r=20 なら窓 41×41 = 1681。d の定義は blur.rs の box_blur_rgba、半径上限は domain/filter.rs の MAX_RADIUS=500、UI 上限は FilterControls.tsx の MAX_RADIUS_UI=100 → r=100 なら窓 201×201 = 40401 画素を読んで出力1画素。200億の内訳 = 12M 画素 × 1681 ≈ 2.0×10^10/チャネル（×4チャネル）。1サンプル 1ns でも 20秒/チャネル級で、3章のスライダー追従（debounce 130ms）とは3桁合わない。「r² が効く」の直観＝窓は面積なので、1次元の半径を2倍にすると読む量は4倍。想定QA「実測は？」→ 素朴版は実装していないので理論値。ただし仕事量が窓面積に比例するのは自明で、以降の削減率（1681→82→約4）はこの値を分母に語れる。想定QA「UI が 100 までなのに MAX_RADIUS が 500 なのは？」→ ドメインの上限はプリセット等将来の入力経路も縛る契約で、UI スライダーはその部分集合 -->

> > > **O 記法**＝入力が大きくなったとき計算量が「どう増えるか」の形だけを比べる記法（定数倍は無視）。ここでは $n$＝画素数、$r$＝ブラー半径。$O(n \cdot r^2)$＝「画素数に比例、かつ半径の2乗に比例」

---

## 窓は縦横に分離できる — 「平均の平均」は全体の平均

$$ K_{\text{box}} = k \otimes k, \quad k = \tfrac{1}{d}\,[1, 1, \dots, 1] $$

- $d \times d$ 窓の単純平均 = **$d^2$ 画素を足して $d^2$ で割る** → 1画素あたりの重みは一律 $1/d^2$
- この $1/d^2$ は $1/d \times 1/d$ の**外積**に分解できる（**分離可能**）
- つまり「$d \times d$ の平均」＝「**横 1D 平均 → その結果を縦 1D 平均**」の2段で同じ結果
- 読みが $d^2 \to 2d$ に減る: r=20 で **1681 → 82（約20分の1）**

<!-- note: 分離できる条件はカーネルがランク1（外積1組で書ける）こと。ガウス・ボックスは該当、円形カーネルは非該当。「平均の平均=全体平均」が成り立つのは重みが一律だから（総和の順序交換）。ガウスも同様に分離でき、imageproc は gaussian_blur_f32 が separable_filter_equal を呼んで分離実装している -->

> > > **分離可能性（separability）**＝2D カーネルが「横1本 ⊗ 縦1本」の外積に分解できる性質。$d \times d$ の読みが $d + d$ に減る（分解できない例: 円形の窓）／**⊗（外積）**＝縦ベクトル×横ベクトルで行列を作る演算

---

## 分離の実装 — 水平 → 垂直の 2 パスで $O(n \cdot r)$

```
    2D 窓を一括（読み d² = 9）      水平パス src→tmp      垂直パス tmp→out
    ┌───┬───┬───┐                                              ▓
    │ ▓ │ ▓ │ ▓ │                                              │
    │ ▓ │ ● │ ▓ │        =        ▓ ─ ● ─ ▓         ∘          ●
    │ ▓ │ ▓ │ ▓ │                                              │
    └───┴───┴───┘                                              ▓
                              （各行を 1D 平均）   （tmp の各列を 1D 平均）
                                  読み 3 + 3 = 6 回/画素（r=20 なら 1681 → 82）
```

- `box_blur_rgba` 本体はそのまま 2 パス: **水平 src→tmp / 垂直 tmp→out**（中間バッファ 1 枚）
- ガウスも imageproc 内部で分離済み → **ここまでは両者同じ土俵**
- ただし「r に比例して遅くなる」構造は残る → 次ページで **r を消す**

<!-- note: 出典 blur.rs の box_blur_rgba（tmp 確保 → 水平パス → 垂直パス）。チャネル c を走査軸の外側に置き（水平は y→c→x、垂直は x→c→y の三重ループ）sample クロージャで src を引く構造。カーネル自体は 4 チャネル独立で、アルファの解釈は blur_rgba に集約 — 半透明を含む画像は premultiply→blur→unpremultiply（適用は blur_rgba、ヘルパーは premultiply / unpremultiply）で透明画素の色にじみを防ぎ、a=0 の出力は (0,0,0,0)。全不透明（スクショ等の大多数）は変換を省く fast path で結果は同一。担保はテスト transparent_pixels_do_not_bleed_color。tmp を u8 で持つため水平パスの丸め誤差（±0.5LSB 程度）が垂直パスへ伝播する割り切りもある（i16/f32 中間ならメモリ2〜4倍。imageproc の box_filter も同じ構造で、ソースに「x/y 両方で丸め誤差を払う」TODO コメントが残る＝標準的な割り切り。一様画像では丸めが発生しないので、境界スライドの不変性テストはこの誤差の影響を受けない）。ガウスは重みが位置で変わるため次ページの running-sum は使えない。σ=r/2 だと imageproc のカーネル半径は ceil(2σ)≒r なので、ガウス経路は O(n·r) のまま＝半径を上げるとガウスだけ遅くなる（体感差の説明） -->

---

## r を消す — running-sum（スライディング窓）で $O(n)$

$$ \text{sum} \mathrel{+}= s(x{+}r) - s(x{-}1{-}r), \quad s(i) = \text{位置 } i \text{ の画素値} $$

- 窓を1つ右へ → **入る1画素を足し、出る1画素を引く**だけ。総和は作り直さない
- 加算1・減算1・除算1/パス（**2パスで約4更新/画素**）— 窓幅 $d$ に依存しない

```
     ┌────── 前の窓 sum(x−1) ──────┐
  … │ s0 │ s1 │ s2 │ s3 │ s4 │ s5 │ …
          └────── 次の窓 sum(x) ──────┘

  sum(x) = sum(x−1) − s0（出る画素）＋ s5（入る画素） — 共通の s1〜s4 は触らない
```

<!-- note: 出典 blur.rs の box_blur_rgba（水平パス・垂直パスとも「初期和 → 差分更新」の形）。式の s(i) は実装では各パスの sample クロージャ（境界 clamp 込みの画素読み出し、clamp の中身は「端でも正確に」のページで扱う）。窓を丸ごと総和するのは各行・各列の先頭の1回だけ＝厳密な時間計算量は O(n + (w+h)·r) で、r ≪ min(w,h) なら実質 O(n)。また O(n) は時間の話で、空間は tmp バッファ1枚ぶん O(n) の追加メモリを使う。想定QA「除算が毎画素あるのに定数？」→ d は固定なので O(1)。「並列化・SIMD は？」→ 行・列単位で自明に並列化可能だが未実施（1章の「速度が問題化したら libblur」と同じ YAGNI 判断）。「実測は？」→ ベンチ未整備。検証するなら「r を変えても実行時間がほぼ変わらないこと」を criterion で -->

> > > **running-sum（移動和）**＝直前の窓の合計を使い回し、出入りする端の差分だけで次の合計を得る技法。「移動平均」と同じ原理。総和の再計算 $O(d)$ が差分更新 $O(1)$ になる

---

## running-sum の細部 — 移動和は整数で正確に

```rust
let mut sum: i64 = (-r..=r).map(sample).sum();  // 初期和: 行・列の先頭で1回だけ O(r)
sum += sample(x + r) - sample(x - 1 - r);       // 差分更新: 以降は1画素あたり2読み
tmp[i] = ((sum + half) / d) as u8;              // 固定除数 d の整数四捨五入（half = d/2）
```

- **u8 → i64** に昇格して累積 — 負の座標計算（$x{-}1{-}r$）と桁あふれの両方に余裕
- 整数の加減算は正確 → **誤差の蓄積が構造的にゼロ**（sum は常に窓総和と厳密一致）
- 状態は `sum` の **1変数**のみ — 同じ O(n) の定番「**積分画像**」より省メモリ
- 削減の全体像: **1681 → 82 → 約4 サンプル/画素**（r=20）— 画素ごとの更新から **r が消えた**

<!-- note: 出典 blur.rs の box_blur_rgba 水平パス（実コードの添字は tmp[(row + x as usize) * 4 + c]）。和の最大は 255×d（r≤500 で d=1001 → 約 255K）で i64 には大余裕だが、x-1-r で負の座標計算があるため符号付きが必須。(sum+half)/d は正数の四捨五入イディオム。imageproc の box_filter は切り捨て除算なので、ここは自前版の方が丁寧。浮動小数の running-sum は加減算のたびに丸めが乗って誤差が蓄積しうるが、整数なら sum は常に厳密。ただし「正確」の範囲は移動和 sum まで — 水平パスの結果を u8 に丸めて渡すため、理想の 2D 平均との差は ±1LSB 程度残る（「分離の実装」ページ note の割り切りと同じ話）。running-sum は状態が sum 1変数でキャッシュ局所性も良い -->

> > > **積分画像（summed-area table）**＝左上からの累積和を前計算し、任意の矩形の総和を4点の参照で得るデータ構造。これも O(n) 化の定番だが、画像1枚分の追加メモリと桁あふれ管理が要る

---

## 端でも正確に — 境界の扱い（edge clamp）

- 端では窓が画像外にはみ出す → `clamp_idx` が座標を**軸の範囲内**に丸め、**端の画素を複製**して読む
- 除数 $d$ は端でも**縮めない**: 窓は常に $d$ 画素ぶん埋まる → **端が暗くならない**
- 境界処理は `sample` クロージャ **1箇所に局所化** — メインループに端専用の分岐を持ち込まない

```
 左端 x=0（r=2, d=5）の窓 — 画像外は clamp_idx が端へ折り返す
   はみ出し ──┐         ┌── ここから実画素
  [ s(0)  s(0) │ s(0)  s(1)  s(2) ]     clamp_idx(−2) = clamp_idx(−1) = 0
    複製   複製
  除数は d=5 のまま → 一様画像なら端でも 平均 = 元の値（暗くならない）
```

<!-- note: 出典 blur.rs の clamp_idx, box_blur_rgba の doc コメント「端でも減算されない（暗くならない）」。clamp_idx(i, n) の n は走査軸の長さで、水平パスなら幅 w、垂直パスなら高さ h（同じ関数を両軸で使い回す）。O 記法の n（画素数）とは別物なので、口頭では「軸の長さ」と言う。clamp は端画素の重みが実質増える（端1画素が最大 r+1 回サンプルされる）バイアスと引き換えに、ループ本体を単純に保つ。ぼかしの目的（隠す）には十分。想定QA「幅より半径が大きい画像（w < r）は？」→ clamp が全部端に張り付くだけで安全。事前条件は 1x1 以上（blur_rgba の doc コメント）で 1x1 でも成立 -->

> > > **エッジ複製（edge clamp / replicate padding）**＝画像の外側を「最も近い端の画素が続いている」とみなす境界規則。ゼロ埋め（外を黒とみなす）、ミラー（折り返し）と並ぶ定番の1つ

---

## なぜ clamp か — 境界処理の代替案比較

| 方式 | 端の見え方 | running-sum との相性 |
|---|---|---|
| ゼロ埋め | **端が黒ずむ**（0 が混ざる） | ○ そのまま使える |
| 除数を実画素数に縮小 | 暗くならない | × 端分岐＋除数の再計算で単純さが崩れる |
| ミラー（折り返し） | clamp とほぼ同等 | △ 添字の折り返し計算が複雑になるだけ |
| **エッジ複製（採用）** | **暗くならない** | **○ `clamp` 1行で済む** |

- 担保: `box_blur_of_uniform_image_is_unchanged` — **一様画像は端の1画素まで不変**
- ゼロ埋めや除数のバグならこの性質テストが**即 fail** — 安価で強い回帰テスト
- imageproc のガウス経路も同じ edge clamp → **ガウスとボックス**で境界の見え方が揃う

<!-- note: 出典 テスト box_blur_of_uniform_image_is_unchanged（半径3・9×9 一様画像 [40,80,120,200] の完全一致テスト。premultiply 往復込みの blur_rgba 経路でも同じ一様画像が不変なことはテスト semi_transparent_uniform_image_is_unchanged が担保）。一様画像不変は「境界の正規化が正しい」ことの性質テストで、期待画像を用意せずに境界バグを検出できる。ゼロ埋めは窓総和に 0 が混ざり端が周辺減光状に暗くなる。「除数を窓内の実画素数にする」正規化でも暗化は防げるが、差分更新に端専用の分岐と除数の再計算が入り running-sum の単純さが崩れる。ミラーは効果がほぼ同等な一方、running-sum の差分更新で添字の折り返し計算が入り、clamp（i.clamp(0, n-1) の1行）より複雑になる。imageproc の horizontal_filter / vertical_filter も同じ edge clamp（max(0, min(x, w-1))）で、ガウスとボックスの境界の見え方が揃う。3章の「単一実装」は経路の話、ここはガウス／ボックス間の整合の話（モザイクは resize が境界の重みを正規化するため別系統だが、一様画像不変はテスト mosaic_uniform_image_is_unchanged が同じく担保する）。このガウス／ボックスの橋が次ページの radius ↔ sigma（1本のスライダー）へ渡る -->

---

## radius ↔ sigma — 種別ごとの固定変換で1本のスライダーに

$$ \text{sigma} = \text{radius} / 2 $$

- UI の強度は **radius 1本**。ガウスの強度は本来 **sigma** → 種別ごとの**固定変換**で接続
  ガウス `sigma=radius/2`／ボックス `d=2r+1`／モザイク `block=radius+1`
- **/2 の根拠**: ガウスの重みが実質届くのは **±2σ** まで → それをボックスの **±r** に合わせる（次ページ）
- 数学的な等価変換ではない — **実装上の取り決め**（変換は1関数に固定、変えるなら1行）
- radius=0 は `blur_rgba` が早期 return — imageproc は `assert!(sigma > 0)` で **panic** するため

<!-- note: 出典 blur.rs の radius_to_sigma / radius_to_block / blur_rgba の radius==0 早期 return; imageproc の gaussian_blur_f32 の assert!(sigma > 0.0)。分散を一致させる厳密値は離散窓 [-r,r] で σ=√(r(r+1)/3)（連続近似で r/√3 ≈ 0.577r）。採用値 0.5r との差は約15%で、厳密対応を捨てても体感差は小さく「2で割る」単純さを優先した取り決め。radius==0 の早期 return は panic 防御と「恒等」の事後条件を兼ね、防御を境界の1箇所（blur_rgba）に置くことで内部の box_blur_rgba は radius>=1 前提で書ける。3章との接続: プレビューは radius を scale 倍してから変換するので sigma も自動で scale 倍される（スケール補正が種別を問わず通る。モザイクの block も同様に radius 側でスケールされる）。想定QA「なぜ UI を sigma にしない？」→ box に sigma は無く、共通の直観は「何ピクセルぼかすか」＝radius。想定QA「モザイクの変換は？」→ radius_to_block で block = radius + 1（radius 0 は block 1 ＝恒等、正の radius は必ず可視のピクセル化。担保はテスト radius_to_block_contract） -->

> > > **sigma（σ・標準偏差）**＝ガウス分布の広がり幅。ガウスブラーの強度は本来 σ で指定し、重みの約95%が ±2σ に収まる／**固定変換**＝アプリ内の取り決めとして1関数に固定した対応。数学的な等価変換ではない

---

## sigma = radius/2 の直観 — 「効く範囲」が揃う

```
 同じ radius=r の「効く範囲」

  box   : █ █ █ █ █ █ █ █ █      ← ±r を等しく平均（窓 d = 2r+1）

  gauss : ▁ ▂ ▄ █ █ █ ▄ ▂ ▁      ← σ = r/2 → ±2σ = ±r でほぼ減衰

          -r      0      +r        （imageproc の打ち切り半径 ceil(2σ) ≒ r）
```

- ガウスは **±2σ の外はほぼ重みゼロ**（約95%が ±2σ 内）→ 実効範囲は **±2σ**
- 「効く範囲」をボックスの **±r** に揃える: $2\sigma = r$ → **$\sigma = r/2$**（/2 はここから）
- 実装も一致: imageproc は核を **±ceil(2σ) で打ち切る** → σ=r/2 で読む近傍は**ちょうど ±r**

<!-- note: 出典 imageproc の gaussian_kernel_f32（kernel_radius = ceil(2.0*sigma)）。±2σ に重みの約95%が収まるので打ち切りの影響は小さい。導出の向きは「揃えたい範囲が先、σ が後」: box の ±r という見た目の効き幅を基準に、ガウスの実効範囲 ±2σ をそこへ一致させると σ=r/2 が出る。結果、同じスライダー値でガウスとボックスの効き幅の体感が揃う。blur.rs は事前条件・事後条件をコメントで明文化し（blur_rgba / apply_stack / apply_stack_scaled の doc コメント）radius_to_sigma を「契約」と呼ぶ（DbC の実践）。ここまでが畳み込み族。次ページから、核を持たない3つ目（モザイク）へ移る -->

---

## 畳み込みではない — モザイクは「定義域」を量子化する

- **ガウス／ボックス**: 画素ごとの加重平均（畳み込み）→ 出力は**連続に変化する**
- **モザイク**: セル単位で**1色に潰す** → 出力は**区分一定**（階段）
- 同じ「隠す」でも捨てるものが違う: ぼかし＝**高周波**／モザイク＝**セル内の位置情報**
- 決定的な差は**平行移動不変でない**こと — 格子に**位相**がある（この一点が最後に効く）

```
 元信号   ▁▂▃▅▇█▇▅▃▂▁▃▅▇█▇▅▃
 ぼかし   ▂▃▄▅▆▆▆▅▄▄▄▅▆▆▆▅▄▃    なだらか（値が連続に変化）
 モザイク ▃▃▃▆▆▆▄▄▄▅▅▅▆▆▆▄▄▄    階段（セル内は同値）
          └─b─┘└─b─┘└─b─┘        格子の位置は入力に依らず固定
```

<!-- TODO: モザイク適用前後の比較画像 -->
<!-- note: 出典 blur.rs の blur_channels（match の 3 本目が Mosaic）, mosaic_rgba の doc コメント「block >= 2 の出力は ceil(w/b) x ceil(h/b) 個のセルで区分一定」, domain/filter.rs の FilterKind::Mosaic（コメントに block = radius + 1）。「畳み込み」の定義は「ガウス vs ボックス」ページの脚注をそのまま再利用する。想定QA「モザイクも畳み込みで書ける？」→ セル平均は box 畳み込み＋ダウンサンプルの合成であって、格子が入力に依らず固定されるぶん平行移動不変にならない＝厳密には畳み込みではない。この非不変性が最後の「プレビューと書き出しで格子がズレる」話の根になる。想定QA「ぼかしとどちらが強く隠せる？」→ 本アプリはどちらも秘匿の保証はしない。強度はブロックを大きくする運用側の話 -->

> > > **区分一定（piecewise constant）**＝出力が有限個の領域ごとに一定値になる性質。モザイクのセルがこれ／**平行移動不変**＝入力を1画素ずらすと出力もちょうど1画素ずれる性質。畳み込みは満たすが、格子が固定されるモザイクは満たさない

---

## 無い車輪は2種類 — 「書くしかない」と「合成で済む」

- `image` / `imageproc` に **pixelate / mosaic は無い** — ボックスと同じ「無い」
- ただしモザイクは**既にあるもので書ける**: `resize` を 2 回呼ぶだけ
- ボックス＝**書くしかない**（`box_filter` は `GrayImage` 固定で型が合わない）
  モザイク＝**合成で済む**（依存追加ゼロ・実体 13 行）
- 運用ルール: **まず合成を探し、合成できない時だけ書く** — 1章「無い車輪だけ作る」の運用形

```rust
fn mosaic_rgba(img: &RgbaImage, block: u32) -> RgbaImage {
    if block <= 1 { return img.clone(); }              // 恒等
    let (w, h) = img.dimensions();
    let small = resize(img, w.div_ceil(block), h.div_ceil(block), Triangle); // 縮小＝平均
    resize(&small, w, h, Nearest)                      // 拡大＝複製
}
```

<!-- note: 出典 blur.rs の mosaic_rgba（doc コメントを除く実体は 13 行。スライドは use 省略・改行を詰めた表示）, image::imageops の resize / FilterType。imageproc 0.25.1 の filter に pixelate 相当は無く、image 側にも無い（探した上で「合成」に倒した）。image は既に必須依存なので依存追加はゼロ。同じ resize(…, Triangle) は codec.rs の downscale_for_preview でも使っており、既存イディオムの再利用でもある。1章「速度が問題化したら差し替え」の伏線に対しては、モザイク経路の差し替え先は libblur ではなく fast_image_resize になる。想定QA「13 行で終わるなら自前ブロック平均でもよかったのでは？」→ 書けるが、正規化・端の扱い・分離パスを自分で持つことになり、ボックスと同程度のコード量に戻る -->

---

## セルの定義 — block $b$ とセル数 $\lceil w/b \rceil \times \lceil h/b \rceil$

- **b（ブロック辺長）**: セル1辺の画素数。`radius_to_block` で **b = r + 1**
- `r=0 → b=1` ＝**恒等**／`r≥1 → b≥2` ＝**必ず可視**（doc の事後条件そのもの）
- ボックスの $d = 2r+1$ とは**別の基準** — 揃えたのは「効き幅」ではなく「**0 と正の境目**」
- セル数は**切り上げ** — 端が半端でもセルを捨てない

```
  画素  │ 0 │ 1 │ 2 │ 3 │ 4 │ 5 │ 6 │    w = 7, b = 3 → セル数 ceil(7/3) = 3
  block └── 0 ──┘└── 1 ──┘└─ 2 ─┘      ← b で区切った「概念上の block」
```

<!-- note: 出典 blur.rs の radius_to_block（事前条件 radius <= MAX_RADIUS、事後条件 >= 1）, mosaic_rgba の block <= 1 早期 return, テスト radius_to_block_contract, domain/filter.rs の MAX_RADIUS=500, FilterControls.tsx の MAX_RADIUS_UI=100（b は最大 501、UI 経由なら 101）。記号の使い分けを明言: 本ページ以降の b はモザイクのブロック辺長で、ボックス節の d（窓幅 2r+1）とは別物。想定QA「なぜ b = 2r+1 に揃えないのか」→ 契約が「0 は恒等・1 以上は可視」だけで、ボックスと効き幅を揃える設計にはなっていない。結果として同じスライダー値ならモザイクの方が効きが弱い（b=r+1 vs d=2r+1）という割り切りで、正直にそう話す -->

> > > **$\lceil x \rceil$（天井関数）**＝x 以上の最小の整数。コードでは `u32::div_ceil` が対応／**block**＝コード上の引数名。UI の radius とは `radius_to_block` の1関数だけで接続する

---

## 縮小は平均・拡大は複製 — Triangle → Nearest の非対称

| 縮小 ＼ 拡大 | **Nearest（複製・採用）** | Triangle（補間） |
|---|---|---|
| **Triangle（平均・採用）** | **モザイク**（セルが立つ） | ただのぼかし（セルが溶ける） |
| Nearest（点サンプル） | **隠蔽にならない**（1画素が原寸で復活） | 弱いぼかし |

- **縮小で情報を捨て、拡大で戻さない** — この非対称がモザイクの本体
- 縮小に平均が要る: `Nearest` だと**セルの代表 1 画素がそのまま生き残る**（文字の芯が読める）
- 拡大に複製が要る: `Triangle` だと境界が補間されて**ブロックが溶ける**＝ぼかしに退化
- 「`resize` を 2 回」は**どのフィルタでもよいわけではない** — 2 回それぞれに役割がある

<!-- note: 出典 image の FilterType（Nearest は support 0.0、Triangle は support 1.0）, imageops/sample.rs の resize（vertical_sample → horizontal_sample の 2 パス＝resize 自体が分離可能フィルタ。「窓は縦横に分離できる」ページの再登場）。Nearest 拡大は各出力が floor((x+0.5)·small_w/w) の 1 画素を読むだけ（タップ 1・重み 1）なので、セル内が厳密に同値になる。想定QA「Lanczos 縮小では？」→ リンギングでセル値が元の値域外へ振れる（clamp される）ので、平均としては不適。想定QA「拡大を Nearest 以外にする用途は？」→ いわゆるソフトモザイク表現。本アプリは隠す目的なので硬いセルを選ぶ -->

---

## Triangle は「厳密なブロック平均」ではない

- `image` の `resize` は**縮小率ぶんカーネルを引き伸ばす** → タップは **±b（約 2b 画素）**
- つまりセル値は「block 内 b 画素の平均」ではなく、**隣の block まで届くテント加重平均**
- 厳密なブロック平均が要るなら **`thumbnail` が実在する** — 採らなかった理由はノート

```
 出力セル 1 の正規化重み（block = 画素 3,4,5、ratio = 7/3）
   画素   1      2   │  3      4      5
   重み  0.06   0.24 │ 0.41   0.24   0.06
        └ 隣の block ┘└─── 自分の block ───┘
           計 0.29           計 0.71        ← 約 29% が隣から来る
```

<!-- note: 出典 image 0.25.10 の imageops/sample.rs の horizontal_sample / vertical_sample（let sratio = if ratio < 1.0 {1.0} else {ratio}; let src_support = filter.support * sratio; と重み正規化 *w /= sum）, triangle_kernel(x) = 1 - |x|, thumbnail → thumbnail_sample_block（矩形の厳密平均）。数値は ratio=7/3・出力 x=1 の手計算＝ソースからの導出であって実測ではない（「素朴な 2D 実装」ページの理論値と同じ扱い）。thumbnail を採らなかったのは Enlargeable 制約と整数比前提の設計があり、resize 1 行の単純さを崩すため。ここで言う block は b で区切った概念上の分割で、次ページで扱う「拡大後に実際に割り当てられるセル」とは別物である点を口頭で必ず区別する。想定QA「にじむのは悪い？」→ 隠蔽の観点ではむしろ安全側だが、「セル＝ブロック平均」と説明すると嘘になるので明示する -->

> > > **support（台）**＝カーネルが非ゼロになる範囲の半幅。縮小時は `ratio` 倍に引き伸ばすのが定石（伸ばさないと入力画素を飛ばし読みして折り返しノイズが出る）

---

## $b$ が消える理由 — 出力が減るから（相殺）

$$ \frac{n}{b^2}\ (\text{出力数}) \;\times\; (2b)^2\ (\text{タップ数}) \;=\; 4n $$

- 1 出力あたりの仕事は **b に比例**、だが出力は **1/b²** に減る → **b が相殺して $O(n)$**
- 分離実装の合計は $3n + 3n/b$ ＝ **約 3.1 サンプル/画素**（b=21）
  ボックスの running-sum 約 4 更新/画素と**同じ帯**
- **素朴に書いても最初から $O(n)$**（セル平均 n ＋敷き詰め n）→ **計算量の山が無い**

<!-- note: 導出は resize が vertical_sample → horizontal_sample の 2 パスであることから: 縮小は w·(h/b)·2b + (w/b)(h/b)·2b、拡大 Nearest は 1 タップで (w/b)·h + w·h。合計 ≈ 3n + 3n/b で、b=21 なら約 3.1、b=2 なら約 4.5。すべて image 0.25.10 のソースからの導出で未実測（criterion 未整備＝ボックス節と同じ立場）。素朴なモザイク（セル平均して敷き詰める）は約 2 サンプル/画素で、実は採用実装の方が遅い。それでも合成を選んだのは 1章の評価軸「速度は決め手にしない」の具体例。速度が問題化したときの差し替え先は libblur ではなく fast_image_resize（1章の伏線回収） -->

---

## 同じ $O(n)$ でも中身は逆 — 状態の再利用 vs 出力の縮小

| | ボックス | モザイク |
|---|---|---|
| 素朴に書くと | $O(n \cdot r^2)$ | **$O(n)$**（山が無い） |
| 実装 | 分離＋running-sum | `resize` 2 回 |
| 1 画素あたり | 約 4 更新（整数の加減算） | 約 3.1〜4.5（f32 の乗加算） |
| 中間バッファ | u8 1 枚 ＝ **48MB 固定** | f32 ＝ **96MB（b=2）〜9.2MB（b=21）** |

- **消し方が逆**: ボックスは*状態の再利用*で r を消す／モザイクは*出力の縮小*で b が消える
- **メモリも逆**: モザイクは**弱いほど重い** — 縮小率が小さいほど中間バッファが大きくなる

<!-- note: 中間は Rgba32FImage（16B/px）を vertical_sample が ImageBuffer::new(width, new_height) で確保するので、4000×3000・b=2 なら 4000×1500×16B ≈ 96MB、b=21 なら約 9.2MB。ボックスの tmp は u8 で w·h·4B = 48MB 固定（out も含めれば実質 2 枚）。数値はすべてソースからの導出で未実測。想定QA「弱いモザイクで 96MB は困らない？」→ 一時的な確保で即解放され、プレビューは長辺 1600 に縮小済みなので実際に効くのは書き出し時のみ。想定QA「なぜボックスだけ整数演算？」→ 移動和を整数で持てるのが running-sum の利点で、resize は f32 中間が前提（「running-sum の細部」ページの「誤差の蓄積が構造的にゼロ」と対になる） -->

---

## 端は「勝手に」揃う — div_ceil と Nearest の均等配分

- 端専用の分岐は **1 つも無い** — `div_ceil` でセル数を決め、`Nearest` が幅を割り振るだけ
- 7px を 3 セルに割ると **3/3/1 ではなく 2/3/2** — 中心座標で選ぶ結果、**均等に再配分**される
- 端が暗くならないのも**タダ**（`resize` が重みを正規化）— ボックスが `clamp` で**選んで**解いた
  問題を、モザイクは**ライブラリの仕様として**受け取っている

```
   出力 x : 0     1     2     3     4     5     6     w = 7 → セル 3（ratio = 3/7）
   中心 c : 0.21  0.64  1.07  1.50  1.93  2.36  2.79
   floor  :  0     0     1     1     1     2     2
   セル幅 : └── 2 ──┘└──── 3 ────┘└── 2 ──┘   ← 3/3/1 にはならない
```

<!-- note: 出典 blur.rs の mosaic_rgba の w.div_ceil(block) と doc コメント「セル境界は Nearest により均等配分され、寸法が block の整数倍なら block 格子と一致」, image の horizontal_sample（inputx = (outx+0.5)*ratio, left..right を画像範囲へ clamp, *w /= sum）。表の数値は ratio=3/7 の手計算・未実測。担保はテスト mosaic_uniform_image_is_unchanged（一様画像は端まで不変＝重みが正規化されている性質テスト）と mosaic_bounds_distinct_colors_on_non_multiples（色数 <= セル数 6 の上界。境界の丸め実装に依存しない形で書かれている）。「なぜ clamp か」ページのボックス側の代替案比較（ゼロ埋め／除数縮小／ミラー／エッジ複製）に対応する話だが、こちらは選択肢を持たない代わりに実装の仕様に縛られる。image が将来サンプル位置を変えたらセル境界も静かに変わる — そのとき気づけるのが次ページのテスト -->

---

## golden を選ばなかった理由 — 実装に固定されるテストは書かない

- golden 画像（期待画像との完全一致）は**書ける**。だが**書かなかった**
- 理由: セル値は厳密平均でなく（前々ページ）、境界もライブラリの丸め依存（前ページ）
- → golden は **`image` の実装に過剰固定**され、**依存を上げただけで落ちる**
- 代わりに**入力によらず成り立つ関係**＝性質だけを並べ、「壊れ方」を捕まえる網にする

<!-- note: 出典 blur.rs の #[cfg(test)] mod tests。golden（期待画像との完全一致）を書けば「セル値が厳密平均でない」ことも「境界の割り当てが 2/3/2 になる」ことも同時に固定できるが、それは image の resize 実装そのものを仕様として固定することになる。区分一定・色数上界・一様不変は resize の仕様として成り立ち続けるはずのもので、これらが壊れたときだけ落ちてほしい。逆に golden だと「仕様は保たれているのに依存更新で落ちる」偽陽性になる。想定QA「回帰は検出できる？」→ ピクセル化の消失・寸法崩れ・端の暗化はすべて次ページの性質で捕まる -->

> > > **性質テスト**＝個別の入出力ではなく「入力によらず成り立つ関係」を検証するテスト。期待画像を用意できない／したくないときの定石

---

## 6 本の性質テスト — 何を固定しているか

| テスト | 何を固定するか |
|---|---|
| `radius_zero_is_identity` | radius 0 は恒等（3 種別共通） |
| `mosaic_preserves_dimensions_on_non_multiples` | 寸法不変（7×5, b=3） |
| `mosaic_is_piecewise_constant_on_exact_grid` | 整数倍寸法ならセル内一定（8×6, b=2） |
| `mosaic_bounds_distinct_colors_on_non_multiples` | **色数 ≤ セル数**（境界の丸め実装に依存しない上界） |
| `mosaic_uniform_image_is_unchanged` | 一様画像は不変（重みの正規化） |
| `mosaic_preview_never_collapses_to_identity` | 縮小率 0.1 でも素通しにならない |

- `ALL_KINDS` に足しただけで**透明系 3 本も自動的にモザイクを覆う** — 種別追加のコストが下がる

<!-- note: 出典 blur.rs の #[cfg(test)] mod tests の上記 6 本と、ALL_KINDS へ Mosaic を足したことで自動的に覆われる transparent_pixels_do_not_bleed_color / semi_transparent_uniform_image_is_unchanged / fully_transparent_pixels_come_out_zeroed。色数上界テストのテスト内コメント「境界の丸め実装に依存しない検証」が設計意図そのもの。gradient(w,h) は全画素が異なる勾配画像でピクセル化の検出用。ボックスが box_blur_of_uniform_image_is_unchanged 1 本でほぼ足りたのに対し、モザイクは中核実装より明らかにテストが厚い（行数の比は数え方に依存するので断定しない）。ALL_KINDS はモザイク追加時に導入した定数で、それまで [Gaussian, Block] が 3 箇所に直書きされていた＝種別リストの重複が 3 個目を足して初めて露見した -->

---

## 変換の +1 はスケールしない — 可換でないのはモザイクだけ

$$ b(\mathrm{round}(r s)) = \mathrm{round}(r s) + 1 \;\neq\; s\,(r+1) = s\,b(r) $$

- `apply_stack_scaled` は**先に半径を丸めてから**変換に渡す
  → **丸め由来のズレは 3 種別に共通**（ここは差にならない）
- ガウスの $\sigma = r/2$ は**線形** → 丸めを除けばスケールと**可換**
- モザイクの $b = r+1$ は **+1 のオフセット**を持つ → 丸めを除いても**可換でない**

<!-- note: 出典 blur.rs の apply_stack_scaled / scaled_radius（round＋下限 1）/ radius_to_block。3章「半径のスケール補正」ページのノートにある「ガウスは sigma'=sigma*scale が厳密に成り立つ」の裏返しだが、実装は radius を丸めてから変換に渡すので、厳密に言えるのは「変換が線形なので丸めを除けば可換」まで。厳密にするなら「radius をスケール→変換」ではなく「変換→block をスケール」＝ block' = max(1, round(b·s)) = round(21×0.4) = 8 とすべきで、これは apply_stack_scaled が種別に依らず radius だけをスケールする設計と衝突する＝未実装の改善案。ボックスの d = 2r+1 も +1 を持つが、窓幅は「効き幅」であって格子ではないので、ズレは滲みの差に埋もれて見えない -->

---

## ズレの実際 — 書き出し 191 セル / プレビュー 178 セル

```
 書き出し   4000px / b = 20+1 = 21            → ceil(4000/21) = 191 セル
 プレビュー 1600px / b = round(20×0.4)+1 = 9  → ceil(1600/9)  = 178 セル

 プレビューのセルが約 7% 大きく、格子の位相もずれる
```

- ぼかしのズレは**滲みの差**、モザイクのズレは**数えられる格子の差** → 目につきやすい
- それでも破綻しないのは下限の合成: `scaled_radius ≥ 1` × `b = r+1 ≥ 2` ＝ **素通しは起きない**
- 担保は `mosaic_preview_never_collapses_to_identity` — **存在の保証であって一致の保証ではない**

<!-- note: 数値は 4000×3000・radius=20・scale=0.4 の手計算で未実測。プレビュー経路ではリサンプルが 3 回積み重なる（downscale_for_preview の Triangle → モザイクの Triangle 縮小 → Nearest 拡大）。最初のページの「平行移動不変でない」がここに効く: 格子に位相があるので、拡大縮小で位相が合わなくなる。想定QA「実用上困る？」→ 隠す目的なので「どの程度隠れるか」は伝わる。厳密な格子合わせが要るのは印刷入稿などの用途で、そのときは「変換→block をスケール」へ直す。本編はここまでで、次はまとめ -->

---

# まとめ

- **1. 技術選定**: Tauri v2、ピクセル処理は **Rust に一本化** — ライブラリに無いボックスブラーだけ自前
- **2. アーキテクチャ**: Rust=ピクセル/FS、Web=UI/状態 — **境界は IPC 1 本**
- **3. WYSIWYG プレビュー**: プレビューと書き出しは**同一 `blur_rgba`** — ズレは半径のスケール補正に閉じる
- **4. 画像処理アルゴリズム**: 分離＋running-sum で $O(n \cdot r^2) \to O(n \cdot r) \to O(n)$
  — **窓の「形」に注目すれば半径が消える**／モザイクは `resize` 2 回の**合成で済む**

<!-- note: 各章末にあった持ち帰り行はこの1枚に集約した（番号は章番号と対応）。質問の入り口になりやすいのは 4 の O(n) 化と 3 の WYSIWYG -->
