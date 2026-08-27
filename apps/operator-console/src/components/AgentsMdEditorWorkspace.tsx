import SkillsManagerApp from "../features/skills-manager/App";

interface AgentsMdEditorWorkspaceProps {
  rootPath: string;
  filePath: string;
  onBack: () => void;
}

export function AgentsMdEditorWorkspace({
  rootPath,
  filePath,
  onBack,
}: AgentsMdEditorWorkspaceProps) {
  return (
    <div className="skills-manager-root min-w-0 h-full overflow-hidden">
      <SkillsManagerApp
        mode="agents-md"
        editorRoot={rootPath}
        editorFile={filePath}
        onEditorBack={onBack}
      />
    </div>
  );
}
