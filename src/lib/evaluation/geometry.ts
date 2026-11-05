/**
 * Deterministic 2D geometry. No AI, no randomness.
 */
import type { Box, Point } from "./types";

/**
 * Centroid of a binary mask raster that covers `box` (source pixels).
 * The raster may have a different resolution than the box; each raster cell
 * centre is mapped linearly onto the box.
 * Returns null for an empty mask.
 */
export function maskCentroid(
  raster: ArrayLike<number>,
  width: number,
  height: number,
  box: Box,
): { centroid: Point; area: number } | null {
  if (raster.length !== width * height) {
    throw new Error(`Mask raster length ${raster.length} != ${width}x${height}`);
  }
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (raster[row + x]) {
        sx += x + 0.5;
        sy += y + 0.5;
        n++;
      }
    }
  }
  if (n === 0) return null;
  const scaleX = (box.right - box.left) / width;
  const scaleY = (box.bottom - box.top) / height;
  return {
    centroid: { x: box.left + (sx / n) * scaleX, y: box.top + (sy / n) * scaleY },
    area: n * scaleX * scaleY,
  };
}

/**
 * Even–odd ray casting point-in-polygon. Points exactly on an edge count as
 * inside (closed polygon), which keeps rectangle zones intuitive.
 */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  // Boundary check first.
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (pointOnSegment(p, polygon[j], polygon[i])) return true;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointOnSegment(p: Point, a: Point, b: Point, eps = 1e-9): boolean {
  const cross = (p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y);
  if (Math.abs(cross) > eps * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))) return false;
  return (
    p.x >= Math.min(a.x, b.x) - eps &&
    p.x <= Math.max(a.x, b.x) + eps &&
    p.y >= Math.min(a.y, b.y) - eps &&
    p.y <= Math.max(a.y, b.y) + eps
  );
}

export function polygonArea(polygon: Point[]): number {
  let s = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    s += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
  }
  return Math.abs(s) / 2;
}

/** Does the polygon self-intersect? (simple O(n²) check, n is tiny) */
export function isSelfIntersecting(polygon: Point[]): boolean {
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a1 = polygon[i];
    const a2 = polygon[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      const b1 = polygon[j];
      const b2 = polygon[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function orient(a: Point, b: Point, c: Point) {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const o1 = orient(p1, p2, q1);
  const o2 = orient(p1, p2, q2);
  const o3 = orient(q1, q2, p1);
  const o4 = orient(q1, q2, p2);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

export function rectToPolygon(a: Point, b: Point): Point[] {
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

/**
 * Where the video content actually sits inside a display element when it is
 * rendered with `object-fit: contain` (letterboxing / pillarboxing).
 */
export interface ContentRect {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  scale: number;
}

export function containRect(
  elementWidth: number,
  elementHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): ContentRect {
  const scale = Math.min(elementWidth / sourceWidth, elementHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    offsetX: (elementWidth - width) / 2,
    offsetY: (elementHeight - height) / 2,
    width,
    height,
    scale,
  };
}

/** Display (element-local CSS px) → source-video pixels, clamped to the frame. */
export function displayToSource(
  p: Point,
  elementWidth: number,
  elementHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): Point {
  const r = containRect(elementWidth, elementHeight, sourceWidth, sourceHeight);
  const x = (p.x - r.offsetX) / r.scale;
  const y = (p.y - r.offsetY) / r.scale;
  return {
    x: Math.min(sourceWidth, Math.max(0, x)),
    y: Math.min(sourceHeight, Math.max(0, y)),
  };
}

/** Source-video pixels → display (element-local CSS px). */
export function sourceToDisplay(
  p: Point,
  elementWidth: number,
  elementHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): Point {
  const r = containRect(elementWidth, elementHeight, sourceWidth, sourceHeight);
  return { x: r.offsetX + p.x * r.scale, y: r.offsetY + p.y * r.scale };
}
