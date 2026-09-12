# QPlayer Apple Music 音源插件

<p><b>简体中文</b> · <a href="README.en.md">English</a></p>

QPlayer 的独立音源插件，实现公开的 JavaScript 插件 ABI（apiVersion 1.0）。
解析逻辑参考 [go-music-dl](https://github.com/guohuiyuan/go-music-dl) / `music-lib` 的 apple 实现。

本项目与 Apple 没有隶属或合作关系，不分发音频或账号凭据。使用者需自行遵守服务条款与当地法律。

## 功能

| 能力 | 说明 |
|---|---|
| `searchSongs` / `searchAlbums` / `searchArtists` | AMP catalog 搜索 |
| `songDetails` | 按歌曲 id 取详情 |
| `playlistDetails` / `albumDetails` / `artistDetails` | 歌单、专辑、歌手 |
| `home` | 中国区「热门」策展歌单 |
| `resolveStream` | **仅 30 秒预览**（完整音轨为 FairPlay DRM，插件无法解密） |
| `lyrics` | 登录后尽量返回 TTML |
| `login` / `account` | 网页登录或粘贴 `media-user-token` |

未登录也可搜索与播放预览。默认 storefront 为 `cn`，Cookie 中可写 `storefront=us`。

## 构建

```bash
QPLAYER_PLUGIN_SIGNING_KEY=/path/to/publisher-private.pem ./scripts/package.sh
python3 scripts/verify-package.py dist/*.qplug
```

完整 ABI 见 [插件模板](https://github.com/TIMER-err/qplayer-plugin-template/blob/main/docs/ABI.md)。
