# 001 — Fade the G1 hologram in when its GLB is ready

- **Status**: DONE
- **Commit**: 87b2f3e
- **Severity**: LOW
- **Category**: Missed opportunities — preventing a jarring change
- **Estimated scope**: 2 files, about 15 lines changed

## Problem

The Body Status page is a crisp, information-dense monitoring surface. Its static G1 exterior is added to the Three.js scene as soon as `GLTFLoader` finishes, so the first visible model frame appears immediately. At the same time the loading status switches to its hidden `is-ready` state with no transition. This produces a small but visible handoff from empty canvas to model on the occasional first visit to the page.

```tsx
// apps/operator-console/src/components/G1Hologram.tsx:134-140 — current
scene.add(model);
const extent = Math.max(size.x, size.y, size.z);
camera.position.set(extent * 0.72, extent * 0.24, extent * 1.45);
controls.target.set(0, size.y * 0.04, 0);
controls.update();
setPhase("ready");
resize();
```

```tsx
// apps/operator-console/src/components/G1Hologram.tsx:168-176 — current
<section className={`g1-hologram is-${streamState}`} aria-label="Unitree G1 静态外观全息投影">
  <header>...</header>
  <div className="g1-hologram-stage">
    <canvas ref={canvasRef} />
    <div className="g1-hologram-plinth" aria-hidden="true" />
    <p className={`g1-hologram-status is-${phase}`} aria-live="polite">{status}</p>
  </div>
</section>
```

```css
/* apps/operator-console/src/styles.css:3090-3119 — current */
.g1-hologram canvas { position: absolute; inset: 0; z-index: 1; display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; }
.g1-hologram-status { /* current positioning and typography declarations */ }
.g1-hologram-status.is-ready { opacity: 0; }
```

This is deliberately a one-time load handoff, not a continuous hologram effect: active telemetry labels and the model pose must remain visually stable for reading and inspection.

## Target

Add a model-phase class to the existing root section. Keep the canvas at opacity `0` until `phase === "ready"`; when the GLB has already been placed in the Three.js scene, transition canvas opacity to `1` over exactly `180ms` using `var(--ease-out)` (`cubic-bezier(0.23, 1, 0.32, 1)`). Use the same `180ms` opacity transition for the loading-status handoff.

```tsx
// target — apps/operator-console/src/components/G1Hologram.tsx
<section
  className={`g1-hologram is-${streamState} is-model-${phase}`}
  aria-label="Unitree G1 静态外观全息投影"
>
```

```css
/* target — apps/operator-console/src/styles.css */
.g1-hologram canvas {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
  opacity: 0;
  transition: opacity 180ms var(--ease-out);
}
.g1-hologram.is-model-ready canvas { opacity: 1; }

.g1-hologram-status {
  /* retain all current declarations */
  transition: opacity 180ms var(--ease-out);
}

@media (prefers-reduced-motion: reduce) {
  .g1-hologram canvas,
  .g1-hologram-status { transition-duration: 120ms; }
}
```

The only animated property is `opacity`. Do not introduce `requestAnimationFrame`, keyframes, positional movement, scale, rotation, filter blur, or continuous idle animation. The existing OrbitControls drag behavior remains unchanged.

## Repo conventions to follow

- This is React 18 with Three.js; it has no runtime motion library in this component. Use CSS transitions rather than adding a dependency or a render loop.
- The shared motion token is defined in `apps/operator-console/src/styles.css:2380`:

  ```css
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --duration-press: 160ms;
  ```

- The existing Body Status entrance uses the same token in `apps/operator-console/src/styles.css:3131`:

  ```css
  .g1-monitor-entrance { animation: g1-status-enter 180ms var(--ease-out) both; }
  ```

- Reduced motion is handled in the Body Status media query at `apps/operator-console/src/styles.css:3170`. Extend that existing block; do not create a second, competing reduced-motion rule.

## Steps

1. In `apps/operator-console/src/components/G1Hologram.tsx`, change only the root `<section>` class at current line 168 to append `is-model-${phase}`. Do not alter loader timing, camera setup, material opacity (`0.86`), controls, model rotation, or the static-pose disclosure.
2. In `apps/operator-console/src/styles.css`, extend the existing `.g1-hologram canvas` rule at current line 3091 with exactly `opacity: 0;` and `transition: opacity 180ms var(--ease-out);`. Add `.g1-hologram.is-model-ready canvas { opacity: 1; }` directly after it.
3. In the existing `.g1-hologram-status` rule at current lines 3105-3116, append exactly `transition: opacity 180ms var(--ease-out);`. Keep `.g1-hologram-status.is-ready { opacity: 0; }` unchanged, so the status remains available on hover after load.
4. In the existing `@media (prefers-reduced-motion: reduce)` block at current line 3170, add the exact target rule from this plan. It shortens the non-spatial handoff to `120ms`; it must not disable it entirely.
5. Do not change `apps/operator-console/src/components/G1Hologram.test.tsx` unless the existing test no longer passes. JSDOM deliberately falls into the non-WebGL branch, so it cannot prove a real GLB handoff. Verify the ready class and visual transition in a real Chromium session instead.

## Boundaries

- Do NOT modify files outside `apps/operator-console/src/components/G1Hologram.tsx` and `apps/operator-console/src/styles.css`.
- Do NOT add dependencies, timers, animation libraries, RAF loops, or keyframes.
- Do NOT animate live BMS values, surrounding labels, orbital guides, model rotation, model pose, or camera framing.
- Do NOT change DDS/bridge semantics or imply that the static GLB is live joint-pose playback.
- If the code has drifted from commit `87b2f3e`, stop and report the mismatch rather than applying this plan to a different component structure.

## Verification

- **Mechanical**:

  ```bash
  npm --prefix apps/operator-console test -- G1Hologram.test.tsx G1MonitorView.test.tsx
  npm --prefix apps/operator-console run build
  git diff --check
  ```

  All tests and the TypeScript/Vite build must pass.

- **Browser check**:

  1. Start the existing Vite development server and open Body Status.
  2. In browser DevTools, disable cache and reload. Confirm the G1 mesh is invisible while “正在载入官方 G1 几何” is present, then fades in once over `180ms`; it must not jump, scale, or rotate on its own.
  3. Hover the loaded model: “拖拽查看机身” still appears and fades in/out normally. Dragging still rotates the model 1:1 and stops immediately on release.
  4. Use DevTools Animations at 10% playback speed. Confirm only an opacity transition occurs for the canvas/status and that it completes in the expected relative duration; there must be no looping timeline after it settles.
  5. Emulate `prefers-reduced-motion: reduce` in DevTools Rendering and reload. Confirm the same opacity-only handoff remains but completes in `120ms`, with no position, scale, or rotation change.

- **Done when**: On a cold GLB load, the model enters as one short calm fade; on subsequent data refreshes and model drags, nothing decorative animates.
