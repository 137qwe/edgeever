import { useEffect, useRef, useState } from "react";
import { FONT_CATALOG, type RemoteNoteImageFont } from "@edgeever/shared/font-catalog";
import { loadCatalogFont } from "@edgeever/shared/font-loader";

/** Radix mounts hidden items too; previews only request fonts for visible menu rows. */
export const FontLabel = ({ label, fontId, fontFamily, registrationFamily, enabled, visibleOnly = false, loadFont }: {
  label: string;
  fontId?: RemoteNoteImageFont;
  fontFamily?: string;
  registrationFamily?: string;
  enabled: boolean;
  visibleOnly?: boolean;
  loadFont?: (text: string) => Promise<unknown>;
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [readyKey, setReadyKey] = useState("");
  const family = fontFamily ?? (fontId ? `"${registrationFamily ?? FONT_CATALOG[fontId].family}", sans-serif` : undefined);
  const key = `${fontId ?? ""}:${family ?? ""}:${label}`;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      const pending = fontId ? loadCatalogFont(fontId, label, { family: registrationFamily }) : loadFont?.(label) ?? Promise.resolve();
      void pending.then(() => { if (active) setReadyKey(key); }).catch(() => { /* Keep names readable and selectable. */ });
    };
    let observer: IntersectionObserver | undefined;
    if (visibleOnly && ref.current) {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); load(); }
      });
      observer.observe(ref.current);
    } else load();
    return () => { active = false; observer?.disconnect(); };
  }, [enabled, visibleOnly, fontId, registrationFamily, label, key, loadFont]);
  return <span ref={ref} className="text-sm leading-6" style={readyKey === key ? { fontFamily: family } : undefined}>{label}</span>;
};
