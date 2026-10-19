// Local Chrome fixture: real template builders, fonts, Fabric canvas and React
// panel; never reads or changes notes. Driven by verify-poster-previews.mjs.
import React from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import { enUS } from "../../packages/shared/src/i18n/en-US";
import { PosterTemplatePanel } from "../../apps/web/src/components/poster/PosterTemplatePanel";
import { buildPosterDesign, DESIGN_TEMPLATES } from "../../apps/web/src/lib/poster-design/templates";
import { renderPosterThumbnail } from "../../apps/web/src/lib/poster-canvas";
import { installEditorBodyFontFaces } from "../../apps/web/src/lib/editor-body-font-faces";
import "../../apps/web/src/styles/globals.css";

installEditorBodyFontFaces();
const i18n = i18next.createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: enUS } }, initAsync: false });
const root = createRoot(document.getElementById("fixture")!);
const mount = (width = 1080, zh = true) => root.render(
  <I18nextProvider i18n={i18n}>
    <div style={{ width: 300, height: 800, overflow: "auto" }}>
      <PosterTemplatePanel width={width} height={1440} zh={zh} disabled={false} onApply={() => {}} />
    </div>
  </I18nextProvider>,
);
const checkPoster = async (id: string) => {
  try {
    const doc = await buildPosterDesign({ id, title: "把想法\n变成作品", subtitle: "一个好想法，值得被看见。", badge: "创作笔记", width: 1080, height: 1440, zh: true });
    const url = await renderPosterThumbnail(doc);
    URL.revokeObjectURL(url);
    return { id, ok: true };
  } catch (error) {
    return { id, ok: false, error: String(error) };
  }
};
Object.assign(window, { posterPreviewTest: { mount, checkPoster, templateIds: DESIGN_TEMPLATES.map(template => template.id) } });
mount();
