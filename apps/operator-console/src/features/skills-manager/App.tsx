import { useState, useEffect } from "react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { Layout } from "@skills-manager/components/layout/Layout";
import { Skills } from "@skills-manager/pages/Skills";
import { Tools } from "@skills-manager/pages/Tools";
import { Settings } from "@skills-manager/pages/Settings";
import { EditorPage, type EditorMode } from "@skills-manager/pages/Editor";
import { Welcome } from "@skills-manager/pages/Welcome";
import { useInitialization } from "@skills-manager/hooks/useInitialization";
import { ThemeProvider } from "@skills-manager/hooks/useTheme";
import { SkillTranslationProvider } from "@skills-manager/hooks/useSkillTranslation";
import { I18nProvider, Language } from "@skills-manager/i18n";
import { ToastContainer, useToast } from "@skills-manager/components/ui/toast";
import { CommandPalette } from "@skills-manager/components/CommandPalette";
import { PageHeaderProvider } from "@skills-manager/components/PageHeaderContext";

function GlobalShortcuts({ onOpenPalette }: { onOpenPalette: () => void }) {
  const navigate = useNavigate();
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      // Cmd+K / Ctrl+K: open command palette
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        onOpenPalette();
        return;
      }
      // Cmd+, / Ctrl, (macOS Settings convention): open settings
      if (e.key === ",") {
        e.preventDefault();
        navigate("/settings");
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, onOpenPalette]);
  return null;
}

function StandardApp() {
  const { isInitialized, isLoading: initLoading, markInitialized } = useInitialization();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { toasts, removeToast } = useToast();

  // Skills Manager follows the Desktop shell's current static English UI.
  // Local Skill content translation still receives an explicit target language at operation time.
  const language: Language = "en";

  if (initLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isInitialized) {
    return <ThemeProvider><I18nProvider language={language}><Welcome onComplete={markInitialized} /></I18nProvider></ThemeProvider>;
  }

  return <ThemeProvider><I18nProvider language={language}>
    <MemoryRouter>
      <PageHeaderProvider>
        <SkillTranslationProvider>
          <GlobalShortcuts onOpenPalette={() => setPaletteOpen(true)} />
          <Routes>
            <Route path="/" element={<Layout onOpenPalette={() => setPaletteOpen(true)} />}>
              <Route index element={<Skills />} />
              <Route path="tools" element={<Tools />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="/editor" element={<EditorPage />} />
          </Routes>
          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
          <ToastContainer toasts={toasts} onRemove={removeToast} />
        </SkillTranslationProvider>
      </PageHeaderProvider>
    </MemoryRouter>
  </I18nProvider></ThemeProvider>;
}

interface SkillsManagerAppProps {
  mode?: EditorMode;
  editorRoot?: string;
  editorFile?: string;
  onEditorBack?: () => void;
}

function EditorOnlyApp({ editorRoot = "", editorFile = "", onEditorBack }: SkillsManagerAppProps) {
  const editorPath = `/editor?root=${encodeURIComponent(editorRoot)}&file=${encodeURIComponent(editorFile)}`;

  return <ThemeProvider><I18nProvider language="en">
    <MemoryRouter initialEntries={[editorPath]}>
      <Routes>
        <Route path="/editor" element={<EditorPage mode="agents-md" onBack={onEditorBack} />} />
      </Routes>
    </MemoryRouter>
  </I18nProvider></ThemeProvider>;
}

function App(props: SkillsManagerAppProps) {
  if (props.mode === "agents-md") {
    return <EditorOnlyApp {...props} />;
  }
  return <StandardApp />;
}

export default App;
