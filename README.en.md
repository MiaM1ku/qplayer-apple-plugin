# QPlayer Apple Music source plugin

<p><a href="README.md">简体中文</a> · <b>English</b></p>

Independent QPlayer source plugin (ABI 1.0). Catalog calls follow
[go-music-dl](https://github.com/guohuiyuan/go-music-dl) / `music-lib`.
Not affiliated with Apple.

`resolveStream` returns **preview clips only**. Full tracks are FairPlay-DRM
protected and cannot be decrypted inside the plugin sandbox.

## Build

```bash
QPLAYER_PLUGIN_SIGNING_KEY=/path/to/publisher-private.pem ./scripts/package.sh
python3 scripts/verify-package.py dist/*.qplug
```
