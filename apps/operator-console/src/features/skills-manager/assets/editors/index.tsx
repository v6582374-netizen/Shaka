import React from "react";

const iconStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  flexShrink: 0,
  borderRadius: 6,
};

// VS Code - Official blue
export const VSCodeIcon = () => (
  <svg style={iconStyle} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#007ACC"/>
    <path d="M70 20L30 45V55L70 80V68L45 50L70 32V20Z" fill="white"/>
    <path d="M70 20V32L45 50L70 68V80L80 75V25L70 20Z" fill="white" fillOpacity="0.7"/>
  </svg>
);

// Cursor - Black with cursor shape
export const CursorIcon = () => (
  <svg style={iconStyle} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#000"/>
    <path d="M30 25L30 75L45 60L55 75L65 70L55 55L70 55L30 25Z" fill="white"/>
  </svg>
);

// Windsurf - Codeium teal/green
export const WindsurfIcon = () => (
  <svg style={iconStyle} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#09B6A2"/>
    <path d="M25 70L50 30L75 70" stroke="white" strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M35 55L50 45L65 55" stroke="white" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Trae - ByteDance AI editor, cyan/teal gradient
export const TraeIcon = () => (
  <svg style={iconStyle} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#0EA5E9"/>
    <rect x="25" y="25" width="50" height="50" rx="8" stroke="white" strokeWidth="5" fill="none"/>
    <path d="M38 45H62M38 55H55" stroke="white" strokeWidth="4" strokeLinecap="round"/>
  </svg>
);

// Antigravity - Purple/violet
export const AntigravityIcon = () => (
  <svg style={iconStyle} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#7C3AED"/>
    <circle cx="50" cy="50" r="20" stroke="white" strokeWidth="6" fill="none"/>
    <path d="M50 25V20M50 80V75M25 50H20M80 50H75" stroke="white" strokeWidth="4" strokeLinecap="round"/>
  </svg>
);

// Zed - Orange/yellow
export const ZedIcon = () => (
  <svg style={iconStyle} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#F59E0B"/>
    <path d="M30 35H70L30 65H70" stroke="white" strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Sublime Text - Orange
export const SublimeIcon = () => (
  <svg style={iconStyle} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#FF9800"/>
    <path d="M25 40L75 25V45L25 60V40Z" fill="white"/>
    <path d="M25 55L75 40V60L25 75V55Z" fill="white" fillOpacity="0.6"/>
  </svg>
);

// IntelliJ IDEA - JetBrains style
export const IdeaIcon = () => (
  <svg style={iconStyle} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#000"/>
    <rect x="20" y="20" width="60" height="60" rx="4" fill="#FC801D"/>
    <rect x="25" y="65" width="30" height="8" fill="#000"/>
  </svg>
);

// PyCharm - Green JetBrains style
export const PyCharmIcon = () => (
  <svg style={iconStyle} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#000"/>
    <rect x="20" y="20" width="60" height="60" rx="4" fill="#21D789"/>
    <rect x="25" y="65" width="30" height="8" fill="#000"/>
  </svg>
);

// WebStorm - Cyan JetBrains style
export const WebStormIcon = () => (
  <svg style={iconStyle} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#000"/>
    <rect x="20" y="20" width="60" height="60" rx="4" fill="#00CDD7"/>
    <rect x="25" y="65" width="30" height="8" fill="#000"/>
  </svg>
);

// Xcode - Blue with X
export const XcodeIcon = () => (
  <svg style={iconStyle} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#147EFB"/>
    <path d="M30 30L70 70M70 30L30 70" stroke="white" strokeWidth="10" strokeLinecap="round"/>
  </svg>
);

// Android Studio - Green Android
export const AndroidStudioIcon = () => (
  <svg style={iconStyle} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#3DDC84"/>
    <ellipse cx="50" cy="42" rx="22" ry="18" fill="white"/>
    <circle cx="40" cy="38" r="3" fill="#3DDC84"/>
    <circle cx="60" cy="38" r="3" fill="#3DDC84"/>
    <rect x="35" y="58" width="30" height="18" rx="4" fill="white"/>
    <path d="M32 28L28 20M68 28L72 20" stroke="white" strokeWidth="4" strokeLinecap="round"/>
  </svg>
);

// Terminal - Black with prompt
export const TerminalIcon = () => (
  <svg style={iconStyle} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#1a1a1a"/>
    <path d="M30 35L50 50L30 65" stroke="#00FF00" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M55 65H70" stroke="#00FF00" strokeWidth="6" strokeLinecap="round"/>
  </svg>
);

// Finder - Blue face
export const FinderIcon = () => (
  <svg style={iconStyle} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#1C9BEF"/>
    <circle cx="35" cy="42" r="6" fill="white"/>
    <circle cx="65" cy="42" r="6" fill="white"/>
    <path d="M32 62Q50 78 68 62" stroke="white" strokeWidth="5" fill="none" strokeLinecap="round"/>
  </svg>
);

// Built-in Editor - Purple with editor icon
export const BuiltinIcon = () => (
  <svg style={iconStyle} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#6366F1"/>
    <rect x="25" y="25" width="50" height="50" rx="6" stroke="white" strokeWidth="5" fill="none"/>
    <path d="M35 45H65M35 55H55" stroke="white" strokeWidth="4" strokeLinecap="round"/>
  </svg>
);

export const editorIcons: Record<string, React.FC> = {
  vscode: VSCodeIcon,
  cursor: CursorIcon,
  windsurf: WindsurfIcon,
  trae: TraeIcon,
  antigravity: AntigravityIcon,
  zed: ZedIcon,
  sublime: SublimeIcon,
  idea: IdeaIcon,
  pycharm: PyCharmIcon,
  webstorm: WebStormIcon,
  xcode: XcodeIcon,
  "android-studio": AndroidStudioIcon,
  terminal: TerminalIcon,
  finder: FinderIcon,
  builtin: BuiltinIcon,
};

export const getEditorIcon = (id: string): React.FC => {
  return editorIcons[id] || BuiltinIcon;
};
