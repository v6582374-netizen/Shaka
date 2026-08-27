import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { FileNode } from "@/types";
import { useTranslation } from "@/i18n";
import { CustomCaretInput } from "@/components/ui/custom-caret-input";

interface FileTreeProps {
  root: FileNode;
  rootPath?: string;
  selectedPath: string;
  onSelectFile: (path: string) => void;
  onRefresh?: () => void;
}

type EditKind = "new-file" | "new-folder" | "rename";

interface EditState {
  kind: EditKind;
  parentPath: string;
  nodePath?: string;
  value: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: FileNode;
}

// Map raw backend errors to i18n keys for human-friendly messages.
function humanizeErrorKey(err: unknown): string {
  const msg = String(err);
  // os error 22: Invalid argument — often "moving dir into itself" or illegal chars
  if (msg.includes("os error 22") || msg.includes("Invalid argument")) {
    return "editor.errorInvalidPath";
  }
  // os error 2: No such file or directory
  if (msg.includes("os error 2") || msg.includes("No such file or directory")) {
    return "editor.errorNotFound";
  }
  // os error 17: File exists / Already exists
  if (msg.includes("os error 17") || msg.includes("already exists") || msg.includes("Already exists")) {
    return "editor.errorAlreadyExists";
  }
  // os error 13: Permission denied
  if (msg.includes("os error 13") || msg.includes("Permission denied")) {
    return "editor.errorPermission";
  }
  // os error 18: Cross-device link — rename across filesystems
  if (msg.includes("os error 18") || msg.includes("Cross-device link")) {
    return "editor.errorCrossDevice";
  }
  // os error 39: Directory not empty
  if (msg.includes("os error 39") || msg.includes("Directory not empty")) {
    return "editor.errorDirNotEmpty";
  }
  return msg;
}

