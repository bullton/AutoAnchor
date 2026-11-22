import React, { createContext, useContext } from "react";

export interface SceneMotion {
  id?: string;
  name?: string;
  enter?: string;
  exit?: string;
  photo?: string;
  title?: string;
  body?: string;
  accent?: string;
  intensity?: number;
  pace?: string;
  source?: string;
  prompt?: string;
}

const MotionContext = createContext<SceneMotion | null>(null);

export const MotionProvider: React.FC<{ motion?: SceneMotion | null; children: React.ReactNode }> = ({
  motion,
  children,
}) => <MotionContext.Provider value={motion || null}>{children}</MotionContext.Provider>;

export const useSceneMotion = () => useContext(MotionContext);

export const motionIntensity = (motion?: SceneMotion | null): number => {
  const n = Number(motion?.intensity);
  return Number.isFinite(n) ? Math.min(1.5, Math.max(0.5, n)) : 1;
};

/** 节奏系数：fast 更短，calm 更长 */
export const motionSpeed = (motion?: SceneMotion | null): number => {
  if (motion?.pace === "fast") return 0.78;
  if (motion?.pace === "calm") return 1.24;
  return 1;
};
