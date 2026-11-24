// 爱果短剧 (aigo.me) 站源模块 —— Xghub JS 模块 api:1
// 数据接口：https://aigo.me/api/ui/*（站点自己的 Go 后端，GET 即可，无需登录）
// 播放：POST /api/ui/episodes/<episodeId>/playback 返回带时效签名的 master.m3u8
// 服务端把匿名播放身份绑死在第一集（ep2 起 401 PLAYBACK_IDENTITY_REQUIRED），
// 登录账号后全剧集可播。模块支持用户自己注册/登录（账号命令 account），
// 用户凭据优先；无用户账号时用内置备用账号自动登录。juku_session 缓存复用，
// 401 时清缓存重登一次。

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

// ---------- 账号会话 ----------
// 内置备用账号：用户没有自己的账号时兜底
const ACCOUNTS = [
  { email: "aigoc543573c09@euploading.com", password: "Aigo9a4ea37a!8" },
  { email: "aigo01a1e10eb2@euploading.com", password: "Aigo2608f1ef!8" },
  { email: "aigo7bcc197c31@euploading.com", password: "Aigo20b2442b!8" },
];

// Go 宿主 Header map key 规范化为 "Set-Cookie"，node 测试台是小写；大小写不敏感取
function headerValues(headers, name) {
  const out = [];
  const lower = String(name).toLowerCase();
  for (const key in headers) {
    if (String(key).toLowerCase() === lower) {
      const arr = headers[key];
      if (arr && arr.length) for (let i = 0; i < arr.length; i++) out.push(String(arr[i]));
    }
  }
  return out;
}

function createSession(url, body, headers) {
  return host.fetch({
    url: url,
    method: "POST",
    headers: Object.assign({ Accept: "application/json", "Content-Type": "application/json" }, headers || {}),
    body: body,
  });
}

// viewer 引导链：GET viewer 收 cookie → GET viewer?confirm=1 带 cookie 拿 viewer id
function viewerChain() {
  let jar = [];
  let res = host.fetch({ url: BASE + "/api/ui/viewer", method: "GET", headers: { Accept: "application/json", Referer: BASE + "/" } });
  if (res.status !== 200) throw new Error("viewer 引导失败（" + res.status + "）");
  jar = jar.concat(headerValues(res.headers, "set-cookie").map(function (line) { return line.split(";")[0]; }).filter(function (part) { return part.indexOf("=") >= 0; }));
  res = host.fetch({ url: BASE + "/api/ui/viewer?confirm=1", method: "GET", headers: { Accept: "application/json", Referer: BASE + "/", Cookie: jar.join("; ") } });
  jar = jar.concat(headerValues(res.headers, "set-cookie").map(function (line) { return line.split(";")[0]; }).filter(function (part) { return part.indexOf("=") >= 0; }));
  let viewerId = "";
  if (res.status === 200) {
    try { viewerId = JSON.parse(res.body).id || ""; } catch (e) { viewerId = ""; }
  }
  return { jar: jar, viewerId: viewerId };
}

function authPost(path, payload, chain) {
  const headers = { Referer: BASE + "/", Origin: BASE, Cookie: chain.jar.join("; ") };
  if (chain.viewerId) headers["X-Juku-Viewer"] = chain.viewerId;
  return createSession(BASE + path, JSON.stringify(payload), headers);
}

function cookiesOf(res) {
  return headerValues(res.headers, "set-cookie")
    .map(function (line) { return line.split(";")[0]; })
    .filter(function (part) { return part.indexOf("=") >= 0; });
}

function loginAccount(account) {
  const chain = viewerChain();
  const res = authPost("/api/ui/account/login", { email: account.email, password: account.password }, chain);
  if (res.status !== 200) {
    throw new Error("登录失败（" + res.status + " " + String(res.body || "").slice(0, 80) + "）");
  }
  const sessionCookies = cookiesOf(res);
  if (!sessionCookies.length) {
    throw new Error("登录未返回会话 cookie");
  }
  return sessionCookies.join("; ");
}

function sendCode(email) {
  const chain = viewerChain();
  const res = authPost("/api/ui/account/register/code", { email: email }, chain);
  if (res.status !== 200) {
    throw new Error("验证码发送失败（" + res.status + " " + String(res.body || "").slice(0, 80) + "）");
  }
  try { return JSON.parse(res.body); } catch (e) { return {}; }
}

