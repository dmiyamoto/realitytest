import { describe, expect, it } from "vitest";
import {
  containRect,
  displayToSource,
  isSelfIntersecting,
  maskCentroid,
  pointInPolygon,
  rectToPolygon,
  sourceToDisplay,
} from "@/lib/evaluation/geometry";

describe("7. polygon & coordinate correctness", () => {
  const square = rectToPolygon({ x: 10, y: 10 }, { x: 20, y: 20 });

  it("point in rectangle / outside / on edge", () => {
    expect(pointInPolygon({ x: 15, y: 15 }, square)).toBe(true);
    expect(pointInPolygon({ x: 25, y: 15 }, square)).toBe(false);
    expect(pointInPolygon({ x: 10, y: 15 }, square)).toBe(true);
    expect(pointInPolygon({ x: 20, y: 20 }, square)).toBe(true);
  });

  it("concave polygon (L shape)", () => {
    const L = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 2, y: 8 }, L)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 2 }, L)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 8 }, L)).toBe(false);
  });

  it("degenerate polygon is never 'inside'", () => {
    expect(pointInPolygon({ x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 2, y: 2 }])).toBe(false);
  });

  it("detects self-intersecting polygons", () => {
    const bowtie = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(isSelfIntersecting(bowtie)).toBe(true);
    expect(isSelfIntersecting(square)).toBe(false);
  });

  it("letterboxing: 16:9 video in a square element (bars top/bottom)", () => {
    // 1920x1080 in 800x800 → scale 800/1920, content 800x450, offsetY 175
    const r = containRect(800, 800, 1920, 1080);
    expect(r.scale).toBeCloseTo(800 / 1920);
    expect(r.offsetX).toBeCloseTo(0);
    expect(r.offsetY).toBeCloseTo(175);
    expect(displayToSource({ x: 400, y: 400 }, 800, 800, 1920, 1080)).toEqual({ x: 960, y: 540 });
    expect(displayToSource({ x: 0, y: 175 }, 800, 800, 1920, 1080)).toEqual({ x: 0, y: 0 });
    // clicks in the black bar clamp to the frame edge
    expect(displayToSource({ x: 100, y: 10 }, 800, 800, 1920, 1080).y).toBe(0);
  });

  it("pillarboxing: portrait video in a wide element (bars left/right)", () => {
    // 720x1280 in 1000x500 → scale 500/1280, content width 281.25, offsetX 359.375
    const p = displayToSource({ x: 359.375 + 281.25, y: 500 }, 1000, 500, 720, 1280);
    expect(p.x).toBeCloseTo(720);
    expect(p.y).toBeCloseTo(1280);
  });

  it("source → display → source round-trips", () => {
    const s = { x: 123.4, y: 456.7 };
    const d = sourceToDisplay(s, 640, 480, 960, 540);
    const back = displayToSource(d, 640, 480, 960, 540);
    expect(back.x).toBeCloseTo(s.x);
    expect(back.y).toBeCloseTo(s.y);
  });

  it("mask centroid maps raster cells onto the source box", () => {
    // 4x2 raster, right half set, covering box [100,200)x[50,70)
    const raster = Uint8Array.from([0, 0, 1, 1, 0, 0, 1, 1]);
    const c = maskCentroid(raster, 4, 2, { left: 100, top: 50, right: 200, bottom: 70 })!;
    // raster cx = (2.5+3.5)/2 = 3 → 100 + 3 * 25 = 175 ; cy = 1 → 50 + 1*10 = 60
    expect(c.centroid.x).toBeCloseTo(175);
    expect(c.centroid.y).toBeCloseTo(60);
    expect(c.area).toBeCloseTo(4 * 25 * 10);
    expect(maskCentroid(new Uint8Array(8), 4, 2, { left: 0, top: 0, right: 4, bottom: 2 })).toBeNull();
  });
});
