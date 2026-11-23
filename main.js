// aigo.me 爱果短剧站源模块（小果/玄果 CommonJS 模块格式，api=1）
// 数据源：aigo.me 官方 UI API（匿名可读目录与搜索，非 VIP 分集可匿名取播放地址）。
var BASE = "https://aigo.me";
var API = BASE + "/api/ui/catalog";
var categoriesCache = null;

function requestJson(url, options) {
  var res = host.fetch(Object.assign({ method: "GET", url: url, headers: { accept: "application/json" } }, options || {}));
  if (res.status !== 200) throw new Error("aigo 请求失败 HTTP " + res.status);
  return JSON.parse(res.body);
}

function toDrama(d) {
  return {
    id: host.dramaId(d.id),
    source: host.source,
    sourceId: d.id,
    title: d.title,
    name: d.title,
    desc: d.description || "",
    cover: d.coverUrl || "",
    totalEpisode: d.episodeCount || 0,
    categoryName: d.category || ""
  };
}

function categories(force) {
  if (!force && categoriesCache) return categoriesCache;
  var data = requestJson(API + "/categories").data || [];
  categoriesCache = data.map(function (c) { return { id: c.id, name: c.name }; });
  return categoriesCache;
}

function dramas(page, category, query) {
  var url = API + "/dramas?page=" + page;
  if (category) url += "&categoryId=" + encodeURIComponent(category);
  if (query) url += "&search=" + encodeURIComponent(query);
  var data = requestJson(url).data || [];
  var items = data.map(toDrama);
  return { items: items, hasMore: data.length >= 20 };
}

function catalogPage(page, category) {
  return dramas(page, category);
}

function search(page, query) {
  return dramas(page, null, query);
}

function detail(sourceId) {
  var dramaData = requestJson(API + "/dramas/" + encodeURIComponent(sourceId)).data || {};
  var episodes = requestJson(API + "/dramas/" + encodeURIComponent(sourceId) + "/episodes").data || [];
  var drama = toDrama(dramaData);
  var chapters = episodes.map(function (e, i) {
    return {
      id: host.chapterId(sourceId, e.id),
      source: host.source,
      title: e.title || String(e.number || i + 1),
      currentEpisode: e.number || i + 1,
      vip: !!e.vip
    };
  });
  return { drama: drama, chapters: chapters };
}

// task.chapter.id = "aigo:{dramaId}:{episodeId}"（host.chapterId 生成）
function resolveMedia(task) {
  var parts = String(task.chapter.id).split(":");
  var episodeId = parts.length >= 3 ? parts[2] : "";
  if (!episodeId) throw new Error("无法识别分集");
  var res = host.fetch({
    method: "POST",
    url: BASE + "/api/ui/episodes/" + encodeURIComponent(episodeId) + "/playback",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: "{}"
  });
  if (res.status !== 200) throw new Error("获取播放地址失败 HTTP " + res.status + (res.body ? "：" + String(res.body).slice(0, 120) : ""));
  var data = JSON.parse(res.body);
  if (!data.playUrl) throw new Error("该分集需要登录或解锁后观看");
  return { url: data.playUrl };
}

module.exports = { categories: categories, catalogPage: catalogPage, search: search, detail: detail, resolveMedia: resolveMedia };
