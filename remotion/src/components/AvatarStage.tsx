import { useVideoConfig } from "remotion";
import { useLayout } from "./LayoutContext";
import { useStyle } from "./StyleContext";
import { computeSafeBox } from "../narrated/layoutBox";

export const AvatarStage = () => {
  const { palette } = useStyle();
  const { width, height } = useVideoConfig();
  const layout = useLayout();

  if (layout.mode === "none" || layout.avatar?.src) return null;

  const { rect } = computeSafeBox(layout, width, height);

  return (
    <div
      style={{
        position: "absolute",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        borderRadius: layout.avatar.shape === "circle" ? "50%" : 24,
        background: palette.bgSoft,
        border: `1.5px dashed ${palette.line}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 8,
        color: palette.inkDim,
      }}
    >
      <div style={{ fontSize: 24, letterSpacing: 4, fontWeight: 700 }}>
        {layout.mode === "video" ? "数字人预留区" : "头像预留区"}
      </div>
      <div style={{ fontSize: 18, color: palette.inkFaint }}>
        {Math.round(rect.width)} × {Math.round(rect.height)}
      </div>
    </div>
  );
};
