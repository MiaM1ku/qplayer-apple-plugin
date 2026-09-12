"use strict";

// Apple Music 音源插件。接口映射参考 go-music-dl / music-lib 的 apple 实现。
// 完整音轨受 FairPlay DRM 保护，resolveStream 只返回官方预览（trial）。

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
var HOME = "https://music.apple.com";
var AMP = "https://amp-api.music.apple.com";
var DEFAULT_STOREFRONT = "cn";
var HOT_CURATOR = "1526756058";
var TOKEN_KEY = "developerToken";
var SESSION_KEY = "session";

function call(method, args) { return qplayer.call(method, args || {}); }

function str(value) {
  if (value == null) return "";
  if (typeof value === "number") return String(Math.floor(value));
  return String(value).trim();
}

function num(value) {
  if (typeof value === "number") return Math.floor(value);
  var n = parseInt(String(value || "").trim(), 10);
  return isNaN(n) ? 0 : n;
}

function first() {
  for (var i = 0; i < arguments.length; i++) {
    var value = str(arguments[i]);
    if (value) return value;
  }
  return "";
}

function secureUrl(value) {
  value = str(value);
  if (!value) return "";
  if (value.indexOf("//") === 0) return "https:" + value;
  if (value.indexOf("http://") === 0) return "https://" + value.slice(7);
  return value;
}

function artworkUrl(artwork, size) {
  artwork = artwork || {};
  var url = str(artwork.url);
  if (!url) return "";
  var s = String(size || 600);
  return secureUrl(url.replace(/\{w\}/g, s).replace(/\{h\}/g, s).replace(/\{f\}/g, "jpg"));
}

function artistsOf(name, id) {
  name = str(name);
  if (!name) return [];
  var parts = name.split(/[&,\/、]/);
  var ids = str(id).split(",");
  var out = [];
  parts.forEach(function (part, i) {
    part = part.trim();
    if (!part) return;
    out.push({ id: first(ids[i], part), name: part });
  });
  return out;
}

function loadSession() {
  return call("credentials.get", { key: SESSION_KEY }).then(function (stored) {
    if (!stored) return {};
    try { return JSON.parse(stored); } catch (_) { return {}; }
  }, function () { return {}; });
}

function saveSession(session) {
  return call("credentials.put", { key: SESSION_KEY, value: JSON.stringify(session || {}) });
}

function storefrontOf(session) {
  return first(session && session.storefront, DEFAULT_STOREFRONT).toLowerCase();
}

function httpRequest(url, extra) {
  extra = extra || {};
  var req = {
    url: url,
    method: extra.method || "GET",
    headers: extra.headers || { "User-Agent": UA },
    timeoutMs: extra.timeoutMs || 15000
  };
  if (extra.body) req.body = String(extra.body);
  return call("http.request", req).then(function (response) {
    if (response.status < 200 || response.status >= 300) {
      throw new Error("HTTP " + response.status);
    }
    return response;
  });
}

function httpGetText(url, headers) {
  return httpRequest(url, { headers: headers || { "User-Agent": UA } })
    .then(function (res) { return String(res.body || ""); });
}

function cachedToken() {
  if (cachedToken.value) return Promise.resolve(cachedToken.value);
  return call("storage.get", { key: TOKEN_KEY }).then(function (stored) {
    if (stored) {
      cachedToken.value = stored;
      return stored;
    }
    return "";
  }, function () { return ""; });
}
cachedToken.value = "";

function saveToken(token) {
  cachedToken.value = token;
  return call("storage.put", { key: TOKEN_KEY, value: token }).then(function () { return token; },
    function () { return token; });
}

