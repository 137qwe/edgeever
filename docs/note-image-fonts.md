# Optional share-image fonts

[简体中文](note-image-fonts.zh-CN.md)

The share-image typography picker includes all five fonts in Qiaomu’s designer starter pack, plus LXGW WenKai, Zhuque Fangsong and Noto Sans SC Heavy. They load remote, version-pinned resources on demand; no additional font binaries are included in Web, desktop, Android or iOS packages. The picker, loader and license notices add a small amount of application code.

| Choice | Pinned package and stylesheet |
| --- | --- |
| Smiley Sans | `@chinese-fonts/dyh@3.0.0/dist/SmileySans-Oblique/result.css` |
| LXGW WenKai | `@chinese-fonts/lxgwwenkai@3.0.0/dist/LXGWWenKai-Regular/result.css` |
| Zhuque Fangsong | `@chinese-fonts/zqfs@3.0.0/dist/ZhuqueFangsong-Regular/result.css` |
| Noto Sans SC Heavy | `@fontsource/noto-sans-sc@5.3.1/900.css` |
| PuHuiTi Regular · Recommended | `@fontpkg/alibaba-pu-hui-ti-3-0@3.1.2/AlibabaPuHuiTi-3-55-Regular.ttf` |
| PuHuiTi Heavy · Recommended | `@fontpkg/alibaba-pu-hui-ti-3-0@3.1.2/AlibabaPuHuiTi-3-105-Heavy.ttf` |
| YouShe Title · Recommended | `@fontpkg/you-she-biao-ti-hei@1.0.0/优设标题黑.ttf` |
| Alimama ShuHei · Recommended | `@fontpkg/alimama-shu-hei-ti@1.0.5/AlimamaShuHeiTi-Bold.ttf` |

Smiley Sans is also a member of the five-font recommended pack. The four additional recommended files are downloaded unchanged, with pinned byte lengths and SHA-256 digests. SHA-256 is checked when Web Crypto is available; byte length and container checks apply in all contexts. They are approximately 8.53 MB, 2.54 MB, 1.41 MB and 1.36 MB respectively. They are not converted or subsetted. Each original file is downloaded when its font is selected or its preview row becomes visible, not by installing the application. Opening and scrolling the picker can therefore download several complete original fonts.

`packages/shared/src/note-image-remote-fonts.ts` defines this catalog. Subsets are provided by the [Chinese Webfont Project](https://github.com/KonghaYao/chinese-free-web-font-storage) and [Fontsource](https://fontsource.org/fonts/noto-sans-sc). Each request first tries jsDelivr, then unpkg. For CSS-backed fonts, only descriptors for WOFF2 files in the pinned package directory are accepted; external styles are never inserted into the page.

For CSS-backed fonts, the selected font's manifest is fetched on demand. The renderer matches its Unicode ranges against the card's text and downloads only matching subsets, not the entire family. Note text is matched locally and is never sent in font requests. Manifests and font bytes are cached in the separate, disposable IndexedDB database `edgeever-share-font-cache`. Downloads are deduplicated, failed requests can be retried, and unavailable storage does not prevent online rendering. The application waits for font loading before rendering the image.

Offline reuse requires both the manifest and the relevant character subsets to remain cached. A new character may require another download. Browser storage eviction, restricted WebViews, or clearing site data can remove this ability; HTTP caching and in-session deduplication still apply where available. These fonts do not change editor typography or the existing fonts bundled with card themes.

The original four optional fonts use SIL OFL 1.1. The four newly added starter-pack fonts retain their original vendor terms and metadata, rather than being described as OFL. Copyright notices and the license are retained in `packages/shared/src/note-image-remote-font-notices.ts` and included with generated font CSS for OFL fonts. Original-file fonts instead include source attribution in the generated CSS. Font outlines and font-file names are not modified. The CSS family aliases isolate share-image fonts from editor fonts.

Checks for this change include shared unit tests, Web and mobile type checks, the Web build, the iOS editor type check/build, and Chrome image exports before and after reloading with font CDNs blocked. Android USB-device and iOS-device acceptance must still be performed separately; a desktop browser check does not establish native-platform acceptance.

The Web picker renders each visible name in its corresponding font, including the selected value. Hidden rows do not start preview downloads. Name previews reuse the same face and persistent resource caches as image export, without generating another embedded base64 stylesheet or fetching paper textures. Failed previews keep a readable system-font label and do not prevent selection.
