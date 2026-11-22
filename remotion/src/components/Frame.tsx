import type { ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { useLayout } from "./LayoutContext";

export const Frame = ({
  children,
  align = "flex-start",
  textAlign = "left",
}: {
  children: ReactNode;
  align?: "flex-start" | "center";
  textAlign?: "left" | "center";
}) => {
  const layout = useLayout();

  if (layout.layout === "full") {
    return (
      <AbsoluteFill
        style={{
          padding: "150px 96px 340px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: align,
          textAlign,
        }}
      >
        {children}
      </AbsoluteFill>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: layout.contentHeight,
        padding: "110px 96px 110px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: align,
        textAlign,
      }}
    >
      {children}
    </div>
  );
};
