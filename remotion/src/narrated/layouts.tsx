import React from "react";
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { useStyle } from "../components/StyleContext";
import { bodyWrapStyle, useLayout } from "../components/LayoutContext";
import type { SceneData } from "../types";
import { countUp, cue, fadeIn, fadeSlideLeft, fadeSlideRight, fadeSlideUp } from "./motion";
import {
  BarRow,
  Body,
  Chip,
  Credit,
  Headline,
  Marker,
  PhotoLayer,
  PlotGrid,
  StatCard,
  TitleBar,
} from "./parts";
import { SAFE_BOTTOM, SIDE, WIDTH } from "./tokens";
import { useSafeBox } from "./layoutBox";

const strip = (t: string) => t.replace(/[“”"]/g, "").replace(/[。！？!?]+$/g, "").trim();

/** 涓枃鎸夊瓧鏁版敹鏁涘瓧鍙凤紝閬垮厤鏈€鍚庝竴琛屽彧鍓╀竴涓瓧 */
const fitTitle = (text: string, max: number, avail = WIDTH - SIDE * 2) => {
  const n = Math.max(4, strip(text).length);
  return Math.min(max, Math.floor(avail / (n * 0.94)));
};

/** 闀垮彞鍙湪閫楀彿/椤垮彿澶勬柇涓よ锛岄伩鍏嶆渶鍚庝竴琛屽彧鍓╀竴涓や釜锟?*/
const twoLine = (text: string) => {
  const t = strip(text);
  if (t.length <= 14) return t;
  const mid = Math.ceil(t.length / 2);
  let best = -1;
  for (let d = 0; d <= 6; d += 1) {
    for (const i of [mid - d, mid + d]) {
      if (i > 2 && i < t.length - 2 && /[，、；;。]/.test(t[i])) {
        best = i;
        break;
      }
    }
    if (best >= 0) break;
  }
  if (best < 0) return t;
  return `${t.slice(0, best + 1)}\n${t.slice(best + 1)}`;
};

const useSceneTiming = (scene: SceneData) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const cueAt = (i: number, fallbackLead = 12) => {
    const cues = scene.cues || [];
    if (cues.length === 0) return 12 + i * Math.round(fps * 1.1);
    const hit = cues[Math.min(i, cues.length - 1)];
    return Math.max(fallbackLead, Math.round(hit.at * fps) + 4);
  };
  const spread = (i: number, count: number) => {
    const usable = Math.min(Math.round(scene.durationInFrames * 0.4), 240);
    return 12 + Math.round((usable / Math.max(1, count)) * i);
  };
  return { frame, fps, cueAt, spread };
};

const Chips: React.FC<{ scene: SceneData; max?: number }> = ({ scene, max = 3 }) => {
  const { frame, spread } = useSceneTiming(scene);
  const items = scene.bullets.slice(0, max);
  if (!items.length) return null;
  return (
    <div
      style={{
        marginTop: 30,
        display: "flex",
        flexWrap: "wrap",
        gap: 14,
        justifyContent: "center",
        width: "100%",
      }}
    >
      {items.map((text, i) => (
        <Chip
          key={text}
          text={text}
          appear={fadeIn(frame, spread(i, items.length), 16)}
          highlight={i === 0}
        />
      ))}
    </div>
  );
};

const ghostProps = (scene: SceneData) => ({
  ghost: String(scene.index + 1).padStart(2, "0"),
  label: scene.barTitle || scene.tag || "",
});

export const HeroLayout: React.FC<{ scene: SceneData }> = ({ scene }) => {
  const { frame } = useSceneTiming(scene);
  const { palette } = useStyle();
  const items = (scene.bullets.length ? scene.bullets : scene.lines).slice(0, 3);
  return (
    <>
      <PhotoLayer
        src={scene.photo}
        variant="backdrop"
        duration={scene.durationInFrames}
        focus={scene.photoFocus}
        aspect={scene.photoAspect}
        dim={0.16}
      />
      <TitleBar kicker={scene.kicker} title={scene.title} overlay={Boolean(scene.photo)} />
      <Body scene={scene}>
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          {items.map((text, i) => {
            const appear = fadeIn(frame, 16 + i * 10, 16);
            return (
              <div
                key={text}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  marginTop: 8,
                  opacity: cue(appear, 0.55),
                  transform: `translateY(${(1 - appear) * 16}px)`,
                }}
              >
                <Marker active={i === 0} marginTop={14} />
                <div
                  style={{
                    fontSize: 31,
                    lineHeight: 1.5,
                    fontWeight: i === 0 ? 700 : 500,
                    color: palette.ink,
                    opacity: i === 0 ? 1 : 0.86,
                    textShadow: "0 2px 18px rgba(0,0,0,0.7)",
                  }}
                >
                  {text}
                </div>
              </div>
            );
          })}
        </div>
      </Body>
    </>
  );
};

