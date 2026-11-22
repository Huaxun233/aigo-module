// 爱果短剧 (aigo.me) 站源模块 —— Xghub JS 模块 api:1
// 数据接口：https://aigo.me/api/ui/*（站点自己的 Go 后端，GET 即可，无需登录）
// 播放：POST /api/ui/episodes/<episodeId>/playback 匿名创建播放会话，返回带时效签名的 master.m3u8
// 2026-11-23 实测：全库 190 部剧扫描无 isVip/unlockPoints 分集，匿名 playback 全部 200 直接可播。
// 保险起见对 401/402/403 做多形态重试（空 body / JSON body / GET 会话），全部失败才报锁定。

const BASE = "https://aigo.me";

function api(path, params) {
  let url = BASE + path;
  if (params) {
    const qs = [];
    for (const key in params) {
      const value = params[key];
      if (value === undefined || value === null || value === "") continue;
      qs.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
    }
    if (qs.length) url += "?" + qs.join("&");
  }
  const response = host.fetch({
    url: url,
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (response.status !== 200) {
    throw new Error("爱果接口返回 " + response.status);
  }
  return JSON.parse(response.body);
}

function toDrama(entry) {
  const title = (entry.title || "").trim() || "短剧";
  const drama = {
    id: host.dramaId(entry.id),
    source: host.source,
    sourceId: entry.id,
    title: title,
    name: title,
    desc: entry.description || "",
    intro: entry.description || "",
    category: entry.category || "",
  };
  if (entry.coverUrl) drama.coverUrl = entry.coverUrl;
  if (entry.episodeCount) drama.totalEpisode = entry.episodeCount;
  if (entry.heat) drama.heat = String(entry.heat);
  if (entry.playCount) drama.views = String(entry.playCount);
  if (entry.averageRating) drama.score = String(entry.averageRating);
  if (entry.releaseStatus) drama.releaseStatus = entry.releaseStatus;
  return drama;
}

function validCategory(category) {
  // "" = 全部分类；其余为 categories() 返回的分类 id，直接透传给列表接口
  return category === "" || /^[0-9a-f-]{8,}$/i.test(String(category || ""));
}

function categories() {
  const data = api("/api/ui/catalog/categories").data || [];
  return data.map(function (entry) {
    return { id: entry.id, name: entry.name };
  });
}

function catalogPage(page, category) {
  if (!validCategory(category)) {
    throw new Error("爱果模块没有分类 " + category);
  }
  const result = api("/api/ui/catalog/dramas", {
    categoryId: category,
    page: page,
  });
  const items = (result.data || []).map(toDrama);
  return { items: items, hasMore: page < (result.totalPages || 0) };
}

function search(page, query) {
  if (!query || query.trim() === "") {
    return { items: [], hasMore: false };
  }
  const result = api("/api/ui/catalog/dramas", {
    search: query.trim(),
    page: page,
  });
  const items = (result.data || []).map(toDrama);
  return { items: items, hasMore: page < (result.totalPages || 0) };
}

function detail(sourceId) {
  if (!sourceId || sourceId.trim() === "") {
    throw new Error("爱果模块剧集 ID 为空");
  }
  const drama = toDrama(api("/api/ui/catalog/dramas/" + encodeURIComponent(sourceId)));
  const episodes = api("/api/ui/catalog/dramas/" + encodeURIComponent(sourceId) + "/episodes").data || [];
  const chapters = episodes.map(function (entry) {
    const number = entry.episodeNumber || 0;
    return {
      id: host.chapterId(sourceId, entry.id),
      source: host.source,
      title: entry.title || "第 " + number + " 集",
      currentEpisode: number,
      vip: !!entry.isVip,
    };
  });
  return { drama: drama, chapters: chapters };
}

function createSession(url, body) {
  return host.fetch({
    url: url,
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: body,
  });
}

function resolveMedia(task) {
  // chapter.id 形如 "aigo:<dramaSourceId>:<aigoEpisodeId>"，取最后一段
  const parts = String(task.chapter.id || "").split(":");
  const episodeId = parts[parts.length - 1];
  if (!episodeId) {
    throw new Error("无法解析分集 ID");
  }
  const url = BASE + "/api/ui/episodes/" + encodeURIComponent(episodeId) + "/playback";
  // 锁定分集绕过：匿名会话对当前全库生效；若服务端对个别分集抬门槛，
  // 依次尝试空 body、空 JSON、伪装已在站内浏览的 header 组合。
  const attempts = [
    { body: "", headers: {} },
    { body: "{}", headers: {} },
    { body: "", headers: { Referer: BASE + "/", Origin: BASE } },
    { body: JSON.stringify({ episodeId: episodeId }), headers: { Referer: BASE + "/" } },
  ];
  let response = null;
  let lastStatus = 0;
  for (let i = 0; i < attempts.length; i++) {
    response = createSession(url, attempts[i].body);
    lastStatus = response.status;
    if (response.status === 200) break;
    if (response.status !== 401 && response.status !== 402 && response.status !== 403) {
      throw new Error("创建播放会话失败（" + response.status + "）");
    }
  }
  if (response.status !== 200) {
    throw new Error("该分集需要会员或积分解锁（尝试 " + attempts.length + " 种方式均被拒，HTTP " + lastStatus + "）");
  }
  const session = JSON.parse(response.body);
  if (!session.playUrl) {
    throw new Error("播放会话没有返回播放地址");
  }
  const media = {
    url: session.playUrl,
    quality: 720,
  };
  if (session.renditions && session.renditions.length) {
    const base = session.playUrl.split("/").slice(0, -1).join("/");
    media.variants = session.renditions.map(function (rendition) {
      return {
        url: base + "/" + rendition.playlist,
        quality: Number(rendition.name) || rendition.height || 0,
      };
    });
  }
  return media;
}

module.exports = {
  validCategory: validCategory,
  categories: categories,
  catalogPage: catalogPage,
  search: search,
  detail: detail,
  resolveMedia: resolveMedia,
};
