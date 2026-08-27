import type { editor } from "monaco-editor";

export const RAYCAST_MONACO_THEME_DARK = "raycast-dark";
export const RAYCAST_MONACO_THEME_LIGHT = "raycast-light";

const darkThemeData: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "e6edf3" },
    { token: "comment", foreground: "6a6b6c", fontStyle: "italic" },
    { token: "keyword", foreground: "ff6363" },
    { token: "string", foreground: "59d499" },
    { token: "number", foreground: "56c2ff" },
    { token: "type", foreground: "56c2ff" },
    { token: "function", foreground: "e6e6e6" },
    { token: "variable", foreground: "e6edf3" },
    { token: "tag", foreground: "ff6363" },
    { token: "attribute.name", foreground: "56c2ff" },
  ],
  colors: {
    "editor.background": "#040506",
    "editor.foreground": "#e6edf3",
    "editorLineNumber.foreground": "#454647",
    "editorLineNumber.activeForeground": "#9c9c9d",
    "editor.selectionBackground": "#1b1c1e",
    "editor.lineHighlightBackground": "#07080a",
    "editorCursor.foreground": "#e6e6e6",
    "editorWhitespace.foreground": "#1b1c1e",
    "editorIndentGuide.background": "#111214",
    "editorIndentGuide.activeBackground": "#363739",
    "editorGutter.background": "#040506",
    "editorBracketMatch.background": "#1b1c1e",
    "editorBracketMatch.border": "#363739",
    "scrollbarSlider.background": "#36373980",
    "scrollbarSlider.hoverBackground": "#45464780",
    "editorWidget.background": "#07080a",
    "editorWidget.border": "#363739",
    "input.background": "#111214",
    "input.border": "#363739",
    "dropdown.background": "#07080a",
    "dropdown.border": "#363739",
  },
};

const lightThemeData: editor.IStandaloneThemeData = {
  base: "vs",
  inherit: true,
  rules: [
    { token: "", foreground: "1a1a1a" },
    { token: "comment", foreground: "6a6b6c", fontStyle: "italic" },
    { token: "keyword", foreground: "d32f2f" },
    { token: "string", foreground: "16a34a" },
    { token: "number", foreground: "2563eb" },
    { token: "type", foreground: "2563eb" },
    { token: "function", foreground: "1a1a1a" },
    { token: "variable", foreground: "1a1a1a" },
    { token: "tag", foreground: "d32f2f" },
    { token: "attribute.name", foreground: "2563eb" },
  ],
  colors: {
    "editor.background": "#fbfbfa",
    "editor.foreground": "#1a1a1a",
    "editorLineNumber.foreground": "#6a6b6c",
    "editorLineNumber.activeForeground": "#1a1a1a",
    "editor.selectionBackground": "#e4e4e0",
    "editor.lineHighlightBackground": "#f4f4f2",
    "editorCursor.foreground": "#1a1a1a",
    "editorWhitespace.foreground": "#e4e4e0",
    "editorIndentGuide.background": "#e4e4e0",
    "editorIndentGuide.activeBackground": "#d1d9e0",
    "editorGutter.background": "#fbfbfa",
    "editorBracketMatch.background": "#e4e4e0",
    "editorBracketMatch.border": "#d1d9e0",
    "scrollbarSlider.background": "#c4c4c080",
    "scrollbarSlider.hoverBackground": "#a8a8a480",
    "editorWidget.background": "#ffffff",
    "editorWidget.border": "#e4e4e0",
    "input.background": "#ffffff",
    "input.border": "#e4e4e0",
    "dropdown.background": "#ffffff",
    "dropdown.border": "#e4e4e0",
  },
};

let registered = false;

/** Register both Raycast Monaco themes once. Call from Monaco's beforeMount. */
export function defineRaycastMonacoThemes(monaco: typeof import("monaco-editor")) {
  if (registered) return;
  monaco.editor.defineTheme(RAYCAST_MONACO_THEME_DARK, darkThemeData);
  monaco.editor.defineTheme(RAYCAST_MONACO_THEME_LIGHT, lightThemeData);
  registered = true;
}
