"use client";

/**
 * Draw a target zone (rectangle or polygon) over a video frame.
 * All stored coordinates are SOURCE-VIDEO PIXELS: pointer positions are
 * converted with `displayToSource`, which accounts for object-fit: contain
 * scaling and letterboxing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { displayToSource, isSelfIntersecting, rectToPolygon, sourceToDisplay } from "@/lib/evaluation/geometry";
import type { Point, TargetZone } from "@/lib/evaluation/types";

interface Props {
  videoUrl: string;
  zone: TargetZone | null;
  onChange: (zone: TargetZone | null) => void;
  onVideoInfo?: (info: { width: number; height: number; duration: number }) => void;
}

export function ZoneEditor({ videoUrl, zone, onChange, onVideoInfo }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<"rect" | "polygon">("rect");
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [src, setSrc] = useState<{ w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<{ a: Point; b: Point } | null>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [hover, setHover] = useState<Point | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);

  const readMeta = useCallback(
    (v: HTMLVideoElement) => {
      setSrc({ w: v.videoWidth, h: v.videoHeight });
      setDuration(v.duration);
      onVideoInfo?.({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    },
    [onVideoInfo],
  );

  // Metadata may load before hydration attaches onLoadedMetadata.
  useEffect(() => {
    const v = videoRef.current;
    if (v && v.readyState >= 1) queueMicrotask(() => readMeta(v));
  }, [readMeta]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const toSource = useCallback(
    (e: React.PointerEvent | React.MouseEvent): Point | null => {
      const el = wrapRef.current;
      if (!el || !src) return null;
      const r = el.getBoundingClientRect();
      const p = displayToSource({ x: e.clientX - r.left, y: e.clientY - r.top }, r.width, r.height, src.w, src.h);
      return { x: Math.round(p.x), y: Math.round(p.y) };
    },
    [src],
  );

  const toDisplay = (p: Point) => (src ? sourceToDisplay(p, size.w, size.h, src.w, src.h) : p);

  function onPointerDown(e: React.PointerEvent) {
    const p = toSource(e);
    if (!p) return;
    if (tool === "rect") {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setDrag({ a: p, b: p });
    } else {
      if (draft.length >= 3) {
        const first = toDisplay(draft[0]);
        const cur = toDisplay(p);
        if (Math.hypot(first.x - cur.x, first.y - cur.y) < 14) {
          finishPolygon();
          return;
        }
      }
      setDraft((d) => [...d, p]);
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const p = toSource(e);
    setHover(p);
    if (drag && p) setDrag({ a: drag.a, b: p });
  }
  function onPointerUp() {
    if (!drag) return;
    const w = Math.abs(drag.a.x - drag.b.x);
    const h = Math.abs(drag.a.y - drag.b.y);
    if (w > 6 && h > 6) onChange({ shape: "rect", points: rectToPolygon(drag.a, drag.b) });
    setDrag(null);
  }
  function finishPolygon() {
    if (draft.length >= 3 && !isSelfIntersecting(draft)) {
      onChange({ shape: "polygon", points: draft });
      setDraft([]);
    }
  }

  const shown: Point[] | null = drag
    ? rectToPolygon(drag.a, drag.b)
    : draft.length
      ? draft
      : zone?.points ?? null;
  const shownD = shown?.map(toDisplay);
  const drafting = draft.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="inline-flex rounded-md border border-line bg-panel p-0.5">
          {(["rect", "polygon"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTool(t);
                setDraft([]);
              }}
              className={`rounded px-3 py-1 ${tool === t ? "bg-panel-2 text-fg" : "text-muted hover:text-fg"}`}
            >
              {t === "rect" ? "Rectangle" : "Polygon"}
            </button>
          ))}
        </div>
        {tool === "polygon" && (
          <button
            type="button"
            onClick={finishPolygon}
            disabled={draft.length < 3}
            className="rounded-md border border-line px-3 py-1 text-muted enabled:hover:text-fg disabled:opacity-40"
          >
            Close polygon ({draft.length} pts)
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setDraft([]);
          }}
          className="rounded-md border border-line px-3 py-1 text-muted hover:text-fg"
        >
          Clear
        </button>
        <span className="ml-auto font-mono text-xs text-muted">
          {src ? `source ${src.w}×${src.h}px` : "loading video…"}
          {hover && src ? ` · cursor (${hover.x}, ${hover.y})` : ""}
        </span>
      </div>

      <div
        ref={wrapRef}
        className="relative aspect-video w-full touch-none select-none overflow-hidden rounded-lg border border-line bg-black"
        data-testid="zone-editor"
      >
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-contain"
          onLoadedMetadata={(e) => readMeta(e.currentTarget)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        <svg
          className="absolute inset-0 h-full w-full cursor-crosshair"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHover(null)}
          data-testid="zone-canvas"
        >
          {shownD && shownD.length > 0 && (
            <>
              <polygon
                points={shownD.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="rgba(167,139,250,0.18)"
                stroke="var(--zone)"
                strokeWidth={2}
                strokeDasharray={drafting || drag ? "6 4" : undefined}
              />
              {shownD.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={i === 0 && drafting ? 6 : 4} fill="var(--zone)" stroke="black" strokeWidth={1} />
              ))}
            </>
          )}
        </svg>
        {!shown && src && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-white/80">
            {tool === "rect" ? "Drag to draw the target zone" : "Click to add points · click the first point to close"}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.paused) void v.play();
            else v.pause();
          }}
          disabled={!src}
          data-testid="preview-play"
          aria-label={playing ? "Pause preview" : "Play preview"}
          className="shrink-0 rounded-md border border-line px-3 py-1 text-sm text-muted enabled:hover:text-fg disabled:opacity-40"
        >
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <span className="shrink-0 font-mono text-xs text-muted">frame</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={time}
          onChange={(e) => {
            const v = videoRef.current;
            if (!v) return;
            v.pause();
            v.currentTime = Number(e.target.value);
          }}
          className="w-full accent-[var(--zone)]"
          aria-label="Scrub video to choose a reference frame"
        />
        <span className="w-14 text-right font-mono text-xs text-muted">{time.toFixed(2)}s</span>
      </div>

      {zone && (
        <p className="font-mono text-xs text-muted" data-testid="zone-coords">
          zone ({zone.shape}, source px): {zone.points.map((p) => `(${p.x},${p.y})`).join(" ")}
        </p>
      )}
    </div>
  );
}
