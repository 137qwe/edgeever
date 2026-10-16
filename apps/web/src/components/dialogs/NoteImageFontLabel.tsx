import { useEffect, useRef, useState } from "react";
import { prepareNoteImageAssets } from "@edgeever/shared/note-image-fonts";
import { noteImageAssetUrls } from "@edgeever/shared/note-image-assets";
import { resolveNoteImageTypography, type NoteImageFontStyle, type NoteImageTheme } from "@edgeever/shared/note-image-card";

/** Hidden Radix items also mount: only load names when the menu and row are visible. */
export const NoteImageFontLabel = ({ label, fontStyle, theme, enabled, visibleOnly = false }: {
  label: string;
  fontStyle: NoteImageFontStyle;
  theme: NoteImageTheme;
  enabled: boolean;
  visibleOnly?: boolean;
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [readyKey, setReadyKey] = useState("");
  const key = `${fontStyle}:${theme}:${label}`;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      void prepareNoteImageAssets({ theme, fontStyle, text: label, urls: noteImageAssetUrls, embed: false })
        .then(() => { if (active) setReadyKey(key); })
        .catch(() => { /* Keep the name readable and selectable if preview loading fails. */ });
    };
    let observer: IntersectionObserver | undefined;
    if (visibleOnly && ref.current) {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          observer?.disconnect();
          load();
        }
      });
      observer.observe(ref.current);
    } else {
      load();
    }
    return () => { active = false; observer?.disconnect(); };
  }, [enabled, visibleOnly, fontStyle, theme, label, key]);

  return <span ref={ref} className="text-sm leading-6" style={readyKey === key ? { fontFamily: resolveNoteImageTypography(theme, fontStyle).bodyFamily } : undefined}>{label}</span>;
};
