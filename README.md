# aigo-module

Xghub 站源模块：aigo.me 爱果短剧（黄果短剧 / 爱果原创 / 魔改短剧）。

## 安装

Xghub › 设置 › 站源 › 模块管理，手动安装 `aigo-1.1.0.zip`。

## 客户端内置

Xghub 构建时以 `BUNDLED_MODULES` 指向本仓库目录，模块随客户端发布内置。

## 接口

数据 `https://aigo.me/api/ui/*`；播放 `POST /api/ui/episodes/<episodeId>/playback` 匿名会话，返回带时效签名的 m3u8。锁定分集（401/402/403）模块内做多形态重试。

## 测试

```
node test-module.cjs
```
