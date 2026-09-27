import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {loadBiometrics, loadSceneConfig} from './config';
import {ClosingScene} from './Scene';
import {LAST_SOURCE_FRAME, resolveTimeline, SOURCE_FPS} from './timeline';
import type {BiometricSample, SceneConfig} from './types';
import './styles.css';

declare global {
  interface Window {
    __NEWHEAT_SET_FRAME__?: (frame: number) => void;
    __NEWHEAT_RELOAD_CONFIG__?: () => Promise<void>;
    __NEWHEAT_CLOSING__?: {
      ready: boolean;
      frame: number;
      renderedFrame: number;
      diagnostics: Record<string, unknown>;
    };
  }
}

function App() {
  const [config, setConfig] = useState<SceneConfig | null>(null);
  const [biometrics, setBiometrics] = useState<BiometricSample[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(() => readInitialFrame());
  const [renderedFrame, setRenderedFrame] = useState(-1);
  const [playing, setPlaying] = useState(() => !hasExplicitFrame() && readParam('autoplay') !== '0');
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown>>({});
  const startTime = useRef<number | null>(null);
  const startFrame = useRef(frame);
  const debug = readParam('debug') === '1';

  useEffect(() => {
    let cancelled = false;
    loadSceneConfig()
      .then(async loadedConfig => {
        const loadedBiometrics = await loadBiometrics(loadedConfig.biometricsUrl);
        if (!cancelled) {
          setConfig(loadedConfig);
          setBiometrics(loadedBiometrics);
        }
      })
      .catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.__NEWHEAT_RELOAD_CONFIG__ = async () => {
      const next = await loadSceneConfig();
      const samples = await loadBiometrics(next.biometricsUrl);
      setConfig(next);
      setBiometrics(samples);
    };
    window.__NEWHEAT_SET_FRAME__ = next => {
      setPlaying(false);
      setFrame(clampFrame(next));
    };
    return () => {
      delete window.__NEWHEAT_SET_FRAME__;
      delete window.__NEWHEAT_RELOAD_CONFIG__;
    };
  }, []);

  useEffect(() => {
    if (!playing) {
      startTime.current = null;
      return;
    }
    let request = 0;
    const tick = (now: number) => {
      if (startTime.current === null) {
        startTime.current = now;
        startFrame.current = frame;
      }
      const elapsedFrames = Math.floor(((now - startTime.current) / 1000) * SOURCE_FPS);
      const next = Math.min(LAST_SOURCE_FRAME, startFrame.current + elapsedFrames);
      setFrame(next);
      if (next < LAST_SOURCE_FRAME) request = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        event.preventDefault();
        setPlaying(value => !value);
      } else if (event.key === 'ArrowRight') {
        setPlaying(false);
        setFrame(value => clampFrame(value + (event.shiftKey ? 60 : 1)));
      } else if (event.key === 'ArrowLeft') {
        setPlaying(false);
        setFrame(value => clampFrame(value - (event.shiftKey ? 60 : 1)));
      } else if (event.key.toLowerCase() === 'r') {
        setPlaying(false);
        setFrame(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const state = useMemo(
    () => (config ? resolveTimeline(frame, config) : null),
    [config, frame]
  );
  const onFrameRendered = useCallback((value: number) => setRenderedFrame(value), []);
  const onDiagnostics = useCallback((value: Record<string, unknown>) => setDiagnostics(value), []);

  useEffect(() => {
    window.__NEWHEAT_CLOSING__ = {
      ready: Boolean(config && biometrics && state && renderedFrame === state.frame),
      frame,
      renderedFrame,
      diagnostics
    };
  }, [biometrics, config, diagnostics, frame, renderedFrame, state]);

  if (error) return <div className="fatal-error">Closing scene blocked: {error}</div>;
  if (!config || !biometrics || !state) return <div className="loading-stage" />;

  return (
    <>
      <ClosingScene
        config={config}
        biometrics={biometrics}
        state={state}
        debug={debug}
        onFrameRendered={onFrameRendered}
        onDiagnostics={onDiagnostics}
      />
      {debug ? (
        <div className="scrubber">
          <button onClick={() => setPlaying(value => !value)}>{playing ? 'pause' : 'play'}</button>
          <input
            aria-label="source frame"
            type="range"
            min={0}
            max={LAST_SOURCE_FRAME}
            value={frame}
            onChange={event => {
              setPlaying(false);
              setFrame(Number(event.target.value));
            }}
          />
        </div>
      ) : null}
    </>
  );
}

function readInitialFrame(): number {
  const raw = readParam('frame');
  return raw === null ? 0 : clampFrame(Number(raw));
}

function hasExplicitFrame(): boolean {
  return readParam('frame') !== null;
}

function readParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}

function clampFrame(value: number): number {
  return Math.max(0, Math.min(LAST_SOURCE_FRAME, Number.isFinite(value) ? Math.round(value) : 0));
}

// The deterministic renderer owns one WebGL device; do not double-mount it in development.
createRoot(document.getElementById('root')!).render(<App />);
