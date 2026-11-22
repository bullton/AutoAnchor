export type StyleId = "amber" | "tech" | "paper" | "mono";

export interface Palette {
  bg: string;
  bgSoft: string;
  ink: string;
  inkDim: string;
  inkFaint: string;
  accent: string;
  accentSoft: string;
  line: string;
  font: string;
}

export const palettes: Record<StyleId, Palette> = {
  amber: {
    bg: "#0E1116",
    bgSoft: "#161B23",
    ink: "#F5F1EA",
    inkDim: "rgba(245, 241, 234, 0.62)",
    inkFaint: "rgba(245, 241, 234, 0.34)",
    accent: "#E8A33D",
    accentSoft: "rgba(232, 163, 61, 0.16)",
    line: "rgba(245, 241, 234, 0.16)",
    font: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Source Han Sans SC", sans-serif',
  },
  tech: {
    bg: "#06121B",
    bgSoft: "#0B1D29",
    ink: "#E9F7FF",
    inkDim: "rgba(233, 247, 255, 0.64)",
    inkFaint: "rgba(233, 247, 255, 0.36)",
    accent: "#38D6E6",
    accentSoft: "rgba(56, 214, 230, 0.14)",
    line: "rgba(233, 247, 255, 0.14)",
    font: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  },
  paper: {
    bg: "#F2EDE3",
    bgSoft: "#E9E1D4",
    ink: "#1C1916",
    inkDim: "rgba(28, 25, 22, 0.66)",
    inkFaint: "rgba(28, 25, 22, 0.38)",
    accent: "#B8452F",
    accentSoft: "rgba(184, 69, 47, 0.14)",
    line: "rgba(28, 25, 22, 0.16)",
    font: '"Source Han Serif SC", "Songti SC", "STSong", "SimSun", serif',
  },
  mono: {
    bg: "#050505",
    bgSoft: "#0D0D0D",
    ink: "#FFFFFF",
    inkDim: "rgba(255, 255, 255, 0.64)",
    inkFaint: "rgba(255, 255, 255, 0.34)",
    accent: "#FFFFFF",
    accentSoft: "rgba(255, 255, 255, 0.10)",
    line: "rgba(255, 255, 255, 0.16)",
    font: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  },
};

export const getPalette = (id?: string): Palette =>
  palettes[(id as StyleId) in palettes ? (id as StyleId) : "amber"];

export const theme = palettes.amber;

export const titleSize = (text: string): number => {
  const n = text.length;
  if (n <= 12) return 104;
  if (n <= 18) return 88;
  if (n <= 26) return 74;
  if (n <= 34) return 62;
  return 54;
};
