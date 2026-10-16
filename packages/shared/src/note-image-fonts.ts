import { NOTE_IMAGE_FONT_NOTICES } from "./note-image-font-notices";
import { NOTE_IMAGE_FONT_SUBSETS } from "./note-image-font-manifest";
import { resolveTheme, type NoteImageTheme, type NoteImageFontStyle } from "./note-image-card";
import { readFontCache, writeFontCache } from "./note-image-font-cache";
import { isRemoteNoteImageFont, parseRemoteFontCss, remoteFontCssUrl, remoteFontUrls, remoteOriginalFont, remoteFontIntegrity } from "./note-image-remote-fonts";
import { NOTE_IMAGE_REMOTE_FONT_NOTICES } from "./note-image-remote-font-notices";

export const NOTE_IMAGE_THEME_FONTS = {
  gradient: "puhui", glass: "puhui", quote: "mincho", book: "song", memo: "misans",
  bento: "puhui", "black-sun": "puhui", frame: "puhui", handwritten: "longcang", code: "geist",
} as const;

type AssetUrl = string | number | { uri: string };
const resources = new Map<string, Promise<string>>();
const loadedFaces = new Map<string, Promise<FontFace>>();

const validRemoteResource = async (data: ArrayBuffer, css: boolean, url: string) => {
  const valid = data.byteLength > (css ? 0 : 48)
  && data.byteLength <= (css ? 1_000_000 : 24_000_000)
  && (css ? new TextDecoder().decode(data).includes("@font-face")
    : (new TextDecoder().decode(data.slice(0, 4)) === "wOF2" && new DataView(data).getUint32(8) === data.byteLength)
      || new DataView(data).getUint32(0) === 0x00010000 || new TextDecoder().decode(data.slice(0, 4)) === "OTTO");
  if (!valid) return false;
  const original = remoteFontIntegrity(url);
  if (original && "bytes" in original) {
    if (data.byteLength !== original.bytes) return false;
    if (globalThis.crypto?.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("") === original.sha256;
    }
  }
  return true;
};

/** Cache manifests as well as subsets, so a later export works without the network. */
export const createRemoteFontResourceLoader = () => {
  const remoteResources = new Map<string, Promise<ArrayBuffer>>();
  return (url: string, css = false): Promise<ArrayBuffer> => {
    let pending = remoteResources.get(url);
    if (!pending) {
      pending = (async () => {
        const cached = await readFontCache(url);
        if (cached && await validRemoteResource(cached, css, url)) return cached;
        for (const mirror of remoteFontUrls(url)) {
          try {
            const data = await new Promise<ArrayBuffer>((resolve, reject) => {
              const request = new XMLHttpRequest();
              request.open("GET", mirror);
              request.responseType = "arraybuffer";
              request.timeout = 15_000;
              request.onload = () => request.status === 200 && request.response instanceof ArrayBuffer
                ? resolve(request.response) : reject(new Error("NOTE_IMAGE_FONT_UNAVAILABLE"));
              request.onerror = request.ontimeout = () => reject(new Error("NOTE_IMAGE_FONT_UNAVAILABLE"));
              request.send();
            });
            if (!await validRemoteResource(data, css, url)) continue;
            await writeFontCache(url, data);
            return data;
          } catch { /* Try the second pinned mirror. Never send note text to either host. */ }
        }
        throw new Error("NOTE_IMAGE_FONT_UNAVAILABLE");
      })();
      remoteResources.set(url, pending);
      void pending.catch(() => remoteResources.delete(url));
    }
    return pending;
  };
};
export const loadRemoteFontResource = createRemoteFontResourceLoader();

const remoteDataUrl = async (url: string) => {
  const data = await loadRemoteFontResource(url);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("NOTE_IMAGE_FONT_UNAVAILABLE"));
    const signature = new DataView(data).getUint32(0);
    reader.readAsDataURL(new Blob([data], { type: signature === 0x00010000 ? "font/ttf" : signature === 0x4f54544f ? "font/otf" : "font/woff2" }));
  });
};

