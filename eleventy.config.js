module.exports = function (eleventyConfig) {
  // 共有スタイルシートを配信物へコピー（src/css -> _site/css）
  eleventyConfig.addPassthroughCopy("src/css");

  // 既存 Marp 成果物を配信物へコピー（src外なのでオブジェクト形式で明示）。
  // slide.pdf(大容量, 未追跡) と .claude/ は意図的にコピー対象外
  eleventyConfig.addPassthroughCopy({
    "youtube-chat-rearranger/slide.html": "youtube-chat-rearranger/slide.html",
    "youtube-chat-rearranger/img": "youtube-chat-rearranger/img",
  });

  return {
    // GitHub Pages プロジェクトサイト( /tech-talks/ )配下で配信されるため。
    // repo名変更・fork時の破損を避けるため環境変数で上書き可能にする
    pathPrefix: process.env.ELEVENTY_PATH_PREFIX || "/tech-talks/",
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
  };
};
