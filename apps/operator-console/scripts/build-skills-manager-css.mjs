import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";
import postcss from "postcss";
import prefixSelector from "postcss-prefix-selector";

const projectRoot = process.cwd();
const repositoryRoot = path.resolve(projectRoot, "../..");
const upstreamRoot = path.join(repositoryRoot, "third_party", "skills-manager");
const sourcePath = path.join(projectRoot, "src", "features", "skills-manager", "index.css");
const outputPath = path.join(projectRoot, "public", "skills-manager.css");
const tailwindRequire = createRequire(
  path.join(projectRoot, "node_modules", "@tailwindcss", "postcss", "package.json"),
);
const tailwindCssPath = tailwindRequire.resolve("tailwindcss/index.css");
const source = (await fs.readFile(sourcePath, "utf8")).replace(
  '@import "tailwindcss";',
  `@import "${tailwindCssPath}";`,
);
const removeBundledFonts = {
  postcssPlugin: "remove-skills-manager-font-faces",
  AtRule(atRule) {
    if (atRule.name === "font-face") atRule.remove();
  },
};

const result = await postcss([
  tailwindcss({ base: upstreamRoot }),
  autoprefixer(),
  removeBundledFonts,
  prefixSelector({
    prefix: ".skills-manager-root",
    transform(prefix, selector, prefixedSelector) {
      const trimmed = selector.trim();
      if ([":root", "html", "body", "#root"].includes(trimmed)) return prefix;
      if (trimmed.includes(":root") || trimmed.includes(":host")) {
        return trimmed.replaceAll(":root", prefix).replaceAll(":host", prefix);
      }
      if (trimmed === ".dark") return `${prefix}.dark`;
      if (trimmed.startsWith(".dark ")) return `${prefix}.dark ${trimmed.slice(6)}`;
      if (trimmed.includes(":is(.dark *)")) {
        return prefixedSelector.replace(":is(.dark *)", `:is(${prefix}.dark *)`);
      }
      return prefixedSelector;
    },
  }),
]).process(source, { from: sourcePath, to: outputPath, map: false });

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, result.css);