export const BandLayout: React.FC<{ scene: SceneData }> = ({ scene }) => {
  const { frame, cueAt } = useSceneTiming(scene);
  const { palette } = useStyle();
  return (
    <>
      <PhotoLayer
        src={scene.photo}
        variant="backdrop"
        duration={scene.durationInFrames}
        focus={scene.photoFocus}
        aspect={scene.photoAspect}
        dim={0.42}
        {...ghostProps(scene)}
      />
      <TitleBar kicker={scene.kicker} title={scene.title} overlay={Boolean(scene.photo)} />
      <Body scene={scene}>
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          {scene.bullets.slice(0, 3).map((text, i) => {
            const appear = fadeIn(frame, cueAt(i, 26 + i * 8), 16);
            return (
              <div
                key={text}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  marginTop: 8,
                  opacity: cue(appear, 0.55),
                  transform: `translateY(${(1 - appear) * 12}px)`,
                }}
              >
                <Marker active={i === 0} marginTop={14} />
                <div
                  style={{
                    fontSize: 31,
                    lineHeight: 1.5,
                    fontWeight: i === 0 ? 700 : 500,
                    color: palette.ink,
                    opacity: i === 0 ? 1 : 0.86,
                    textShadow: "0 2px 18px rgba(0,0,0,0.7)",
                  }}
                >
                  {text}
                </div>
              </div>
            );
          })}
        </div>
      </Body>
    </>
  );
};