const asDataUrl = (url: string): Promise<string> => {
  if (url.startsWith("data:")) return Promise.resolve(url);
  let pending = resources.get(url);
  if (!pending) {
    pending = new Promise<string>((resolve, reject) => {
      // WKWebView's bundled file URLs support XMLHttpRequest, but not fetch.
      const request = new XMLHttpRequest();
      request.open("GET", url);
      request.responseType = "blob";
      request.timeout = 20_000;
      request.onload = () => {
        if ((request.status !== 0 && request.status !== 200) || !request.response?.size) {
          reject(new Error("NOTE_IMAGE_ASSET_UNAVAILABLE"));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("NOTE_IMAGE_ASSET_UNAVAILABLE"));
        reader.readAsDataURL(request.response);
      };
      request.onerror = request.ontimeout = () => reject(new Error("NOTE_IMAGE_ASSET_UNAVAILABLE"));
      request.send();
    });
    resources.set(url, pending);
    void pending.catch(() => resources.delete(url));
  }
  return pending;
};

export const fontSubsetContains = (range: string, points: ReadonlySet<number>) => {
  const sorted = [...points].sort((a, b) => a - b);
  return range.split(",").some(part => {
    const [start, end = start] = part.trim().replace(/^U\+/i, "").split("-");
    const lower = parseInt(start.replace(/\?/g, "0"), 16);
    const upper = parseInt(end.replace(/\?/g, "F"), 16);
    let left = 0;
    let right = sorted.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (sorted[middle] < lower) left = middle + 1;
      else right = middle;
    }
    return left < sorted.length && sorted[left] <= upper;
  });
};

/** Only embed subsets used by this card. The editor never eagerly loads entire CJK fonts. */
export const prepareNoteImageAssets = async ({ theme, fontStyle = "auto", text, urls, embed = true }: {
  theme: NoteImageTheme; fontStyle?: NoteImageFontStyle; text: string; urls: Record<string, AssetUrl>; embed?: boolean;
}) => {
  const active = resolveTheme(undefined, theme);
  const getAsset = (name: string) => {
    const asset = urls[name];
    if (!asset || typeof asset === "number") throw new Error("NOTE_IMAGE_ASSET_UNAVAILABLE");
    return asDataUrl(typeof asset === "string" ? asset : asset.uri);
  };
  const points = new Set(Array.from(text, char => char.codePointAt(0)!));
  const remote = isRemoteNoteImageFont(fontStyle);
  const original = remote ? remoteOriginalFont(fontStyle) : undefined;
  const catalog = remote
    ? original ? [original] : parseRemoteFontCss(new TextDecoder().decode(await loadRemoteFontResource(remoteFontCssUrl(fontStyle), true)), fontStyle)
    : fontStyle === "auto" ? NOTE_IMAGE_FONT_SUBSETS[NOTE_IMAGE_THEME_FONTS[active]] : [];
  const blocks = catalog.filter(block => fontSubsetContains(block.range, points));
  const fontFacesCss = (await Promise.all(blocks.map(async block => {
    let loaded = loadedFaces.get(block.asset);
    // Picker labels only need the face registered, not another base64 export copy.
    const data = embed || !loaded ? await (remote ? remoteDataUrl(block.asset) : getAsset(block.asset)) : "";
    loaded = loadedFaces.get(block.asset);
    if (!loaded) {
      const face = new FontFace(block.family, `url("${data}")`, { weight: block.weight, unicodeRange: block.range });
      loaded = face.load().then(font => { document.fonts.add(font); return font; });
      loadedFaces.set(block.asset, loaded);
      void loaded.catch(() => loadedFaces.delete(block.asset));
    }
    await loaded;
    return embed ? `@font-face{font-family:"${block.family}";font-style:normal;font-weight:${block.weight};src:url("${data}");unicode-range:${block.range}}` : "";
  }))).join("\n");
  const notices = original
    ? `Original font file loaded unchanged from ${original.asset}. Original copyright and licensing metadata are retained in the font container. Alibaba PuHuiTi / Alimama ShuHeiTi: https://fonts.alibabagroup.com/ ; YouShe: https://www.uisdc.com/ . These fonts are not licensed under SIL OFL; no conversion or subsetting is performed.`
    : remote ? NOTE_IMAGE_REMOTE_FONT_NOTICES : NOTE_IMAGE_FONT_NOTICES;
  const fontCss = embed && blocks.length ? `/*! ${notices.replaceAll("*/", "* /")} */\n${fontFacesCss}` : "";
  const textureCss = embed && active === "handwritten"
    ? `.edgeever-image-wrapper{--ee-paper:url("${await getAsset("paper.png")}");--ee-paper-grain:url("${await getAsset("paper-text.png")}")}`
    : "";
  return { fontCss, css: `${fontCss}\n${textureCss}` };
};
