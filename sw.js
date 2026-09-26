/* ひらめき語学 サービスワーカー
   ・ホーム画面に追加したとき、電波がなくても前回開いた画面と単語データで学習できるようにする
   ・常にネットワークを優先し、失敗したときだけキャッシュを使う（更新が反映されないのを防ぐ）
   ・音声パック（数十MB・Range取得）と広告など他ドメインはキャッシュしない */
const CACHE = "hirameki-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (req.headers.has("range") || url.pathname.endsWith(".mp3")) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: url.pathname.endsWith(".json") }).then((hit) => hit || Promise.reject(new Error("offline"))))
  );
});