export const NumberLayout: React.FC<{ scene: SceneData }> = ({ scene }) => {
  const { frame, fps, cueAt } = useSceneTiming(scene);
  const { palette, look } = useStyle();
  const target = Number.parseFloat(String(scene.number || "0").replace(/[^\d.]/g, "")) || 0;
  const decimals = String(scene.number || "").includes(".") ? 1 : 0;
  const start = cueAt(0, 20);
  const value = countUp(frame, target, start, Math.round(fps * 1.6), decimals);
  const ring = interpolate(frame, [start, start + Math.round(fps * 1.9)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const caption = scene.title.length > 16 ? scene.bullets[0] || "" : "";

  return (
    <>
      {scene.photo ? (
        <PhotoLayer
          src={scene.photo}
          variant="backdrop"
          duration={scene.durationInFrames}
          focus={scene.photoFocus}
        aspect={scene.photoAspect}
          dim={0.5}
          {...ghostProps(scene)}
        />
      ) : (
        <PlotGrid duration={scene.durationInFrames} />
      )}
      <TitleBar kicker={scene.kicker} title={scene.title} overlay={Boolean(scene.photo)} />
      <Body scene={scene}>
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 10, fontVariantNumeric: "tabular-nums" }}>
            <div
              style={{
                fontFamily: look.displayFont,
                fontSize: 150,
                lineHeight: 1,
                fontWeight: look.titleWeight,
                color: palette.accent,
                letterSpacing: look.titleTracking - 2,
                textShadow: "0 4px 26px rgba(0,0,0,0.55)",
              }}
            >
              {scene.number && /[^\d.]/.test(scene.number) ? scene.number : value}
            </div>
            {scene.unit ? (
              <div style={{ fontFamily: look.displayFont, fontSize: 50, fontWeight: 700, color: palette.ink, textShadow: "0 3px 20px rgba(0,0,0,0.55)" }}>
                {scene.unit}
              </div>
            ) : null}
          </div>
          <div
            style={{
              marginTop: 14,
              width: "100%",
              height: 5,
              borderRadius: look.radius > 0 ? 3 : 0,
              background: palette.line,
              overflow: "hidden",
            }}
          >
            <div style={{ width: `${ring * 100}%`, height: "100%", background: palette.accent }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 18 }}>
            {(caption ? [caption, ...scene.bullets.slice(1)] : scene.bullets).slice(0, 3).map((text, i) => {
              const appear = fadeIn(frame, cueAt(i + 1, 40), 18);
              return (
                <div
                  key={text}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    marginTop: 8,
                    opacity: cue(appear, 0.55),
                    transform: `translateY(${(1 - appear) * 12}px)`,
                  }}
                >
                  <Marker active={i === 0} marginTop={14} />
                  <div
                    style={{
                      fontSize: 31,
                      lineHeight: 1.5,
                      fontWeight: i === 0 ? 700 : 500,
                      color: palette.ink,
                      opacity: i === 0 ? 1 : 0.86,
                      textShadow: "0 2px 18px rgba(0,0,0,0.7)",
                    }}
                  >
                    {text}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Body>
    </>
  );
};

const parsePercents = (scene: SceneData) => {
  const rows: { label: string; value: number; text: string }[] = [];
  for (const line of scene.lines) {
    for (const clause of line.split(/[，、；;。]/)) {
      const m = clause.match(/(\d+(?:\.\d+)?)\s*%/);
      if (!m) continue;
      const value = Number.parseFloat(m[1]);
      const label = strip(clause.replace(m[0], "")).slice(0, 10) || scene.title;
      rows.push({ label, value, text: `${m[1]}%` });
    }
  }
  return rows.sort((a, b) => b.value - a.value).slice(0, 4);
};

export const BarsLayout: React.FC<{ scene: SceneData }> = ({ scene }) => {
  const { frame, spread } = useSceneTiming(scene);
  const rows = parsePercents(scene);
  if (rows.length < 2) {
    return <BandLayout scene={scene} />;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <>
      <PhotoLayer
        src={scene.photo}
        variant="backdrop"
        duration={scene.durationInFrames}
        focus={scene.photoFocus}
        aspect={scene.photoAspect}
        dim={0.42}
        {...ghostProps(scene)}
      />
      <TitleBar kicker={scene.kicker} title={scene.title} overlay={Boolean(scene.photo)} />
      <Body scene={scene}>
        <div style={{ marginTop: 0, width: 560 }}>
          {rows.map((row, i) => (
            <BarRow
              key={`${row.label}-${i}`}
              rank={String(i + 1).padStart(2, "0")}
              label={row.label}
              value={row.text}
              ratio={row.value / max}
              appear={fadeIn(frame, spread(i, rows.length), 16)}
              highlight={i === 0}
            />
          ))}
        </div>
      </Body>
    </>
  );
};

export const CompareLayout: React.FC<{ scene: SceneData }> = ({ scene }) => {
  const { frame, spread } = useSceneTiming(scene);
  const { palette, look } = useStyle();
  const items = scene.bullets.slice(0, 2);
  const sides = items.length >= 2 ? items : [scene.title, scene.bullets[0] || scene.title];
  return (
    <>
      <PhotoLayer
        src={scene.photo}
        variant="backdrop"
        duration={scene.durationInFrames}
        focus={scene.photoFocus}
        aspect={scene.photoAspect}
        dim={0.42}
        {...ghostProps(scene)}
      />
      <TitleBar kicker={scene.kicker} title={scene.title} overlay={Boolean(scene.photo)} />
      <Body scene={scene}>
        <div style={{ display: "flex", gap: 14, marginTop: 0, flexDirection: "column" }}>
          {sides.map((text, i) => {
            const anim = i === 0 ? fadeSlideLeft(frame, spread(i, 2), 20) : fadeSlideRight(frame, spread(i, 2), 20);
            return (
              <div
                key={`${text}-${i}`}
                style={{
                  ...anim,
                  padding: "6px 0 6px 18px",
                  borderLeft: `2px solid ${i === 0 ? palette.line : `${palette.accent}99`}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    fontSize: 20,
                    letterSpacing: look.kickerTracking,
                    textTransform: look.kickerTransform,
                    color: i === 0 ? palette.inkFaint : palette.accent,
                    fontWeight: 700,
                  }}
                >
                  {i === 0 ? "A" : "B"}
                </div>
                <div style={{ fontSize: 31, lineHeight: 1.5, color: palette.ink, fontWeight: 600, opacity: i === 0 ? 0.86 : 1 }}>
                  {text}
                </div>
              </div>
            );
          })}
        </div>
      </Body>
    </>
  );
};

export const ListLayout: React.FC<{ scene: SceneData }> = ({ scene }) => {
  const { frame, cueAt } = useSceneTiming(scene);
  const { palette } = useStyle();
  const items = (scene.bullets.length ? scene.bullets : scene.lines).slice(0, 3);
  return (
    <>
      {scene.photo ? (
        <PhotoLayer
          src={scene.photo}
          variant="backdrop"
          duration={scene.durationInFrames}
          focus={scene.photoFocus}
        aspect={scene.photoAspect}
          dim={0.6}
          {...ghostProps(scene)}
        />
      ) : (
        <PlotGrid duration={scene.durationInFrames} />
      )}
      <TitleBar kicker={scene.kicker} title={scene.title} overlay={Boolean(scene.photo)} />
      <Body scene={scene}>
        <div style={{ width: "100%", display: "flex", flexDirection: "column" }}>
          {items.map((text, i) => {
            const appear = fadeIn(frame, cueAt(i, 24 + i * 6), 16);
            return (
              <div
                key={`${text}-${i}`}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  marginTop: 8,
                  opacity: cue(appear, 0.55),
                  transform: `translateY(${(1 - appear) * 14}px)`,
                }}
              >
                <Marker active={i === 0} marginTop={14} />
                <div
                  style={{
                    fontSize: 31,
                    lineHeight: 1.5,
                    fontWeight: i === 0 ? 700 : 500,
                    color: palette.ink,
                    opacity: i === 0 ? 1 : 0.86,
                    textShadow: "0 2px 18px rgba(0,0,0,0.7)",
                  }}
                >
                  {text}
                </div>
              </div>
            );
          })}
        </div>
      </Body>
    </>
  );
};

export const AbstractLayout: React.FC<{ scene: SceneData }> = ({ scene }) => {
  const { frame, cueAt } = useSceneTiming(scene);
  const { palette } = useStyle();
  return (
    <>
      {scene.photo ? (
        <PhotoLayer
          src={scene.photo}
          variant="backdrop"
          duration={scene.durationInFrames}
          focus={scene.photoFocus}
        aspect={scene.photoAspect}
          dim={0.5}
          {...ghostProps(scene)}
        />
      ) : (
        <PlotGrid duration={scene.durationInFrames} />
      )}
      <TitleBar kicker={scene.kicker} title={scene.title} overlay={Boolean(scene.photo)} />
      <Body scene={scene}>
        <div
          style={{
            marginTop: 0,
            display: "flex",
            flexDirection: "column",
            width: "100%",
          }}
        >
          {scene.bullets.slice(0, 3).map((text, i) => {
            const appear = fadeIn(frame, cueAt(i, 26 + i * 10), 18);
            return (
              <div
                key={text}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  marginTop: 8,
                  opacity: cue(appear, 0.55),
                  transform: `translateY(${(1 - appear) * 14}px)`,
                }}
              >
                <Marker active={i === 0} marginTop={14} />
                <div
                  style={{
                    fontSize: 31,
                    lineHeight: 1.5,
                    fontWeight: i === 0 ? 700 : 500,
                    color: palette.ink,
                    opacity: i === 0 ? 1 : 0.86,
                    textShadow: "0 2px 18px rgba(0,0,0,0.7)",
                  }}
                >
                  {text}
                </div>
              </div>
            );
          })}
        </div>
      </Body>
    </>
  );
};

export const ClosingLayout: React.FC<{ scene: SceneData }> = ({ scene }) => {
  const { frame, cueAt } = useSceneTiming(scene);
  const { palette, look } = useStyle();
  const ctaStyle: React.CSSProperties = {
    borderRadius: 0,
    background: "transparent",
    color: palette.accent,
    borderBottom: `3px solid ${palette.accent}66`,
  };
  const cta = strip(scene.lines[scene.lines.length - 1] || "");
  const credits = (scene as SceneData & { credits?: string }).credits || "";
  return (
    <>
      <PhotoLayer
        src={scene.photo}
        variant="backdrop"
        duration={scene.durationInFrames}
        focus={scene.photoFocus}
        aspect={scene.photoAspect}
        dim={0.42}
      />
      <TitleBar kicker={scene.kicker} title={scene.title} overlay={Boolean(scene.photo)} />
      <Body scene={scene}>
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          {scene.bullets.slice(0, 3).map((text, i) => {
            const appear = fadeIn(frame, cueAt(i) + 10, 16);
            return (
              <div
                key={text}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  marginTop: 8,
                  opacity: cue(appear, 0.55),
                  transform: `translateY(${(1 - appear) * 14}px)`,
                }}
              >
                <Marker active={i === 0} marginTop={14} />
                <div
                  style={{
                    fontSize: 31,
                    lineHeight: 1.5,
                    fontWeight: i === 0 ? 700 : 500,
                    color: palette.ink,
                    opacity: i === 0 ? 1 : 0.86,
                    textShadow: "0 2px 18px rgba(0,0,0,0.7)",
                  }}
                >
                  {text}
                </div>
              </div>
            );
          })}
          {cta ? (
            <div
              style={{
                ...fadeSlideUp(frame, 46, 20, 20),
                ...ctaStyle,
                marginTop: 28,
                padding: look.cta === "underline" ? "10px 6px 14px" : look.cta === "block" ? "20px 34px" : "16px 30px",
                fontFamily: look.displayFont,
                fontSize: 26,
                lineHeight: 1.35,
                fontWeight: look.cta === "underline" ? look.titleWeight : 700,
                letterSpacing: look.kickerTracking,
                textTransform: look.kickerTransform,
                textAlign: "center",
                alignSelf: "flex-start",
                maxWidth: 520,
              }}
            >
              {cta}
            </div>
          ) : null}
        </div>
      </Body>
      <Credit text={credits} appear={fadeIn(frame, 60, 20)} />
    </>
  );
};

const MATERIAL_STYLE_DEFAULTS = {
  full: { photoScale: 1, photoX: 50, photoY: 42, contentX: 0, contentY: 75, contentAlign: "left" as const },
  top: { photoScale: 1, photoX: 50, photoY: 42, contentX: 0, contentY: 0, contentAlign: "left" as const },
  left: { photoScale: 1, photoX: 50, photoY: 42, contentX: 0, contentY: 0, contentAlign: "left" as const },
};

const numOr = (value: number | undefined, fallback: number, min: number, max: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

export const MaterialLayout: React.FC<{ scene: SceneData }> = ({ scene }) => {
  const { frame, cueAt } = useSceneTiming(scene);
  const { palette } = useStyle();
  const box = useSafeBox();
  const layout = useLayout();
  const { height: canvasH } = useVideoConfig();
  const items = scene.bullets.slice(0, 3);
  const style = scene.layoutStyle || {};
  const preset = style.preset === "top" || style.preset === "left" ? style.preset : "full";
  const defaults = MATERIAL_STYLE_DEFAULTS[preset];
  const photoScale = numOr(style.photoScale, defaults.photoScale, 1, 1.8);
  const photoX = numOr(style.photoX, defaults.photoX, 0, 100);
  const photoY = numOr(style.photoY, defaults.photoY, 0, 100);
  const contentX = numOr(style.contentX, defaults.contentX, 0, 100);
  const contentY = numOr(style.contentY, defaults.contentY, 0, 100);
  const contentAlign = style.contentAlign || defaults.contentAlign;
  const photoBox =
    preset === "top"
      ? { left: 0, top: 500, width: WIDTH, height: 440 }
      : preset === "left"
        ? { left: 0, top: 500, width: 560, height: 860 }
        : { left: 0, top: 0, width: WIDTH, height: canvasH };
  const contentBottomInset = Math.max(SAFE_BOTTOM, box.bottom);
  const contentMinTop = preset === "full" ? 600 : preset === "top" ? 980 : 660;
  const contentMaxTop = Math.max(contentMinTop, canvasH - contentBottomInset - 200);
  const contentTop = contentMinTop + (contentY / 100) * (contentMaxTop - contentMinTop);
  const baseLeft = preset === "left" ? 620 : box.left;
  const baseWidth = preset === "left" ? WIDTH - box.right - 620 : WIDTH - box.left - box.right;
  const shift = Math.round((contentX / 100) * Math.min(180, baseWidth * 0.22));
  const contentLeft = baseLeft + shift;
  const contentWidth = Math.max(240, baseWidth - shift);
  const justify = contentAlign === "center" ? "center" : contentAlign === "right" ? "flex-end" : "flex-start";
  const enter = fadeIn(frame, 4, 18);
  const photoIn = fadeIn(frame, 8, 22);

  return (
    <AbsoluteFill style={{ opacity: enter }}>
      <div style={{ ...photoBox, position: "absolute", overflow: "hidden", background: palette.bgSoft }}>
        {scene.photo ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `url(${staticFile(scene.photo)})`,
              backgroundSize: "cover",
              backgroundPosition: `${photoX}% ${photoY}%`,
              transform: `scale(${photoScale})`,
              transformOrigin: `${photoX}% ${photoY}%`,
              filter: "brightness(1.06) saturate(1.04)",
              opacity: photoIn,
            }}
          />
        ) : null}
      </div>
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${palette.bg}E6 0%, ${palette.bg}A8 22%, ${palette.bg}33 38%, ${palette.bg}00 52%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${palette.bg}00 0%, ${palette.bg}00 38%, ${palette.bg}33 52%, ${palette.bg}AA 68%, ${palette.bg}E6 84%, ${palette.bg}F2 100%)`,
        }}
      />
      <TitleBar kicker={scene.kicker} title={scene.title} overlay={Boolean(scene.photo)} />
      <div
        style={{
          position: "absolute",
          left: contentLeft,
          top: contentTop,
          width: contentWidth,
          display: "flex",
          flexDirection: "column",
          alignItems: justify,
          gap: 14,
          textAlign: contentAlign,
        }}
      >
        <div style={{ ...bodyWrapStyle(layout.body), display: "flex", flexDirection: "column", alignItems: justify, gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: palette.accent,
              boxShadow: `0 0 12px ${palette.accent}66`,
            }}
          />
          <div style={{ fontSize: 22, letterSpacing: 5, color: palette.accent, fontWeight: 600 }}>
            {scene.kicker || scene.barTitle || ""}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
          {items.map((text, i) => {
            const appear = fadeIn(frame, cueAt(i, 26 + i * 8), 16);
            return (
              <div
                key={text}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  justifyContent: contentAlign === "center" ? "center" : contentAlign === "right" ? "flex-end" : "flex-start",
                  opacity: cue(appear, 0.5),
                  transform: `translateY(${(1 - appear) * 10}px)`,
                }}
              >
                <Marker active={i === 0} marginTop={17} />
                <div
                  style={{
                    fontSize: preset === "left" ? 27 : 31,
                    lineHeight: 1.5,
                    fontWeight: i === 0 ? 700 : 500,
                    color: palette.ink,
                    opacity: i === 0 ? 1 : 0.86,
                    textShadow: "0 2px 18px rgba(0,0,0,0.7)",
                  }}
                >
                  {text}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const SCENE_RENDERERS: Record<string, React.FC<{ scene: SceneData }>> = {
  hero: HeroLayout,
  band: BandLayout,
  number: NumberLayout,
  bars: BarsLayout,
  compare: CompareLayout,
  list: ListLayout,
  abstract: AbstractLayout,
  closing: ClosingLayout,
};

