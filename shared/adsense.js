// Google AdSense ローダー（全ページ共通）
// 審査に通ったら PUB_ID を ca-pub-XXXXXXXXXXXXXXXX に設定すると、全ページで広告が有効になる。
// 発行者IDは公開情報のため、ここに直接記載して問題ない。
(() => {
  const PUB_ID = "ca-pub-1152026485973831";
  if (!PUB_ID) return;
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + PUB_ID;
  s.crossOrigin = "anonymous";
  document.head.appendChild(s);
})();
