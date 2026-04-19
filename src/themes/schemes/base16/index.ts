/**
 * Base16 color schemes loaded from YAML files.
 * Sourced from tinted-theming/schemes (spec-0.11).
 * https://github.com/tinted-theming/schemes/tree/spec-0.11/base16
 */
// Embed YAML files at build time so they survive `bun build --compile`.
import ayuMirage from "./ayu-mirage.yaml" with { type: "text" };
import catppuccinFrappe from "./catppuccin-frappe.yaml" with { type: "text" };
import catppuccinLatte from "./catppuccin-latte.yaml" with { type: "text" };
import catppuccinMacchiato from "./catppuccin-macchiato.yaml" with { type: "text" };
import catppuccinMocha from "./catppuccin-mocha.yaml" with { type: "text" };
import dracula from "./dracula.yaml" with { type: "text" };
import everforest from "./everforest.yaml" with { type: "text" };
import flexokiDark from "./flexoki-dark.yaml" with { type: "text" };
import flexokiLight from "./flexoki-light.yaml" with { type: "text" };
import githubDark from "./github-dark.yaml" with { type: "text" };
import gruvboxDark from "./gruvbox-dark.yaml" with { type: "text" };
import gruvboxLight from "./gruvbox-light.yaml" with { type: "text" };
import kanagawa from "./kanagawa.yaml" with { type: "text" };
import monokai from "./monokai.yaml" with { type: "text" };
import nord from "./nord.yaml" with { type: "text" };
import oceanicnext from "./oceanicnext.yaml" with { type: "text" };
import onedark from "./onedark.yaml" with { type: "text" };
import rosePineDawn from "./rose-pine-dawn.yaml" with { type: "text" };
import rosePineMoon from "./rose-pine-moon.yaml" with { type: "text" };
import solarizedDark from "./solarized-dark.yaml" with { type: "text" };
import solarizedLight from "./solarized-light.yaml" with { type: "text" };
import spacemacs from "./spacemacs.yaml" with { type: "text" };
import tokyoNightDark from "./tokyo-night-dark.yaml" with { type: "text" };

export interface Base16Palette {
  base00: string;
  base01: string;
  base02: string;
  base03: string;
  base04: string;
  base05: string;
  base06: string;
  base07: string;
  base08: string;
  base09: string;
  base0A: string;
  base0B: string;
  base0C: string;
  base0D: string;
  base0E: string;
  base0F: string;
}

/** All registered base16 scheme names. Order determines UI cycling. */
export const BASE16_SCHEME_NAMES = [
  "ayu-mirage",
  "catppuccin-frappe",
  "catppuccin-latte",
  "catppuccin-macchiato",
  "catppuccin-mocha",
  "dracula",
  "everforest",
  "flexoki-dark",
  "flexoki-light",
  "github-dark",
  "gruvbox-dark",
  "gruvbox-light",
  "kanagawa",
  "monokai",
  "nord",
  "oceanicnext",
  "onedark",
  "rose-pine-dawn",
  "rose-pine-moon",
  "solarized-dark",
  "solarized-light",
  "spacemacs",
  "tokyo-night-dark",
] as const;

export type Base16SchemeName = (typeof BASE16_SCHEME_NAMES)[number];

// ---------------------------------------------------------------------------
// Simple base16 YAML parser (handles the tinted-theming format)
// ---------------------------------------------------------------------------

function parseBase16Yaml(content: string): Base16Palette {
  const palette: Record<string, string> = {};
  let inPalette = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("palette:")) {
      inPalette = true;
      continue;
    }
    if (inPalette) {
      const match = trimmed.match(/^(base[0-9A-Fa-f]{2}):\s*"(#[0-9A-Fa-f]{6})"/);
      if (match) palette[match[1]!] = match[2]!;
    }
  }
  return palette as unknown as Base16Palette;
}

// ---------------------------------------------------------------------------
// Map embedded YAML text to parsed palettes
// ---------------------------------------------------------------------------

const SCHEME_SOURCES: Record<Base16SchemeName, string> = {
  "ayu-mirage": ayuMirage,
  "catppuccin-frappe": catppuccinFrappe,
  "catppuccin-latte": catppuccinLatte,
  "catppuccin-macchiato": catppuccinMacchiato,
  "catppuccin-mocha": catppuccinMocha,
  dracula: dracula,
  everforest: everforest,
  "flexoki-dark": flexokiDark,
  "flexoki-light": flexokiLight,
  "github-dark": githubDark,
  "gruvbox-dark": gruvboxDark,
  "gruvbox-light": gruvboxLight,
  kanagawa: kanagawa,
  monokai: monokai,
  nord: nord,
  oceanicnext: oceanicnext,
  onedark: onedark,
  "rose-pine-dawn": rosePineDawn,
  "rose-pine-moon": rosePineMoon,
  "solarized-dark": solarizedDark,
  "solarized-light": solarizedLight,
  spacemacs: spacemacs,
  "tokyo-night-dark": tokyoNightDark,
};

const loaded: Record<string, Base16Palette> = {};
for (const name of BASE16_SCHEME_NAMES) {
  loaded[name] = parseBase16Yaml(SCHEME_SOURCES[name]);
}

export const BASE16_SCHEMES = loaded as Record<Base16SchemeName, Base16Palette>;
