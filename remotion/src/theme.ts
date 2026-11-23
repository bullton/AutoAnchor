export type StyleId =
  | "amber"
  | "tech"
  | "paper"
  | "mono"
  | "swiss"
  | "poster"
  | "terminal"
  | "glass";

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

export type MarkerKind = "bar" | "square" | "diamond" | "bracket" | "dot";
export type RuleKind = "bar" | "hairline" | "dotted" | "none";
export type PatternKind = "lines" | "grid" | "scan" | "glow" | "none";
export type KickerKind = "plain" | "bar" | "square" | "bracket" | "pill";
export type CtaKind = "pill" | "block" | "underline";

export interface Look {
  displayFont: string;
  titleWeight: number;
  titleTracking: number;
  titleTransform: "none" | "uppercase";
  titleAlign: "left" | "center";
  kickerTracking: number;
  kickerTransform: "none" | "uppercase";
  kickerShape: KickerKind;
  marker: MarkerKind;
  rule: RuleKind;
  radius: number;
  pattern: PatternKind;
  cta: CtaKind;
}

const SANS =
  '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Source Han Sans SC", sans-serif';
const SERIF = '"Source Han Serif SC", "Songti SC", "STSong", "SimSun", serif';
const MONO = '"Cascadia Mono", Consolas, "Courier New", "Microsoft YaHei", monospace';
const GROTESK = '"Helvetica Neue", Arial, "Microsoft YaHei", "PingFang SC", sans-serif';
const HEAVY = '"Arial Black", Impact, "Microsoft YaHei", "Noto Sans SC", sans-serif';
const ROUNDED = '"Segoe UI Variable", "Microsoft YaHei UI", "PingFang SC", sans-serif';

export const looks: Record<StyleId, Look> = {
  amber: {
    displayFont: SANS,
    titleWeight: 800,
    titleTracking: 1,
    titleTransform: "none",
    titleAlign: "left",
    kickerTracking: 7,
    kickerTransform: "none",
    kickerShape: "plain",
    marker: "bar",
    rule: "bar",
    radius: 2,
    pattern: "lines",
    cta: "pill",
  },
  tech: {
    displayFont: GROTESK,
    titleWeight: 700,
    titleTracking: 2,
    titleTransform: "none",
    titleAlign: "left",
    kickerTracking: 6,
    kickerTransform: "uppercase",
    kickerShape: "bracket",
    marker: "bracket",
    rule: "hairline",
    radius: 0,
    pattern: "grid",
    cta: "block",
  },
  paper: {
    displayFont: SERIF,
    titleWeight: 600,
    titleTracking: 0.5,
    titleTransform: "none",
    titleAlign: "left",
    kickerTracking: 8,
    kickerTransform: "uppercase",
    kickerShape: "square",
    marker: "dot",
    rule: "hairline",
    radius: 0,
    pattern: "none",
    cta: "underline",
  },
  mono: {
    displayFont: SANS,
    titleWeight: 800,
    titleTracking: 0,
    titleTransform: "none",
    titleAlign: "left",
    kickerTracking: 8,
    kickerTransform: "uppercase",
    kickerShape: "bar",
    marker: "bar",
    rule: "none",
    radius: 0,
    pattern: "none",
    cta: "block",
  },
  swiss: {
    displayFont: GROTESK,
    titleWeight: 700,
    titleTracking: -0.5,
    titleTransform: "uppercase",
    titleAlign: "left",
    kickerTracking: 6,
    kickerTransform: "uppercase",
    kickerShape: "square",
    marker: "square",
    rule: "hairline",
    radius: 0,
    pattern: "grid",
    cta: "block",
  },
  poster: {
    displayFont: HEAVY,
    titleWeight: 900,
    titleTracking: -1.5,
    titleTransform: "uppercase",
    titleAlign: "center",
    kickerTracking: 5,
    kickerTransform: "uppercase",
    kickerShape: "square",
    marker: "diamond",
    rule: "none",
    radius: 0,
    pattern: "none",
    cta: "block",
  },
  terminal: {
    displayFont: MONO,
    titleWeight: 700,
    titleTracking: 1,
    titleTransform: "uppercase",
    titleAlign: "left",
    kickerTracking: 4,
    kickerTransform: "uppercase",
    kickerShape: "bracket",
    marker: "bracket",
    rule: "dotted",
    radius: 0,
    pattern: "scan",
    cta: "block",
  },
  glass: {
    displayFont: ROUNDED,
    titleWeight: 700,
    titleTracking: 0.5,
    titleTransform: "none",
    titleAlign: "center",
    kickerTracking: 3,
    kickerTransform: "uppercase",
    kickerShape: "pill",
    marker: "dot",
    rule: "none",
    radius: 28,
    pattern: "glow",
    cta: "pill",
  },
};

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
  swiss: {
    bg: "#F5F5F2",
    bgSoft: "#E7E7E1",
    ink: "#101010",
    inkDim: "rgba(16, 16, 16, 0.62)",
    inkFaint: "rgba(16, 16, 16, 0.36)",
    accent: "#E12D24",
    accentSoft: "rgba(225, 45, 36, 0.12)",
    line: "rgba(16, 16, 16, 0.16)",
    font: GROTESK,
  },
  poster: {
    bg: "#101C4A",
    bgSoft: "#1B2C6B",
    ink: "#FFF6E4",
    inkDim: "rgba(255, 246, 228, 0.68)",
    inkFaint: "rgba(255, 246, 228, 0.38)",
    accent: "#FFC93C",
    accentSoft: "rgba(255, 201, 60, 0.16)",
    line: "rgba(255, 246, 228, 0.18)",
    font: HEAVY,
  },
  terminal: {
    bg: "#03100B",
    bgSoft: "#071C12",
    ink: "#D6FFE6",
    inkDim: "rgba(214, 255, 230, 0.62)",
    inkFaint: "rgba(214, 255, 230, 0.34)",
    accent: "#35F59B",
    accentSoft: "rgba(53, 245, 155, 0.12)",
    line: "rgba(214, 255, 230, 0.16)",
    font: MONO,
  },
  glass: {
    bg: "#101528",
    bgSoft: "#18203A",
    ink: "#F3F6FF",
    inkDim: "rgba(243, 246, 255, 0.64)",
    inkFaint: "rgba(243, 246, 255, 0.34)",
    accent: "#8FB3FF",
    accentSoft: "rgba(143, 179, 255, 0.16)",
    line: "rgba(243, 246, 255, 0.14)",
    font: ROUNDED,
  },
};

export const getPalette = (id?: string): Palette =>
  palettes[(id as StyleId) in palettes ? (id as StyleId) : "amber"];

export const getLook = (id?: string): Look =>
  looks[(id as StyleId) in looks ? (id as StyleId) : "amber"];

export const theme = palettes.amber;

export const titleSize = (text: string): number => {
  const n = text.length;
  if (n <= 12) return 104;
  if (n <= 18) return 88;
  if (n <= 26) return 74;
  if (n <= 34) return 62;
  return 54;
};
