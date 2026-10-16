import type { RemoteNoteImageFont } from "@edgeever/shared/font-catalog";
import { loadCatalogFont } from "@edgeever/shared/font-loader";

let stop: (() => void) | undefined;

/** Refresh character subsets when notes mount, navigation changes them, or text is edited. */
export const watchEditorCatalogFont = (font: RemoteNoteImageFont | undefined) => {
  stop?.();
  stop = undefined;
  if (!font || typeof MutationObserver === "undefined" || !document.body) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = true;
  let last = "";
  const refresh = () => {
    const text = Array.from(document.querySelectorAll<HTMLElement>(".edgeever-editor .ProseMirror, .edgeever-mobile-tiptap-content, .edgeever-editor textarea"))
      .map(node => node instanceof HTMLTextAreaElement ? node.value : node.textContent ?? "").join(" ");
    // Character order and repeated paragraphs do not cause redundant loads.
    const characters = Array.from(new Set(Array.from(text))).sort().join("");
    if (!characters || characters === last) return;
    last = characters;
    void loadCatalogFont(font, characters).catch(() => { if (active) last = ""; });
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 120); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener("input", schedule);
  window.addEventListener("online", schedule);
  schedule();
  stop = () => {
    active = false;
    clearTimeout(timer);
    observer.disconnect();
    document.removeEventListener("input", schedule);
    window.removeEventListener("online", schedule);
  };
};
