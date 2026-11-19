import { useEffect, useRef } from 'react';
import { CHARACTER_SIZE, bodyOf, colourOf, dotLevel, faceDots, showsFace, type CharacterColour, type CharacterState, type MatrixMode } from './dotPatterns';

/*
 * The dot matrix and agent characters (docs/design/instrument.md, "Personality"). Both draw on a canvas each frame
 * while they move, and draw one still frame when the system asks for reduced motion or `at` fixes the time.
 */

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Runs `draw(t)` every frame from mount, or once at `at` (or a still moment under reduced motion). */
function useFrames(canvas: React.RefObject<HTMLCanvasElement | null>, draw: (ctx: CanvasRenderingContext2D, t: number, el: HTMLCanvasElement) => void, at: number | undefined, deps: unknown[]) {
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const scale = window.devicePixelRatio || 1;
    const fit = () => {
      const w = Math.round(el.clientWidth * scale);
      const h = Math.round(el.clientHeight * scale);
      if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };
    if (at !== undefined || reduced()) {
      fit();
      draw(ctx, at ?? 1.2, el);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      fit();
      draw(ctx, (now - start) / 1000, el);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, ...deps]);
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number) {
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export interface DotMatrixProps {
  /** What the work is; each kind has its own movement. */
  mode: MatrixMode;
  /** 0 to 1: how far through its plan. When given, the bottom row fills with it. */
  progress?: number;
  cols?: number;
  rows?: number;
  /** A fixed moment in seconds, for pictures and tests. Leave it out to animate. */
  at?: number;
  className?: string;
}

/** Mobius's working matrix: 24 × 6 indigo dots that move with what Mobius is doing. */
export function DotMatrix({ mode, progress, cols = 24, rows = 6, at, className }: DotMatrixProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useFrames(ref, (ctx, t, el) => {
    const w = el.clientWidth;
    const h = el.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getComputedStyle(el).color;
    const step = Math.min(w / cols, h / rows);
    const r = step * 0.28;
    const body = progress === undefined ? rows : rows - 1;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const level = y < body ? dotLevel(mode, x, y, t, cols, body) : x < Math.round(progress! * cols) ? 0.9 : 0.14;
        dot(ctx, x * step + step / 2, y * step + step / 2, r, Math.max(0.06, level));
      }
    }
    ctx.globalAlpha = 1;
  }, at, [mode, progress, cols, rows]);
  return <canvas ref={ref} className={className ? `ui-dot-matrix ${className}` : 'ui-dot-matrix'} data-mode={mode} aria-hidden="true" style={{ aspectRatio: `${cols} / ${rows}` }} />;
}

export interface DotCharacterProps {
  /** The agent's name: its body shape and colour come from it, so they never change. */
  name: string;
  /** At rest it shows a face; while it works, its body becomes the matrix for that work. */
  state: CharacterState;
  /** One of the content colours; from the name when left out. */
  colour?: CharacterColour;
  size?: 'small' | 'medium' | 'large';
  at?: number;
  className?: string;
}

/**
 * An agent as a small dot character. Faces show only while it is still (idle, waiting for you, done, failed,
 * paused), so "busy" and "needs you" never look alike. Mobius itself never gets a face.
 */
export function DotCharacter({ name, state, colour, size = 'medium', at, className }: DotCharacterProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const body = bodyOf(name);
  const tone = colour ?? colourOf(name);
  useFrames(ref, (ctx, t, el) => {
    const w = el.clientWidth;
    const n = CHARACTER_SIZE;
    const step = w / n;
    // At row size the dots nearly touch, so the shape reads as one silhouette rather than a faint grid.
    const r = step * (size === 'small' ? 0.5 : 0.36);
    const styles = getComputedStyle(el);
    const fill = styles.color;
    const ink = styles.getPropertyValue('--ink').trim() || fill;
    const face = showsFace(state) ? new Set(faceDots(state, t).map(([x, y]) => `${x},${y}`)) : null;
    const lit = (state === 'idle' || state === 'paused' ? 0.55 : 0.75) + (size === 'small' ? 0.2 : 0);
    ctx.clearRect(0, 0, w, w);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const on = body[y]![x] === '1';
        if (face?.has(`${x},${y}`)) { ctx.fillStyle = ink; dot(ctx, x * step + step / 2, y * step + step / 2, r, 1); continue; }
        ctx.fillStyle = fill;
        const level = !on ? 0.06 : face ? lit : Math.max(0.28, dotLevel(state as MatrixMode, x, y, t, n, n));
        dot(ctx, x * step + step / 2, y * step + step / 2, r, level);
      }
    }
    ctx.globalAlpha = 1;
  }, at, [name, state, body, size]);
  return (
    <span className={className ? `ui-dot-character ${className}` : 'ui-dot-character'} data-size={size} data-state={state} style={{ '--character': `var(--c-${tone})` } as React.CSSProperties} aria-hidden="true">
      <canvas ref={ref} />
    </span>
  );
}
