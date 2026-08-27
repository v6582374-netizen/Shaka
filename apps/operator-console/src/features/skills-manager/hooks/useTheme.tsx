import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Theme = "light" | "dark";

interface ThemeContextValue {
  resolvedTheme: Theme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  children: ReactNode;
}

function readDesktopTheme(): Theme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

const desktopThemeValue: ThemeContextValue = {
  resolvedTheme: typeof document === "undefined" ? "light" : readDesktopTheme(),
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [resolvedTheme, setResolvedTheme] = useState<Theme>(readDesktopTheme);

  // The migrated app shares a document with OpenWorker, so its theme stays inside its workspace.
  useEffect(() => {
    const resolved = readDesktopTheme();
    setResolvedTheme(resolved);
    const root = document.querySelector<HTMLElement>(".skills-manager-root");
    root?.classList.toggle("dark", resolved === "dark");
  }, []);

  useEffect(() => {
    const sync = () => {
      const resolved = readDesktopTheme();
      setResolvedTheme(resolved);
      document.querySelector<HTMLElement>(".skills-manager-root")?.classList.toggle("dark", resolved === "dark");
    };
    window.addEventListener("openwork:theme-pref", sync);
    return () => window.removeEventListener("openwork:theme-pref", sync);
  }, []);

  return (
    <ThemeContext.Provider value={{ resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  return context ?? desktopThemeValue;
}
