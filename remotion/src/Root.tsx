import { Composition } from "remotion";
import { defaultLayout } from "./components/LayoutContext";
import { OralVideo } from "./OralVideo";
import { PortsDemo } from "./ported/PortsDemo";
import type { VideoProps } from "./types";

export const RemotionRoot = () => (
  <>
    <Composition
      id="OralVideo"
      component={OralVideo}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={
        {
          slides: [],
          scenes: [],
          layout: defaultLayout,
          style: { id: "amber", motion: "standard" },
        } as VideoProps
      }
      calculateMetadata={({ props }) => {
        const scenes = (props as VideoProps).scenes ?? [];
        const total = scenes.length
          ? scenes.reduce((sum, scene) => sum + (scene.durationInFrames ?? 90), 0)
          : (props as VideoProps).slides.reduce(
              (sum, slide) => sum + (slide.durationInFrames ?? 90),
              0,
            );
        return { durationInFrames: Math.max(total, 30) };
      }}
    />
    <Composition
      id="PortsDemo"
      component={PortsDemo}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={450}
    />
  </>
);
