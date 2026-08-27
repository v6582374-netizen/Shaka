import arxivLogo from "../assets/external-data/arxiv.svg";
import coreLogo from "../assets/external-data/core.svg";
import crossrefLogo from "../assets/external-data/crossref.svg";
import semanticScholarLogo from "../assets/external-data/semantic-scholar.svg";
import { Icon } from "./Icon";

const LOGOS: Record<string, { src: string; label: string; className?: string }> = {
  arxiv: { src: arxivLogo, label: "arXiv" },
  "semantic-scholar": { src: semanticScholarLogo, label: "Semantic Scholar" },
  crossref: { src: crossrefLogo, label: "Crossref", className: "max-w-[78%]" },
  core: { src: coreLogo, label: "CORE" },
};

/** Branded source mark used by the External data quiet stack. Keep these as image assets rather
 * than letter badges: the catalog names are recognizable at a glance and remain crisp at 24–40px. */
export function ExternalDataIcon({ name, size = 36 }: { name: string; size?: number }) {
  const logo = LOGOS[name];
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[11px] border border-line bg-panel shadow-[0_1px_2px_rgba(20,28,40,0.06)]"
      style={{ width: size, height: size }}
      role="img"
      aria-label={logo?.label || name}
    >
      {logo ? (
        <img
          src={logo.src}
          alt=""
          className={`max-h-[72%] max-w-[72%] object-contain ${logo.className || ""}`}
          draggable={false}
        />
      ) : (
        <Icon name="plug" size={Math.round(size * 0.48)} />
      )}
    </span>
  );
}
