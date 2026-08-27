// Tool icons - place image files in this directory with the tool ID as filename
// Supported formats: .svg, .png, .jpg, .jpeg
// e.g., claude-code.svg, crush.png, some-tool.jpg
const iconModules = import.meta.glob('./*.{svg,png,jpg,jpeg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const extensionPriority: Record<string, number> = {
  svg: 4,
  png: 3,
  jpg: 2,
  jpeg: 1,
};

// Build a map of tool ID -> icon URL
const toolIconUrls: Record<string, string> = {};

const selectedPriority: Record<string, number> = {};
for (const path in iconModules) {
  // Extract filename without extension: ./claude-code.svg -> claude-code
  const filename = path.replace('./', '');
  const id = filename.replace(/\.[^.]+$/, '');
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const priority = extensionPriority[ext] ?? 0;

  if (toolIconUrls[id] && (selectedPriority[id] ?? 0) >= priority) {
    continue;
  }

  toolIconUrls[id] = iconModules[path];
  selectedPriority[id] = priority;
}

export const getToolIconUrl = (id: string): string | null => {
  return toolIconUrls[id] || null;
};

// Generic fallback icon component (terminal style)
export const GenericToolIcon = () => (
  <svg width="44" height="44" viewBox="0 0 100 100" style={{ flexShrink: 0, borderRadius: 12 }}>
    <defs>
      <linearGradient id="generic-tool-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6B7280" />
        <stop offset="100%" stopColor="#4B5563" />
      </linearGradient>
    </defs>
    <rect width="100" height="100" rx="22" fill="url(#generic-tool-grad)"/>
    <path d="M30 40L45 50L30 60" stroke="white" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M50 60H70" stroke="white" strokeWidth="6" strokeLinecap="round"/>
  </svg>
);
