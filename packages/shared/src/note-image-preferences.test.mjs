import { expect, test } from "bun:test";
import { DEFAULT_NOTE_IMAGE_PREFERENCES, updateNoteImagePreference } from "./note-image-preferences";
import { NOTE_IMAGE_THEME_OPTIONS, resolveNoteImageTypography } from "./note-image-card";

test("selecting any template restores its typography after a custom font", () => {
  const custom = { ...DEFAULT_NOTE_IMAGE_PREFERENCES, fontStyle: "heavy", showAuthor: true, author: "天马" };
  for (const theme of NOTE_IMAGE_THEME_OPTIONS) {
    const selected = updateNoteImagePreference(custom, "theme", theme);
    expect(selected).toEqual({ ...custom, theme, fontStyle: "auto" });
    expect(resolveNoteImageTypography(theme, selected.fontStyle)).toEqual(resolveNoteImageTypography(theme));
    const manual = updateNoteImagePreference(selected, "fontStyle", "serif");
    expect(manual.fontStyle).toBe("serif");
    expect(updateNoteImagePreference(manual, "fontSize", "sm").fontStyle).toBe("serif");
    expect(updateNoteImagePreference(manual, "theme", theme).fontStyle).toBe("auto");
  }
});