export function FileTree({ root, rootPath, selectedPath, onSelectFile, onRefresh }: FileTreeProps) {
  const { t } = useTranslation();
  // File operations are only available when both rootPath and onRefresh are provided.
  const canEdit = !!(rootPath && onRefresh);
  const [query, setQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set([root.path]));
  const editInputRef = useRef<HTMLInputElement | null>(null);

  // The root node is the skill folder itself; renaming/deleting it would break
  // all tool symlinks, so it must be protected.
  const isRootNode = useCallback((node: FileNode) => node.path === root.path, [root.path]);

  useEffect(() => {
    setExpandedPaths((prev) => {
      if (prev.has(root.path)) return prev;
      const next = new Set(prev);
      next.add(root.path);
      return next;
    });
  }, [root.path]);

  // Focus edit input when entering edit mode
  useEffect(() => {
    if (edit && editInputRef.current) {
      editInputRef.current.focus();
      // For rename, select only the name part (without extension) like VS Code
      if (edit.kind === "rename" && edit.nodePath) {
        const name = edit.value;
        const dotIdx = name.lastIndexOf(".");
        if (dotIdx > 0) {
          editInputRef.current.setSelectionRange(0, dotIdx);
        } else {
          editInputRef.current.select();
        }
      } else {
        editInputRef.current.select();
      }
    }
  }, [edit]);

  // Close context menu on any click / ESC
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  // Filter tree by query (case-insensitive substring match on node name)
  const filteredRoot = useMemo(() => {
    if (!query.trim()) return root;
    const q = query.trim().toLowerCase();
    const filterNode = (node: FileNode): FileNode | null => {
      const matches = node.name.toLowerCase().includes(q);
      if (!node.is_dir) {
        return matches ? { ...node, children: undefined } : null;
      }
      const children = (node.children ?? [])
        .map(filterNode)
        .filter((c): c is FileNode => c !== null);
      if (matches || children.length > 0) {
        return { ...node, children };
      }
      return null;
    };
    return filterNode(root);
  }, [root, query]);

  const isSearching = query.trim().length > 0;

  // When searching, force-expand all directories (null means expand everything)
  const effectiveExpanded = useMemo(() => {
    if (isSearching) return null;
    return expandedPaths;
  }, [isSearching, expandedPaths]);

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const joinPath = useCallback((parent: string, name: string) => {
    if (!parent || parent === ".") return name;
    return `${parent}/${name}`;
  }, []);

  const toAbsolutePath = useCallback(
    (relPath: string) => {
      if (!rootPath) return "";
      if (relPath === ".") return rootPath;
      return `${rootPath}/${relPath}`;
    },
    [rootPath],
  );

  const dispatchError = useCallback((err: unknown) => {
    console.error("[FileTree] operation failed:", err);
    const key = humanizeErrorKey(err);
    // If the key is a known i18n key, translate it; otherwise it's a raw message.
    const detail = key.startsWith("editor.") ? t(key as never) : key;
    window.dispatchEvent(
      new CustomEvent("filetree:error", { detail }),
    );
  }, [t]);

  const startCreate = useCallback(
    (kind: "new-file" | "new-folder", parentPath: string) => {
      if (!canEdit) return;
      setContextMenu(null);
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.add(parentPath);
        return next;
      });
      setEdit({ kind, parentPath, value: "" });
    },
    [canEdit],
  );

  const startRename = useCallback(
    (node: FileNode) => {
      if (!canEdit) return;
      // Protect the skill root folder: renaming it breaks all tool symlinks.
      if (isRootNode(node)) {
        setContextMenu(null);
        window.dispatchEvent(
          new CustomEvent("filetree:error", { detail: t("editor.errorRootProtected") }),
        );
        return;
      }
      setContextMenu(null);
      setEdit({ kind: "rename", parentPath: node.path, nodePath: node.path, value: node.name });
    },
    [canEdit, isRootNode, t],
  );

  const cancelEdit = useCallback(() => setEdit(null), []);

  const updateEditValue = useCallback((value: string) => {
    setEdit((prev) => (prev ? { ...prev, value } : prev));
  }, []);

  const commitEdit = useCallback(async () => {
    if (!edit || !canEdit || !onRefresh) return;
    const name = edit.value.trim();
    if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
      setEdit(null);
      return;
    }

    try {
      if (edit.kind === "rename" && edit.nodePath) {
        const oldAbs = toAbsolutePath(edit.nodePath);
        const parentRel = edit.nodePath.includes("/")
          ? edit.nodePath.slice(0, edit.nodePath.lastIndexOf("/"))
          : ".";
        const newRel = joinPath(parentRel, name);
        const newAbs = toAbsolutePath(newRel);
        if (oldAbs === newAbs) {
          setEdit(null);
          return;
        }
        await invoke("rename_path", { oldPath: oldAbs, newPath: newAbs });
        if (selectedPath === edit.nodePath) {
          onSelectFile(newRel);
        }
      } else {
        const relPath = joinPath(edit.parentPath, name);
        const absPath = toAbsolutePath(relPath);
        if (edit.kind === "new-file") {
          await invoke("create_file", { path: absPath });
          onSelectFile(relPath);
        } else {
          await invoke("create_directory", { path: absPath });
        }
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.add(edit.parentPath);
          return next;
        });
      }
      setEdit(null);
      onRefresh();
    } catch (err) {
      setEdit(null);
      dispatchError(err);
    }
  }, [edit, canEdit, onRefresh, joinPath, toAbsolutePath, selectedPath, onSelectFile, dispatchError]);

  const handleDelete = useCallback(
    async (node: FileNode) => {
      if (!canEdit || !onRefresh) return;
      // Protect the skill root folder.
      if (isRootNode(node)) {
        setContextMenu(null);
        window.dispatchEvent(
          new CustomEvent("filetree:error", { detail: t("editor.errorRootProtected") }),
        );
        return;
      }
      setContextMenu(null);
      const confirmed = await confirm(
        t("editor.deleteConfirm").replace("{name}", node.name),
        {
          title: t("editor.deleteConfirmTitle"),
          kind: "warning",
        },
      );
      if (!confirmed) return;

      try {
        const absPath = toAbsolutePath(node.path);
        await invoke("delete_path", { path: absPath });
        if (selectedPath === node.path || selectedPath.startsWith(`${node.path}/`)) {
          onSelectFile("");
        }
        onRefresh();
      } catch (err) {
        dispatchError(err);
      }
    },
    [t, canEdit, onRefresh, isRootNode, toAbsolutePath, selectedPath, onSelectFile, dispatchError],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: FileNode) => {
      if (!canEdit) return;
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, node });
    },
    [canEdit],
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--background)",
        overflow: "hidden",
      }}
    >
      {/* Search + toolbar */}
      <div
        style={{
          padding: 8,
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <div style={{ position: "relative" }}>
          <CustomCaretInput
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("editor.searchFiles")}
            spellCheck={false}
            style={{
              width: "100%",
              padding: "5px 24px 5px 8px",
              fontSize: 12,
              lineHeight: 1.4,
              border: "1px solid var(--border)",
              borderRadius: 6,
              backgroundColor: "var(--background)",
              color: "var(--foreground)",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("editor.clearSearch")}
              style={{
                position: "absolute",
                right: 4,
                top: "50%",
                transform: "translateY(-50%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 18,
                height: 18,
                padding: 0,
                border: "none",
                borderRadius: 4,
                backgroundColor: "transparent",
                color: "var(--muted-foreground)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--secondary)";
                e.currentTarget.style.color = "var(--foreground)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "var(--muted-foreground)";
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
        {filteredRoot ? (
          <TreeNode
            node={filteredRoot}
            root={root}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            onContextMenu={handleContextMenu}
            onToggleExpand={toggleExpand}
            onRename={startRename}
            onDelete={handleDelete}
            onNewFile={startCreate}
            expandedPaths={effectiveExpanded}
            level={0}
            edit={edit}
            editInputRef={editInputRef}
            onEditValueChange={updateEditValue}
            onCommitEdit={commitEdit}
            onCancelEdit={cancelEdit}
            query={isSearching ? query.trim().toLowerCase() : ""}
            canEdit={canEdit}
          />
        ) : (
          <div
            style={{
              padding: "12px 8px",
              fontSize: 12,
              color: "var(--muted-foreground)",
              textAlign: "center",
            }}
          >
            {t("editor.noResults")}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          isRoot={isRootNode(contextMenu.node)}
          onNewFile={(parent) => startCreate("new-file", parent)}
          onNewFolder={(parent) => startCreate("new-folder", parent)}
          onRename={(node) => startRename(node)}
          onDelete={(node) => void handleDelete(node)}
        />
      )}
    </div>
  );
}

interface TreeNodeProps {
  node: FileNode;
  root: FileNode;
  selectedPath: string;
  onSelectFile: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onToggleExpand: (path: string) => void;
  onRename: (node: FileNode) => void;
  onDelete: (node: FileNode) => void;
  onNewFile: (kind: "new-file" | "new-folder", parentPath: string) => void;
  expandedPaths: Set<string> | null;
  level: number;
  edit: EditState | null;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  onEditValueChange: (value: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  query: string;
  canEdit: boolean;
}

function TreeNode({
  node,
  root,
  selectedPath,
  onSelectFile,
  onContextMenu,
  onToggleExpand,
  onRename,
  onDelete,
  onNewFile,
  expandedPaths,
  level,
  edit,
  editInputRef,
  onEditValueChange,
  onCommitEdit,
  onCancelEdit,
  query,
  canEdit,
}: TreeNodeProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const isSelected = selectedPath === node.path;
  const isExpanded = expandedPaths === null ? true : expandedPaths.has(node.path);
  const isRoot = node.path === root.path;

  const handleClick = () => {
    if (node.is_dir) {
      onToggleExpand(node.path);
    } else {
      onSelectFile(node.path);
    }
  };

  const isRenaming = edit?.kind === "rename" && edit.nodePath === node.path;
  const showNewInput =
    (edit?.kind === "new-file" || edit?.kind === "new-folder") &&
    edit.parentPath === node.path &&
    node.is_dir;

  // Background: selected > hover > transparent
  const bgColor = isSelected
    ? "color-mix(in srgb, var(--primary) 15%, transparent)"
    : hovered
      ? "var(--secondary)"
      : "transparent";

  return (
    <div>
      <div
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, node)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 8px",
          paddingLeft: 8 + level * 12,
          paddingRight: 4,
          cursor: "pointer",
          backgroundColor: bgColor,
          color: isSelected ? "var(--foreground)" : "var(--muted-foreground)",
          fontSize: 13,
          userSelect: "none",
          borderRadius: 4,
          position: "relative",
        }}
      >
        {node.is_dir ? (
          <FolderIcon open={isExpanded} />
        ) : (
          <FileTypeIcon name={node.name} />
        )}
        {isRenaming ? (
          <EditInput
            inputRef={editInputRef}
            value={edit!.value}
            onChange={onEditValueChange}
            onCommit={onCommitEdit}
            onCancel={onCancelEdit}
          />
        ) : (
          <span
            style={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            dangerouslySetInnerHTML={
              query
                ? {
                    __html: highlightMatch(node.name, query),
                  }
                : undefined
            }
          >
            {query ? undefined : node.name}
          </span>
        )}

        {/* Inline action buttons on hover (not shown during edit) */}
        {canEdit && !isRenaming && (hovered || isSelected) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              flexShrink: 0,
            }}
          >
            {node.is_dir && (
              <InlineActionBtn
                title={t("editor.newFile")}
                onClick={(e) => {
                  e.stopPropagation();
                  onNewFile("new-file", node.path);
                }}
              >
                <FilePlusIcon />
              </InlineActionBtn>
            )}
            {!isRoot && (
              <>
                <InlineActionBtn
                  title={t("editor.rename")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(node);
                  }}
                >
                  <EditIcon />
                </InlineActionBtn>
                <InlineActionBtn
                  title={t("editor.delete")}
                  danger
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(node);
                  }}
                >
                  <TrashIcon />
                </InlineActionBtn>
              </>
            )}
          </div>
        )}
      </div>

      {/* Inline input for creating a new file/folder inside this directory */}
      {showNewInput && isExpanded && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 8px",
            paddingLeft: 8 + (level + 1) * 12,
            paddingRight: 4,
            fontSize: 13,
          }}
        >
          {edit!.kind === "new-folder" ? <FolderIcon open={false} /> : <FileTypeIcon name={edit!.value || "new.md"} />}
          <EditInput
            inputRef={editInputRef}
            value={edit!.value}
            onChange={onEditValueChange}
            onCommit={onCommitEdit}
            onCancel={onCancelEdit}
          />
        </div>
      )}

      {node.is_dir && isExpanded && node.children && (
        <div>
          {node.children.length === 0 && !showNewInput ? (
            <div
              style={{
                padding: "3px 8px",
                paddingLeft: 8 + (level + 1) * 12,
                fontSize: 12,
                color: "var(--muted-foreground)",
                opacity: 0.6,
                fontStyle: "italic",
              }}
            >
              {t("editor.emptyFolder")}
            </div>
          ) : (
            node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                root={root}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                onContextMenu={onContextMenu}
                onToggleExpand={onToggleExpand}
                onRename={onRename}
                onDelete={onDelete}
                onNewFile={onNewFile}
                expandedPaths={expandedPaths}
                level={level + 1}
                edit={edit}
                editInputRef={editInputRef}
                onEditValueChange={onEditValueChange}
                onCommitEdit={onCommitEdit}
                onCancelEdit={onCancelEdit}
                query={query}
                canEdit={canEdit}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface InlineActionBtnProps {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  danger?: boolean;
}

function InlineActionBtn({ title, onClick, children, danger }: InlineActionBtnProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        padding: 0,
        border: "none",
        borderRadius: 4,
        backgroundColor: "transparent",
        color: danger ? "var(--destructive)" : "var(--muted-foreground)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = danger
          ? "var(--color-error-bg)"
          : "color-mix(in srgb, var(--primary) 15%, transparent)";
        e.currentTarget.style.color = danger ? "var(--destructive)" : "var(--foreground)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.color = danger ? "var(--destructive)" : "var(--muted-foreground)";
      }}
    >
      {children}
    </button>
  );
}

interface EditInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

function EditInput({ inputRef, value, onChange, onCommit, onCancel }: EditInputProps) {
  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        if (value.trim()) {
          onCommit();
        } else {
          onCancel();
        }
      }}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      style={{
        flex: 1,
        minWidth: 0,
        padding: "1px 4px",
        fontSize: 13,
        border: "1px solid var(--primary)",
        borderRadius: 4,
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
        outline: "none",
      }}
    />
  );
}