function registerAccount(email, password, code) {
  const chain = viewerChain();
  const res = authPost("/api/ui/account/register", { email: email, password: password, emailCode: code }, chain);
  if (res.status !== 200 && res.status !== 201) {
    throw new Error("注册失败（" + res.status + " " + String(res.body || "").slice(0, 80) + "）");
  }
  let sessionCookies = cookiesOf(res);
  if (!sessionCookies.length) {
    // 注册接口没带会话就走登录
    const retry = authPost("/api/ui/account/login", { email: email, password: password }, chain);
    if (retry.status !== 200) {
      throw new Error("注册成功但登录失败（" + retry.status + "）");
    }
    sessionCookies = cookiesOf(retry);
  }
  if (!sessionCookies.length) {
    throw new Error("注册未返回会话 cookie");
  }
  return sessionCookies.join("; ");
}

function saveUser(account) {
  host.cacheSet("aigo:user", JSON.stringify({ email: account.email, password: account.password }), 2592000);
}

function storedUser() {
  const raw = host.cacheGet("aigo:user");
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const user = JSON.parse(raw);
    if (user && user.email && user.password) return user;
  } catch (e) {}
  return null;
}

// 账号命令（host 端 sourceAccount action）：
// "" → 状态；"sendCode" {email}；"register" {email,password,code}；"login" {email,password}；"logout"
function account(command, input) {
  if (command === "" || command === undefined || command === null) {
    const user = storedUser();
    const session = host.cacheGet("aigo:session");
    return {
      loggedIn: user != null && typeof session === "string" && session.indexOf("juku_session=") >= 0,
      email: user ? user.email : "",
    };
  }
  input = input || {};
  if (command === "sendCode") {
    const email = String(input.email || "").trim();
    if (!email) throw new Error("请先填写邮箱");
    sendCode(email);
    return { ok: true };
  }
  if (command === "register") {
    const email = String(input.email || "").trim();
    const password = String(input.password || "");
    const code = String(input.code || "").trim();
    if (!email || !password || !code) throw new Error("邮箱、验证码和密码都要填");
    const cookie = registerAccount(email, password, code);
    saveUser({ email: email, password: password });
    host.cacheSet("aigo:session", cookie, 7200);
    return { loggedIn: true, email: email };
  }
  if (command === "login") {
    const email = String(input.email || "").trim();
    const password = String(input.password || "");
    if (!email || !password) throw new Error("请填写邮箱和密码");
    const cookie = loginAccount({ email: email, password: password });
    saveUser({ email: email, password: password });
    host.cacheSet("aigo:session", cookie, 7200);
    return { loggedIn: true, email: email };
  }
  if (command === "logout") {
    host.cacheSet("aigo:user", "", 1);
    host.cacheSet("aigo:session", "", 1);
    return { loggedIn: false };
  }
  throw new Error("爱果模块不支持账号命令 " + command);
}

function ensureSession() {
  const cached = host.cacheGet("aigo:session");
  if (typeof cached === "string" && cached.indexOf("juku_session=") >= 0) return cached;
  const failures = [];
  // 用户自己的账号优先
  const user = storedUser();
  if (user) {
    try {
      const cookie = loginAccount(user);
      host.cacheSet("aigo:session", cookie, 7200);
      return cookie;
    } catch (e) {
      failures.push("用户账号 " + String((e && e.message) || e));
      host.cacheSet("aigo:user", "", 1);
    }
  }
  for (let i = 0; i < ACCOUNTS.length; i++) {
    try {
      const cookie = loginAccount(ACCOUNTS[i]);
      host.cacheSet("aigo:session", cookie, 7200);
      return cookie;
    } catch (e) {
      failures.push(String((e && e.message) || e));
    }
  }
  throw new Error("爱果账号全部登录失败：" + failures.join("；"));
}

function playbackRequest(episodeId) {
  // 注意：Idempotency-Key 服务端要求 UUID 格式，乱编会 400；干脆不带
  return createSession(BASE + "/api/ui/episodes/" + encodeURIComponent(episodeId) + "/playback", "{}", {
    Cookie: ensureSession(),
    Referer: BASE + "/",
    Origin: BASE,
  });
}

function resolveMedia(task) {
  // chapter.id 形如 "aigo:<dramaSourceId>:<aigoEpisodeId>"，取最后一段
  const parts = String(task.chapter.id || "").split(":");
  const episodeId = parts[parts.length - 1];
  if (!episodeId) {
    throw new Error("无法解析分集 ID");
  }
  let response = playbackRequest(episodeId);
  // 会话过期/失效：清缓存重登一次再试
  if (response.status === 401) {
    host.cacheSet("aigo:session", "", 1);
    response = playbackRequest(episodeId);
  }
  if (response.status !== 200) {
    throw new Error("创建播放会话失败（HTTP " + response.status + " " + String(response.body || "").slice(0, 80) + "）");
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
  account: account,
};
