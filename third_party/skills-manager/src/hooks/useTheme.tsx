import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { FontFamilyPreset, getFontFamilyStack } from "@/lib/fontFamily";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  fontFamily: FontFamilyPreset;
  setTheme: (theme: Theme) => void;
  setFontFamily: (fontFamily: FontFamilyPreset) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

interface ThemeProviderProps {
  children: ReactNode;
  theme: Theme;
  fontFamily: FontFamilyPreset;
  onThemeChange?: (theme: Theme) => void;
  onFontFamilyChange?: (fontFamily: FontFamilyPreset) => void;
}

export function ThemeProvider({
  children,
  theme,
  fontFamily,
  onThemeChange,
  onFontFamilyChange,
}: ThemeProviderProps) {
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(theme));

  // Apply theme class to document
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);

    const root = document.documentElement;
    if (resolved === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--app-font-family", getFontFamilyStack(fontFamily));
  }, [fontFamily]);

  // Listen for system theme changes when theme is "system"
  useEffect(() => {
    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const resolved = getSystemTheme();
      setResolvedTheme(resolved);
      const root = document.documentElement;
      if (resolved === "dark") {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    onThemeChange?.(newTheme);
  }, [onThemeChange]);

  const setFontFamily = useCallback((newFontFamily: FontFamilyPreset) => {
    onFontFamilyChange?.(newFontFamily);
  }, [onFontFamilyChange]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, fontFamily, setTheme, setFontFamily }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