function highlightMatch(name: string, query: string): string {
  if (!query) return escapeHtml(name);
  const idx = name.toLowerCase().indexOf(query);
  if (idx < 0) return escapeHtml(name);
  const before = name.slice(0, idx);
  const match = name.slice(idx, idx + query.length);
  const after = name.slice(idx + query.length);
  return `${escapeHtml(before)}<mark style="background:color-mix(in srgb, var(--primary) 30%, transparent);color:inherit;border-radius:2px;padding:0;">${escapeHtml(match)}</mark>${escapeHtml(after)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface ContextMenuProps {
  x: number;
  y: number;
  node: FileNode;
  isRoot: boolean;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (node: FileNode) => void;
  onDelete: (node: FileNode) => void;
}

function ContextMenu({ x, y, node, isRoot, onNewFile, onNewFolder, onRename, onDelete }: ContextMenuProps) {
  const { t } = useTranslation();
  const menuWidth = 180;
  const menuHeight = isRoot ? 100 : 180;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - menuHeight - 8);

  const parentForCreate = node.is_dir ? node.path : parentDir(node.path);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left,
        top,
        width: menuWidth,
        zIndex: 10000,
        padding: 4,
        backgroundColor: "var(--background)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <ContextMenuItem
        icon={<FilePlusIcon />}
        label={t("editor.newFile")}
        onClick={() => onNewFile(parentForCreate)}
      />
      <ContextMenuItem
        icon={<FolderPlusIcon />}
        label={t("editor.newFolder")}
        onClick={() => onNewFolder(parentForCreate)}
      />
      {!isRoot && (
        <>
          <div style={{ height: 1, backgroundColor: "var(--border)", margin: "4px 0" }} />
          <ContextMenuItem
            icon={<EditIcon />}
            label={t("editor.rename")}
            onClick={() => onRename(node)}
          />
          <ContextMenuItem
            icon={<TrashIcon />}
            label={t("editor.delete")}
            danger
            onClick={() => onDelete(node)}
          />
        </>
      )}
    </div>
  );
}

interface ContextMenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

function ContextMenuItem({ icon, label, onClick, danger }: ContextMenuItemProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        fontSize: 13,
        cursor: "pointer",
        borderRadius: 4,
        color: danger ? "var(--destructive)" : "var(--foreground)",
        backgroundColor: hover
          ? danger
            ? "var(--color-error-bg)"
            : "var(--secondary)"
          : "transparent",
      }}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}

function parentDir(path: string): string {
  if (!path.includes("/")) return ".";
  return path.slice(0, path.lastIndexOf("/"));
}

// File-type-aware icon: .md gets a blue doc, others get a generic file icon.
function FileTypeIcon({ name }: { name: string }) {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const color = ext === "md"
    ? "#3b82f6"
    : ext === "json"
      ? "#eab308"
      : ext === "ts" || ext === "tsx"
        ? "#3178c6"
        : ext === "js" || ext === "jsx"
          ? "#eab308"
          : ext === "rs"
            ? "#ce422b"
            : ext === "py"
              ? "#22c55e"
              : "var(--muted-foreground)";
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      style={{ flexShrink: 0 }}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{
        flexShrink: 0,
        color: "var(--muted-foreground)",
      }}
    >
      {open ? (
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      ) : (
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      )}
    </svg>
  );
}

function FilePlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="12" x2="12" y2="18" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
