"use client";

/**
 * Video player with Meta SAM 3.1 evidence overlays:
 *  - target zone polygon
 *  - decoded SAM mask (SVG path from @meta-sam/parser) + bounding box
 *  - centroid movement trail (inside = green, outside = red)
 *  - per-frame timeline (observed inside / outside / not observed / decisive)
 * Everything is drawn in source-pixel space and mapped onto the displayed
 * (letterboxed) video.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { containRect } from "@/lib/evaluation/geometry";
import type { EvaluationResult, Observation, TargetZone, VideoInfo } from "@/lib/evaluation/types";

interface Props {
  videoUrl: string;
  videoInfo: VideoInfo;
  zone: TargetZone;
  observations: Observation[];
  result: EvaluationResult | null;
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

export function EvidencePlayer({ videoUrl, videoInfo, zone, observations, result }: Props) {
  const videoRef = useRef<VideoWithRvfc>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(0);
  const [layers, setLayers] = useState({ mask: true, box: true, trail: true, zone: true });
  const fps = videoInfo.fps || 30;
  const total = videoInfo.frameCount;

  const trackedId = result?.trackedObjectId ?? null;
  const byFrame = useMemo(() => {
    const m = new Map<number, Observation[]>();
    for (const o of observations) {
      const arr = m.get(o.frameIndex) ?? [];
      arr.push(o);
      m.set(o.frameIndex, arr);
    }
    return m;
  }, [observations]);
  const insideByFrame = useMemo(() => new Map(result?.frames.map((f) => [f.frameIndex, f.inside]) ?? []), [result]);
  const decisive = useMemo(() => new Set(result?.decisiveFrames ?? []), [result]);
  const maskCache = useRef(new WeakMap<Observation, Path2D | null>());
  const masks = useCallback((o: Observation) => {
    const cache = maskCache.current;
    let p = cache.get(o);
    if (p === undefined) {
      p = o.maskSvgPath && typeof Path2D !== "undefined" ? new Path2D(o.maskSvgPath) : null;
      cache.set(o, p);
    }
    return p;
  }, []);

  const draw = useCallback(
    (f: number) => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const dpr = window.devicePixelRatio || 1;
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const r = containRect(W, H, videoInfo.width, videoInfo.height);
      // source px → canvas px
      const base = new DOMMatrix([r.scale * dpr, 0, 0, r.scale * dpr, r.offsetX * dpr, r.offsetY * dpr]);
      ctx.setTransform(base);
      const px = 1 / r.scale; // 1 display px in source units

      if (layers.zone) {
        ctx.beginPath();
        zone.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = "rgba(167,139,250,0.14)";
        ctx.fill();
        ctx.setLineDash([8 * px, 5 * px]);
        ctx.lineWidth = 2 * px;
        ctx.strokeStyle = "#a78bfa";
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (layers.trail && result) {
        const pts = result.frames.filter((fr) => fr.frameIndex <= f);
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          if (b.frameIndex - a.frameIndex > Math.max(3, fps / 2)) continue; // don't bridge gaps
          ctx.beginPath();
          ctx.moveTo(a.centroid.x, a.centroid.y);
          ctx.lineTo(b.centroid.x, b.centroid.y);
          ctx.strokeStyle = b.inside ? "rgba(34,197,94,0.9)" : "rgba(244,63,94,0.9)";
          ctx.lineWidth = 2.5 * px;
          ctx.stroke();
        }
        for (const d of pts.filter((p) => decisive.has(p.frameIndex))) {
          ctx.beginPath();
          ctx.arc(d.centroid.x, d.centroid.y, 4 * px, 0, Math.PI * 2);
          ctx.fillStyle = d.inside ? "#22c55e" : "#f43f5e";
          ctx.fill();
        }
      }

      const current = byFrame.get(f) ?? [];
      for (const o of current) {
        const tracked = trackedId === null || o.objectId === trackedId;
        const color = tracked ? "56,189,248" : "245,158,11";
        const bw = o.box.right - o.box.left;
        const bh = o.box.bottom - o.box.top;
        if (layers.mask) {
          const path = masks(o);
          if (path && o.maskRaster) {
            ctx.save();
            ctx.transform(bw / o.maskRaster.width, 0, 0, bh / o.maskRaster.height, o.box.left, o.box.top);
            ctx.fillStyle = `rgba(${color},0.45)`;
            ctx.fill(path, "evenodd");
            ctx.restore();
          }
        }
        if (layers.box) {
          ctx.lineWidth = 1.5 * px;
          ctx.strokeStyle = `rgba(${color},1)`;
          ctx.strokeRect(o.box.left, o.box.top, bw, bh);
          ctx.font = `${12 * px}px ui-monospace, monospace`;
          const label = `id ${o.objectId}${o.confidence !== undefined ? ` · ${o.confidence.toFixed(2)}` : ""}`;
          const tw = ctx.measureText(label).width + 8 * px;
          ctx.fillStyle = `rgba(${color},1)`;
          ctx.fillRect(o.box.left, o.box.top - 16 * px, tw, 16 * px);
          ctx.fillStyle = "#000";
          ctx.fillText(label, o.box.left + 4 * px, o.box.top - 4 * px);
        }
        // centroid crosshair
        ctx.beginPath();
        ctx.arc(o.centroid.x, o.centroid.y, 5 * px, 0, Math.PI * 2);
        const inside = insideByFrame.get(f);
        ctx.fillStyle = inside === undefined ? "#fff" : inside ? "#22c55e" : "#f43f5e";
        ctx.fill();
        ctx.lineWidth = 1.5 * px;
        ctx.strokeStyle = "#000";
        ctx.stroke();
      }
    },
    [byFrame, decisive, fps, insideByFrame, layers, masks, result, trackedId, videoInfo.height, videoInfo.width, zone.points],
  );

  // Frame-accurate updates via requestVideoFrameCallback when available.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let handle = 0;
    let raf = 0;
    const toFrame = (t: number) => Math.min(total - 1, Math.max(0, Math.floor(t * fps + 1e-3)));
    if (v.requestVideoFrameCallback) {
      const cb = (_n: number, meta: { mediaTime: number }) => {
        setFrame(toFrame(meta.mediaTime));
        handle = v.requestVideoFrameCallback!(cb);
      };
      handle = v.requestVideoFrameCallback(cb);
    } else {
      const loop = () => {
        setFrame(toFrame(v.currentTime));
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    const onSeek = () => setFrame(toFrame(v.currentTime));
    v.addEventListener("seeked", onSeek);
    return () => {
      if (handle && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(handle);
      if (raf) cancelAnimationFrame(raf);
      v.removeEventListener("seeked", onSeek);
    };
  }, [fps, total]);

  useEffect(() => {
    draw(frame);
  }, [draw, frame]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => draw(frame));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw, frame]);

  const seekFrame = (f: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = (f + 0.5) / fps;
    setFrame(f);
  };

  const current = byFrame.get(frame) ?? [];
  const tracked = current.find((o) => trackedId === null || o.objectId === trackedId);
  const insideNow = insideByFrame.get(frame);

  return (
    <div className="space-y-3">
      <div ref={wrapRef} className="relative aspect-video w-full overflow-hidden rounded-lg border border-line bg-black" data-testid="evidence-player">
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          controls
          preload="auto"
          className="absolute inset-0 h-full w-full object-contain"
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" data-testid="overlay-canvas" />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-panel px-3 py-1.5 font-mono text-[11px]" data-testid="frame-readout">
        <span>
          frame <span className="text-fg">{frame}</span>/{total - 1}
        </span>
        {tracked ? (
          <>
            <span className="text-muted">id {tracked.objectId}</span>
            <span className="text-muted">
              centroid ({tracked.centroid.x.toFixed(0)}, {tracked.centroid.y.toFixed(0)}) · {tracked.centroidSource}
            </span>
            <span style={{ color: insideNow ? "var(--pass)" : "var(--fail)" }}>{insideNow ? "inside zone" : "outside zone"}</span>
          </>
        ) : (
          <span className="text-muted">object not observed in this frame</span>
        )}
      </div>

      <Timeline total={total} frame={frame} byFrame={byFrame} insideByFrame={insideByFrame} decisive={decisive} onSeek={seekFrame} />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {(Object.keys(layers) as (keyof typeof layers)[]).map((k) => (
          <label key={k} className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-line px-2 py-1 text-muted">
            <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} className="accent-[var(--sam)]" />
            {k === "mask" ? "SAM mask" : k === "box" ? "Bounding box" : k === "trail" ? "Movement trail" : "Target zone"}
          </label>
        ))}
        <span className="ml-auto flex flex-wrap items-center gap-3 text-muted">
          <Legend color="var(--sam)" label="SAM 3.1 mask" />
          <Legend color="var(--zone)" label="Target zone" />
          <Legend color="var(--pass)" label="Inside" />
          <Legend color="var(--fail)" label="Outside" />
        </span>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function Timeline({
  total,
  frame,
  byFrame,
  insideByFrame,
  decisive,
  onSeek,
}: {
  total: number;
  frame: number;
  byFrame: Map<number, Observation[]>;
  insideByFrame: Map<number, boolean>;
  decisive: Set<number>;
  onSeek: (f: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cells = useMemo(() => {
    return Array.from({ length: total }, (_, i) => {
      const inside = insideByFrame.get(i);
      const seen = byFrame.has(i);
      return inside === true ? "var(--pass)" : inside === false ? "var(--fail)" : seen ? "var(--inc)" : "#1f2933";
    });
  }, [total, byFrame, insideByFrame]);
  const gradient = useMemo(() => {
    const stops: string[] = [];
    cells.forEach((c, i) => {
      stops.push(`${c} ${(i / total) * 100}%`, `${c} ${((i + 1) / total) * 100}%`);
    });
    return `linear-gradient(to right, ${stops.join(",")})`;
  }, [cells, total]);

  return (
    <div className="space-y-1">
      <div
        ref={ref}
        role="slider"
        aria-label="Per-frame tracking timeline"
        aria-valuemin={0}
        aria-valuemax={total - 1}
        aria-valuenow={frame}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onSeek(Math.min(total - 1, frame + 1));
          if (e.key === "ArrowLeft") onSeek(Math.max(0, frame - 1));
        }}
        onClick={(e) => {
          const r = ref.current!.getBoundingClientRect();
          onSeek(Math.min(total - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * total))));
        }}
        className="relative h-6 cursor-pointer overflow-hidden rounded border border-line"
        style={{ background: gradient }}
        data-testid="timeline"
      >
        {[...decisive].map((f) => (
          <span key={f} className="absolute top-0 h-full w-[2px] bg-white" style={{ left: `${((f + 0.5) / total) * 100}%` }} title={`decisive frame ${f}`} />
        ))}
        <span className="absolute top-0 h-full w-[2px] bg-accent shadow-[0_0_6px_var(--accent)]" style={{ left: `${((frame + 0.5) / total) * 100}%` }} />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-muted">
        <span>frame 0</span>
        <span>green = centroid inside · red = outside · amber = other object · dark = not observed · white ticks = decisive frames</span>
        <span>{total - 1}</span>
      </div>
    </div>
  );
}
