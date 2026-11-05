import type { Observation, Point, TargetZone } from "@/lib/evaluation/types";
import { rectToPolygon } from "@/lib/evaluation/geometry";

/** Target zone used across tests: x∈[600,860], y∈[300,480]. */
export const TRAY: TargetZone = { shape: "rect", points: rectToPolygon({ x: 600, y: 300 }, { x: 860, y: 480 }) };

export function obs(frameIndex: number, c: Point, objectId = "0", extra: Partial<Observation> = {}): Observation {
  return {
    frameIndex,
    objectId,
    box: { left: c.x - 35, top: c.y - 35, right: c.x + 35, bottom: c.y + 35 },
    centroid: c,
    centroidSource: "mask",
    maskArea: 4900,
    confidence: 0.9,
    ...extra,
  };
}

/** Linear path from a to b over frames [0, n). */
export function path(n: number, a: Point, b: Point, objectId = "0"): Observation[] {
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 1 : i / (n - 1);
    return obs(i, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, objectId);
  });
}
