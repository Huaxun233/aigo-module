// 用 node 模拟 host 全链路实测模块 v1.1.0
const fs = require("fs");
const path = require("path");
const DIR = "D:\\deepseek work\\aigo-module";
const cache = new Map();
async function prefetch(url) {
  const r = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  cache.set(url, { status: r.status, body: await r.text() });
}
const hostObj = {
  source: "aigo",
  dramaId: (id) => "aigo:" + id,
  chapterId: (d, e) => `aigo:${d}:${e}`,
  fetch: (req) => {
    const hit = cache.get(req.url);
    if (!hit) throw new Error("prefetch 缓存未命中: " + req.url + " method=" + req.method);
    return hit;
  },
};
const vm = require("vm");
const sandbox = { host: hostObj, module: { exports: {} }, console, JSON, Error, Number, String, encodeURIComponent };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(DIR, "main.js"), "utf8"), sandbox);
const main = sandbox.module.exports;

const host = hostObj;

(async () => {
  // prefetch 分类+列表
  await prefetch("https://aigo.me/api/ui/catalog/categories");
  const cats = main.categories();
  console.log("categories:", cats.length, cats[0].name);
  await prefetch("https://aigo.me/api/ui/catalog/dramas?categoryId=" + encodeURIComponent(cats[0].id) + "&page=1");
  const page = main.catalogPage(1, cats[0].id);
  console.log("catalog items:", page.items.length, "hasMore:", page.hasMore);
  await prefetch("https://aigo.me/api/ui/catalog/dramas?search=%E9%80%86%E8%A2%AD&page=1");
  const sr = main.search(1, "逆袭");
  console.log("search:", sr.items.length);
  const drama = page.items[0];
  await prefetch(`https://aigo.me/api/ui/catalog/dramas/${drama.sourceId}`);
  await prefetch(`https://aigo.me/api/ui/catalog/dramas/${drama.sourceId}/episodes`);
  const det = main.detail(drama.sourceId);
  console.log("detail:", det.drama.title, "集数:", det.chapters.length, "vip标记:", det.chapters.filter(c => c.vip).length);
  // resolveMedia：POST 不在 prefetch 里，单独模拟
  const ep = det.chapters[0];
  const episodeId = ep.id.split(":").pop();
  const pr = await fetch(`https://aigo.me/api/ui/episodes/${episodeId}/playback`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: "" });
  cache.set(`https://aigo.me/api/ui/episodes/${episodeId}/playback`, { status: pr.status, body: await pr.text() });
  const media = main.resolveMedia({ chapter: { id: ep.id } });
  console.log("resolveMedia OK:", media.url.slice(0, 80), "variants:", (media.variants || []).length);
  console.log("全链路 PASS");
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