function fetchDeveloperToken() {
  return httpGetText(HOME).then(function (html) {
    var match = html.match(/\/(assets\/index-legacy[~-][^"']+\.js)/)
      || html.match(/\/(assets\/index[-~][^"']+\.js)/)
      || html.match(/src="(\/assets\/[^"']+\.js)"/);
    if (!match) throw new Error("未找到 Apple Music 前端脚本");
    var jsUrl = match[1].indexOf("http") === 0 ? match[1] : HOME + "/" + match[1].replace(/^\//, "");
    return httpGetText(jsUrl);
  }).then(function (js) {
    var match = js.match(/=\s*["'](eyJh[A-Za-z0-9._\-]+)["']/)
      || js.match(/["'](eyJhbGciOi[^"']+)["']/);
    if (!match) throw new Error("未找到 Apple Music 开发者 Token");
    return saveToken(match[1]);
  });
}

function ensureToken() {
  return cachedToken().then(function (token) {
    return token || fetchDeveloperToken();
  });
}

function ampHeaders(session, token) {
  var headers = {
    "User-Agent": UA,
    "Authorization": "Bearer " + token,
    "Origin": HOME,
    "Referer": HOME + "/",
    "Accept": "application/json"
  };
  var userToken = first(session.mediaUserToken, session["media-user-token"]);
  if (userToken) {
    headers.Cookie = "media-user-token=" + userToken;
    headers["Music-User-Token"] = userToken;
  }
  return headers;
}

function ampGet(path, query, allowRetry) {
  return Promise.all([ensureToken(), loadSession()]).then(function (both) {
    var token = both[0];
    var session = both[1] || {};
    var url = path;
    if (path.indexOf("http") !== 0) {
      url = AMP + path;
      if (query) {
        var parts = [];
        Object.keys(query).forEach(function (key) {
          if (query[key] == null || query[key] === "") return;
          parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(query[key])));
        });
        if (parts.length) url += (url.indexOf("?") >= 0 ? "&" : "?") + parts.join("&");
      }
    }
    return httpRequest(url, { headers: ampHeaders(session, token) }).then(function (res) {
      return JSON.parse(res.body || "{}");
    }, function (error) {
      if (allowRetry === false) throw error;
      cachedToken.value = "";
      return call("storage.delete", { key: TOKEN_KEY }).then(function () {
        return fetchDeveloperToken();
      }, function () { return fetchDeveloperToken(); }).then(function () {
        return ampGet(path, query, false);
      });
    });
  });
}

function catalogPath(session, rest) {
  return "/v1/catalog/" + storefrontOf(session) + rest;
}

function songDto(res) {
  res = res || {};
  var attr = res.attributes || {};
  var id = str(res.id);
  var title = str(attr.name);
  if (!id || !title) return null;
  var preview = "";
  if (attr.previews && attr.previews[0] && attr.previews[0].url) preview = attr.previews[0].url;
  var artistId = "";
  var artistsRel = ((res.relationships || {}).artists || {}).data || [];
  if (artistsRel[0] && artistsRel[0].id) artistId = str(artistsRel[0].id);
  var albumId = "";
  var albumsRel = ((res.relationships || {}).albums || {}).data || [];
  if (albumsRel[0] && albumsRel[0].id) albumId = str(albumsRel[0].id);
  var cover = artworkUrl(attr.artwork, 600);
  return {
    id: id,
    title: title,
    durationMs: num(attr.durationInMillis),
    artworkUrl: cover,
    artworkThumbUrl: artworkUrl(attr.artwork, 150) || cover,
    artists: artistsOf(attr.artistName, artistId),
    album: attr.albumName ? { id: albumId || attr.albumName, name: attr.albumName } : undefined,
    isrc: str(attr.isrc),
    playable: !!(preview || attr.previews),
    trial: true,
    restricted: !preview
  };
}

function albumDto(res, songs) {
  res = res || {};
  var attr = res.attributes || {};
  var id = str(res.id);
  var name = str(attr.name);
  if (!id || !name) return null;
  var cover = artworkUrl(attr.artwork, 600);
  return {
    id: id,
    name: name,
    description: str(((attr.editorialNotes || {}).short) || ((attr.editorialNotes || {}).standard)),
    artworkUrl: cover,
    artworkThumbUrl: artworkUrl(attr.artwork, 150) || cover,
    trackCount: num(attr.trackCount) || (songs ? songs.length : 0),
    artists: artistsOf(attr.artistName),
    songs: songs || []
  };
}

function playlistDto(res, songs) {
  res = res || {};
  var attr = res.attributes || {};
  var id = str(res.id);
  var name = str(attr.name);
  if (!id || !name) return null;
  var desc = first(
    (attr.description || {}).short,
    (attr.description || {}).standard,
    (attr.editorialNotes || {}).short,
    (attr.editorialNotes || {}).standard
  );
  var cover = artworkUrl(attr.artwork, 600);
  return {
    id: id,
    name: name,
    description: desc,
    artworkUrl: cover,
    artworkThumbUrl: artworkUrl(attr.artwork, 150) || cover,
    trackCount: num(attr.trackCount) || (songs ? songs.length : 0),
    owner: { id: first(attr.curatorName), name: str(attr.curatorName) },
    songs: songs || []
  };
}

function artistDto(res, songs, albums) {
  res = res || {};
  var attr = res.attributes || {};
  var id = str(res.id);
  var name = str(attr.name);
  if (!id || !name) return null;
  var cover = artworkUrl(attr.artwork, 600);
  return {
    id: id,
    name: name,
    description: str(((attr.editorialNotes || {}).short) || ((attr.editorialNotes || {}).standard)),
    artworkUrl: cover,
    artworkThumbUrl: artworkUrl(attr.artwork, 150) || cover,
    songs: songs || [],
    albums: albums || []
  };
}

function songsOf(list) {
  var out = [];
  (list || []).forEach(function (item) {
    var song = songDto(item);
    if (song) out.push(song);
  });
  return out;
}

function pageArgs(args) {
  var limit = Math.max(1, Math.min(Number(args && args.limit || 20), 100));
  var cursor = String(args && args.cursor || "").trim();
  var offset = cursor ? Math.max(0, num(cursor)) : 0;
  return { query: String(args && args.query || "").trim(), limit: limit, offset: offset };
}

function searchCatalog(types, args) {
  var p = pageArgs(args);
  if (!p.query) return Promise.resolve({ items: [], nextCursor: "" });
  return loadSession().then(function (session) {
    return ampGet(catalogPath(session, "/search"), {
      term: p.query,
      types: types,
      limit: String(p.limit),
      offset: String(p.offset),
      l: "zh-Hans-CN"
    });
  });
}

function searchSongs(args) {
  return searchCatalog("songs", args).then(function (body) {
    var data = ((((body.results || {}).songs || {}).data) || []);
    var p = pageArgs(args);
    var items = songsOf(data);
    return { items: items, nextCursor: items.length >= p.limit ? String(p.offset + items.length) : "" };
  });
}

function searchAlbums(args) {
  return searchCatalog("albums", args).then(function (body) {
    var data = ((((body.results || {}).albums || {}).data) || []);
    var p = pageArgs(args);
    var items = [];
    data.forEach(function (item) {
      var album = albumDto(item);
      if (album) items.push(album);
    });
    return { items: items, nextCursor: items.length >= p.limit ? String(p.offset + items.length) : "" };
  });
}

function searchArtists(args) {
  return searchCatalog("artists", args).then(function (body) {
    var data = ((((body.results || {}).artists || {}).data) || []);
    var p = pageArgs(args);
    var items = [];
    data.forEach(function (item) {
      var artist = artistDto(item);
      if (artist) items.push(artist);
    });
    return { items: items, nextCursor: items.length >= p.limit ? String(p.offset + items.length) : "" };
  });
}

function songDetails(args) {
  var ids = (args && args.ids || []).map(str).filter(Boolean).slice(0, 20);
  if (!ids.length) return Promise.resolve([]);
  return loadSession().then(function (session) {
    return ampGet(catalogPath(session, "/songs"), {
      ids: ids.join(","),
      include: "artists,albums",
      extend: "extendedAssetUrls"
    });
  }).then(function (body) {
    return songsOf(body.data || []);
  });
}

function collectTracks(rel) {
  rel = rel || {};
  var songs = songsOf(rel.data || []);
  var next = str(rel.next);
  function more() {
    if (!next) return Promise.resolve(songs);
    return ampGet(next).then(function (page) {
      songs = songs.concat(songsOf(page.data || []));
      next = str(page.next);
      if (songs.length >= 3000) return songs;
      return more();
    });
  }
  return more();
}

function playlistDetails(args) {
  var id = str(args && args.id);
  if (!id) throw new Error("缺少歌单 ID");
  return loadSession().then(function (session) {
    return ampGet(catalogPath(session, "/playlists/" + encodeURIComponent(id)), {
      "limit[tracks]": "300",
      include: "tracks",
      extend: "extendedAssetUrls",
      l: "zh-Hans-CN"
    });
  }).then(function (body) {
    var item = (body.data || [])[0];
    if (!item) throw new Error("歌单不存在");
    return collectTracks((item.relationships || {}).tracks).then(function (songs) {
      var pl = playlistDto(item, songs);
      if (!pl.trackCount) pl.trackCount = songs.length;
      return pl;
    });
  });
}

function albumDetails(args) {
  var id = str(args && args.id);
  if (!id) throw new Error("缺少专辑 ID");
  return loadSession().then(function (session) {
    return ampGet(catalogPath(session, "/albums/" + encodeURIComponent(id)), {
      include: "tracks",
      extend: "extendedAssetUrls",
      l: "zh-Hans-CN"
    });
  }).then(function (body) {
    var item = (body.data || [])[0];
    if (!item) throw new Error("专辑不存在");
    var songs = songsOf((((item.relationships || {}).tracks || {}).data) || []);
    return albumDto(item, songs);
  });
}

function artistDetails(args) {
  var id = str(args && args.id);
  if (!id) throw new Error("缺少歌手 ID");
  if (!/^\d+$/.test(id)) {
    return searchSongs({ query: id, limit: 50 }).then(function (page) {
      return { id: id, name: id, songs: page.items || [] };
    });
  }
  return loadSession().then(function (session) {
    return ampGet(catalogPath(session, "/artists/" + encodeURIComponent(id)), {
      include: "songs,albums",
      views: "top-songs",
      l: "zh-Hans-CN"
    });
  }).then(function (body) {
    var item = (body.data || [])[0];
    if (!item) throw new Error("歌手不存在");
    var rel = item.relationships || {};
    var songs = songsOf(((rel.songs || {}).data) || []);
    var albums = [];
    ((rel.albums || {}).data || []).forEach(function (album) {
      var dto = albumDto(album);
      if (dto) albums.push(dto);
    });
    return artistDto(item, songs, albums);
  });
}

function home(args) {
  var limit = Math.max(1, Math.min(Number(args && args.limit || 20), 25));
  if (args && args.operation === "recommendSongs") return [];
  return ampGet("/v1/catalog/cn/apple-curators/" + HOT_CURATOR + "/playlists", {
    limit: String(limit),
    offset: "0",
    l: "zh-Hans-CN"
  }).then(function (body) {
    var playlists = [];
    (body.data || []).forEach(function (item) {
      var pl = playlistDto(item);
      if (pl) playlists.push(pl);
    });
    return { songs: [], playlists: playlists.slice(0, limit), sections: [] };
  }, function () {
    return { songs: [], playlists: [], sections: [] };
  });
}

function resolveStream(args) {
  var id = str(args && args.id);
  if (!id) throw new Error("缺少歌曲 ID");
  return songDetails({ ids: [id] }).then(function (songs) {
    var song = songs[0];
    if (!song) throw new Error("歌曲不存在");
    return loadSession().then(function (session) {
      return ampGet(catalogPath(session, "/songs/" + encodeURIComponent(id)), {
        extend: "extendedAssetUrls"
      });
    }).then(function (body) {
      var attr = ((body.data || [])[0] || {}).attributes || {};
      var url = "";
      if (attr.previews && attr.previews[0]) url = str(attr.previews[0].url);
      if (!url) throw new Error("仅提供预览流；完整音轨受 DRM 保护，无法在插件内解密");
      return {
        url: secureUrl(url),
        headers: { "User-Agent": UA, "Referer": HOME + "/" },
        mimeType: "audio/mp4",
        expiresAtMs: Date.now() + 30 * 60 * 1000,
        trial: true,
        cacheable: true
      };
    });
  });
}

function lyrics(args) {
  var id = str(args && args.id);
  if (!id) return { assets: [] };
  return loadSession().then(function (session) {
    return ampGet(catalogPath(session, "/songs/" + encodeURIComponent(id)), {
      include: "lyrics",
      extend: "extendedAssetUrls"
    });
  }).then(function (body) {
    var rel = ((((body.data || [])[0] || {}).relationships || {}).lyrics || {}).data || [];
    var assets = [];
    rel.forEach(function (item) {
      var text = str(((item.attributes || {}).ttml) || (item.attributes || {}).text);
      if (!text) return;
      assets.push({
        format: text.indexOf("<tt") >= 0 || text.indexOf("ttml") >= 0 ? "ttml" : "lrc",
        role: "original",
        text: text
      });
    });
    return { assets: assets };
  }, function () { return { assets: [] }; });
}

function account() {
  return loadSession().then(function (session) {
    var token = first(session.mediaUserToken, session["media-user-token"]);
    if (!token) return { loggedIn: false };
    return ampGet("/v1/me/storefront").then(function (body) {
      var attr = ((body.data || [])[0] || {}).attributes || {};
      var sf = first(attr.defaultLanguageTag, storefrontOf(session));
      return {
        loggedIn: true,
        id: "apple-user",
        displayName: "Apple Music (" + storefrontOf(session).toUpperCase() + ")",
        avatarUrl: "",
        membershipTier: 1,
        level: 0,
        signature: sf
      };
    }, function () {
      return {
        loggedIn: true,
        id: "apple-user",
        displayName: "Apple Music",
        avatarUrl: "",
        membershipTier: 1,
        level: 0,
        signature: ""
      };
    });
  });
}

function parseCookieString(raw) {
  var parsed = {};
  String(raw || "").split(";").forEach(function (part) {
    var at = part.indexOf("=");
    if (at <= 0) return;
    parsed[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  });
  return parsed;
}

function login(args) {
  switch (args && args.operation) {
    case "methods":
      return [{
        id: "web", type: "web", label: "网页登录",
        instructions: "在 Apple Music 网页登录后自动读取 media-user-token。完整音轨仍受 DRM 限制，登录主要用于歌词与地区目录。",
        webUrl: "https://music.apple.com/",
        cookieUrl: "https://music.apple.com",
        credentialCookieName: "media-user-token"
      }, {
        id: "cookie", type: "credential", label: "Cookie",
        instructions: "粘贴含 media-user-token 的 Cookie，可选 storefront=cn|us。未登录也可搜索并播放 30 秒预览。",
        credentialLabel: "media-user-token / Cookie"
      }];
    case "submit": {
      var raw = String(args.credential || "").trim();
      if (!raw) return { methodId: args.methodId, status: "failed", message: "凭据为空" };
      var parsed = parseCookieString(raw);
      var token = first(parsed["media-user-token"], parsed.mediaUserToken);
      if (!token && raw.indexOf("=") < 0) token = raw;
      if (!token) {
        return { methodId: args.methodId, status: "failed", message: "找不到 media-user-token" };
      }
      var session = {
        mediaUserToken: token,
        storefront: first(parsed.storefront, DEFAULT_STOREFRONT)
      };
      return saveSession(session).then(function () { return account(); }).then(function (profile) {
        return { methodId: args.methodId, status: "success", account: profile };
      });
    }
    case "logout":
      cachedToken.value = "";
      return Promise.all([
        call("credentials.delete", { key: SESSION_KEY }).then(function () {}, function () {}),
        call("storage.delete", { key: TOKEN_KEY }).then(function () {}, function () {})
      ]).then(function () { return true; });
    default:
      throw new Error("该登录方式不需要此操作");
  }
}

module.exports = {
  handlers: {
    searchSongs: searchSongs,
    searchAlbums: searchAlbums,
    searchArtists: searchArtists,
    songDetails: songDetails,
    playlistDetails: playlistDetails,
    albumDetails: albumDetails,
    artistDetails: artistDetails,
    home: home,
    resolveStream: resolveStream,
    lyrics: lyrics,
    account: account,
    login: login
  }
};
