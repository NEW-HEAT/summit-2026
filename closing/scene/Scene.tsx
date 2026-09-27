import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import DeckGL, {type DeckGLRef} from '@deck.gl/react';
import {
  _GlobeView as GlobeView,
  _GlobeViewport as GlobeViewport,
  MapView,
  FirstPersonView
} from '@deck.gl/core';
import {getGoogleTilesAccess} from './config';
import {biometricAt} from './biometrics';
import {buildLayers} from './layers';
import {meshHeightAt, bridgeSurfaceRevision} from './surface';
import {resolveBridgeRenderCamera} from './camera';
import {footRegisteredTrip} from './trail';
import {coverGeometry, footfallPulse, gaitMask} from './gait';
import {DuskSky} from './DuskSky';
import {heatPresentation} from './globalHeat';
import type {BiometricSample, SceneConfig, TimelineState} from './types';

class ClosingGlobeView extends GlobeView {
  static override displayName = 'ClosingGlobeView';
  override getViewportType(): typeof GlobeViewport {
    return GlobeViewport;
  }
}

declare global {
  interface Window {
    __NEWHEAT_GOOGLE_TILES_KEY__?: string;

  }
}

export function ClosingScene({
  config,
  biometrics,
  state,
  debug,
  onFrameRendered,
  onDiagnostics
}: {
  config: SceneConfig;
  biometrics: BiometricSample[];
  state: TimelineState;
  debug: boolean;
  onFrameRendered: (frame: number) => void;
  onDiagnostics: (diagnostics: Record<string, unknown>) => void;
}) {
  const deckRef = useRef<DeckGLRef | null>(null);
  const drawStatus = useRef({frame: -1, count: 0, assetsReady: false});
  const trailDrawStatus = useRef({frame: -1, count: 0, assetsReady: false});
  const maskReady = useRef(false);
  const skyReady = useRef(false);
  useEffect(() => {
    const target = window as unknown as Record<string, unknown>;
    target.__NEWHEAT_DRAW_STATUS__ = () => ({
      frame: drawStatus.current.frame === trailDrawStatus.current.frame ? drawStatus.current.frame : -1,
      count: drawStatus.current.count + trailDrawStatus.current.count,
      assetsReady: drawStatus.current.assetsReady && trailDrawStatus.current.assetsReady && maskReady.current && skyReady.current,
      surfaces: 2,
      personMaskReady: maskReady.current,
      skyReady: skyReady.current
    });
    return () => { delete target.__NEWHEAT_DRAW_STATUS__; };
  }, []);
  const [viewportSize, setViewportSize] = useState(() => ({width: window.innerWidth, height: window.innerHeight}));
  const [heatInput,setHeatInput]=useState(()=>window.__NEWHEAT_HEAT_INPUT__);
  useEffect(()=>{
    const ready=()=>setHeatInput(window.__NEWHEAT_HEAT_INPUT__);
    window.addEventListener('newheat-heat-ready',ready);ready();
    return ()=>window.removeEventListener('newheat-heat-ready',ready);
  },[]);
  useEffect(() => {
    const onResize = () => setViewportSize({width: window.innerWidth, height: window.innerHeight});
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const physicalCamera = useMemo(() => resolveBridgeRenderCamera(state.camera, state.heroProgress, viewportSize.width, viewportSize.height), [state.camera, state.heroProgress, viewportSize]);
  const [calibration, setCalibration] = useState<{
    zoom?: number; pitch?: number; bearing?: number; altitude?: number; fovy?: number;
    firstPerson?: boolean; selectAerial?: boolean; northMeters?: number;
  } | null>(null);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('calibrate') !== '1') return;
    const target = window as unknown as Record<string, unknown>;
    target.__NEWHEAT_CALIBRATE__ = setCalibration;
    target.__NEWHEAT_SAMPLE_SURFACE__ = async (x: number, y: number) => {
      const hit = await deckRef.current?.pickObjectAsync({x, y, unproject3D: true});
      return {picked: Boolean(hit?.picked), altitudeMeters: hit?.coordinate?.[2] ?? null,
        meshAltitudeMeters: hit?.coordinate ? meshHeightAt(hit.object?.content, hit.coordinate) : null,
        tileOriginAltitude: hit?.object?.content?.cartographicOrigin?.[2] ?? null,
        contentKeys: Object.keys(hit?.object?.content ?? {}),
        gltfKeys: Object.keys(hit?.object?.content?.gltf ?? {}),
        nodes: hit?.object?.content?.gltf?.nodes?.map((node: Record<string, unknown>) => Object.keys(node)),
        meshes: hit?.object?.content?.gltf?.meshes?.map((mesh: {primitives: Array<Record<string, unknown>>}) => mesh.primitives.map(primitive => ({keys: Object.keys(primitive), attributes: Object.keys(primitive.attributes ?? {})})))
      };
    };
    return () => {
      delete target.__NEWHEAT_CALIBRATE__;
      delete target.__NEWHEAT_SAMPLE_SURFACE__;
    };
  }, []);
  const [tileState, setTileState] = useState<'disabled' | 'loading' | 'ready' | 'failed'>('disabled');
  const [mapCredits, setMapCredits] = useState('');
  const [tileDetail, setTileDetail] = useState<string | null>(null);
  const [deckRenderedFrame, setDeckRenderedFrame] = useState(-1);
  const [surfaceRevision, setSurfaceRevision] = useState(0);
  const [videoReadyFrame, setVideoReadyFrame] = useState(-1);
  const [skyReadyFrame, setSkyReadyFrame] = useState(-1);
  skyReady.current = skyReadyFrame === state.frame;
  const mask = gaitMask(config, state);
  const [decodedMaskUrl, setDecodedMaskUrl] = useState<string | null>(null);
  maskReady.current = !mask || decodedMaskUrl === mask.url;
  useEffect(() => {
    let cancelled = false;
    if (!mask) { setDecodedMaskUrl(null); return; }
    const image = new Image();
    image.src = mask.url;
    image.decode().then(() => { if (!cancelled) setDecodedMaskUrl(image.src.replace(location.origin, '')); })
      .catch(() => { if (!cancelled) setDecodedMaskUrl(null); });
    return () => { cancelled = true; };
  }, [mask?.url]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tileAccess = useMemo(() => getGoogleTilesAccess(config), [config]);
  const renderedConfig = useMemo(
    () => tileAccess ? config : {
      ...config,
      route: config.route.map(([longitude, latitude]) => [longitude, latitude, 0] as [number, number, number]),
      runner: {...config.runner, groundAltitudeMeters: 0}
    },
    [config, tileAccess]
  );
  const biometric = useMemo(
    () => biometricAt(biometrics, state.heroProgress),
    [biometrics, state.heroProgress]
  );

  useEffect(() => {
    if (!tileAccess) {
      setTileState('disabled');
      setTileDetail(null);
    } else {
      setTileState('loading');
      setTileDetail(null);
    }
    // Reloading composition config may create a new access object with the
    // same root. The existing tileset does not fire onTilesetLoad again.
  }, [tileAccess?.rootUrl]);

  useEffect(() => {
    let cancelled = false;
    const video = videoRef.current;
    if (!video || state.videoOpacity <= 0.001) {
      setVideoReadyFrame(state.frame);
      return;
    }
    const markReady = () => {
      if (!cancelled) setVideoReadyFrame(state.frame);
    };
    const seek = () => {
      video.pause();
      const target = Math.min(
        Math.max(0, state.videoTimeSeconds),
        Math.max(0, (video.duration || config.captureReference.durationSeconds) - 1 / 60)
      );
      if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 1 / 180) {
        markReady();
        return;
      }
      video.addEventListener('seeked', markReady, {once: true});
      video.currentTime = target;
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, {once: true});
    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', seek);
      video.removeEventListener('seeked', markReady);
    };
  }, [config.captureReference.durationSeconds, state.frame, state.videoOpacity, state.videoTimeSeconds]);

  useEffect(() => {
    if (deckRenderedFrame === state.frame && videoReadyFrame === state.frame && maskReady.current && skyReadyFrame === state.frame) {
      onFrameRendered(state.frame);
    }
  }, [deckRenderedFrame, onFrameRendered, state.frame, videoReadyFrame, decodedMaskUrl, skyReadyFrame]);

  const onTileState = useCallback(
    (next: 'loading' | 'ready' | 'failed', detail?: string) => {
      setTileState(next);
      setTileDetail(detail ?? null);
    },
    []
  );

  const layers = useMemo(() => {
    return buildLayers({
      scene: renderedConfig,
      state,
      tileUrl: tileAccess?.rootUrl ?? null,
      tileApiKey: tileAccess?.apiKey ?? null,
      biometric,
      onTileState,
      onTileCredits: setMapCredits,
      viewportSize,
      heatInput,
      selectionCamera: calibration?.selectAerial ? {
        longitude: state.camera.longitude, latitude: state.camera.latitude,
        zoom: 18.35, pitch: 85, bearing: calibration.bearing ?? 180
      } : !calibration && state.camera.zoom > 16 ? {
        // Preserve the airborne camera's wider footprint until it reaches the
        // detail camera. Selecting a street-sized footprint too early leaves
        // fully-loaded but empty foreground during the approach and departure.
        ...state.camera, zoom: Math.min(18.35, state.camera.zoom), pitch: Math.min(85, state.camera.pitch)
      } : undefined
    });
  }, [biometric, calibration, onTileState, renderedConfig, state, tileAccess, viewportSize, surfaceRevision, heatInput]);

  const diagnostics = useMemo(
    () => ({
      frame: state.frame,
      globalHeatRouteCount: heatInput?.evidence.drawableRoutes ?? 0,
      globalHeatCoverage: heatInput?.evidence.routeCoverage ?? 'UNVERIFIED',
      globalHeatVisible: heatPresentation(state.timeSeconds).opacity>0 && state.sceneOpacity>0,
      phase: state.phase,
      cameraZoom: state.camera.zoom,
      cameraPitch: state.camera.pitch,
      cameraBearing: state.camera.bearing,
      physicalCameraMode: state.phase === 'video-focus' ? 'eye-on-bridge-centerline-with-mesh-datum' : 'mo-gl-continuous-grounding-camera',
      physicalCameraEyeHeightMeters: state.phase === 'video-focus' ? Number(physicalCamera.eyeHeightAboveBridgeMeters.toFixed(4)) : null,
      physicalCameraStandoffMeters: state.phase === 'video-focus' ? Number(physicalCamera.eyeStandoffMeters.toFixed(4)) : null,
      lensFieldOfViewDegrees: physicalCamera.fovy,
      tileSelectionCamera: state.camera.zoom > 16 ? 'independent-bridge-and-horizon-detail' : 'render-camera',
      projection: state.projectionBlend >= 0.5 ? 'local-mercator' : 'globe',
      projectionBlend: state.projectionBlend,
      provider: tileAccess ? 'google-photorealistic-3d-tiles' : 'offline-staging-globe',
      tileState,
      tileDetail,
      cameraRole: state.phase === 'video-focus' ? 'jack-south-facing-bridge-fpv-track' : 'mo-gl-compensated-target-lock-camera',
      outboundOrbit: state.phase === 'fly-out' || state.phase === 'black-out' ? 'immediate-from-first-outbound-frame' : 'not-applicable',
      trailSurface: tileAccess ? 'google-3d-tiles-road-mesh-vertex-drape' : 'authored-route-altitude',
      trailOpacity: state.trailOpacity,
      trailLengthSeconds: state.trailLengthSeconds,
      trailAnchor: 'video-foot-contact-guide-projected-to-bridge-deck',
      trailOcclusionPolicy: 'road-annotation-draw-priority-over-overlapping-tile-surfaces',
      trailWidthMeters: config.trail.widthMeters,
      trailLeadingCap: 'rounded-with-clamped-endpoint-timestamp',
      footfallSource: config.captureReference.gait ? 'local-video-pose-contact-estimates' : 'authored-contact-guide',
      footfallCount: config.captureReference.gait?.events.length ?? 0,
      footfallPulseOpacity: footfallPulse(config, state)?.opacity ?? null,
      footTrailLifetime: 'world-fixed-deposits-leave-through-camera-displacement',
      skyPresentation: 'source-video-cloud-crop-canvas-fades-to-black-in-space',
      skyOpacity: state.skyOpacity,
      skyReady: skyReady.current,
      rollingVideoTransitions: true,
      personMaskFrame: mask?.frame ?? null,
      personMaskReady: maskReady.current,
      flightParticipants: 'stylized-runner-and-cyclist-proxies-not-reconstruction',
      routeProgress: state.routeProgress,
      captureReference: config.captureReference.id,
      captureReferenceRole: config.captureReference.role,
      videoIntegrated: state.videoOpacity > 0,
      videoPresentation: 'full-frame-opaque-video-with-ground-registered-trip-overlay',
      presentationChrome: 'none',
      visibleBackground: state.videoOpacity === 1 ? 'opaque-source-video' : state.skyOpacity > 0 ? 'photorealistic-tiles-with-source-dusk-sky' : 'photorealistic-tiles-only',
      videoOpacity: state.videoOpacity,
      videoTimeSeconds: state.videoTimeSeconds,
      videoReadyFrame,
      deckRenderedFrame,
      participantActivities: config.captureReference.participants.map(item => item.activity),
      blackBackfaceMitigation: 'front-and-back-tile-rendering-plus-black-clear-color-plus-expanded-camera-depth-range'
    }),
    [physicalCamera, config, state, tileAccess, tileDetail, tileState, videoReadyFrame, deckRenderedFrame, decodedMaskUrl, skyReadyFrame, heatInput]
  );

  useEffect(() => onDiagnostics(diagnostics), [diagnostics, onDiagnostics]);

  useEffect(() => {
    if (new URLSearchParams(location.search).get('calibrate') !== '1') return;
    const target = window as unknown as Record<string, unknown>;
    target.__NEWHEAT_TRAIL_PROBE__ = () => {
      const viewport = deckRef.current?.deck?.getViewports()[0];
      const trip = footRegisteredTrip(renderedConfig, state, viewportSize.width, viewportSize.height);
      const layer = layers.find(layer => layer.id === 'future-trip-trail');
      return {headPixel: viewport?.project(trip.path.at(-1)!),
        headAltitude: trip.path.at(-1)![2],
        actualEyeAltitude: viewport?.unprojectPosition(viewport.cameraPosition)[2],
        authoredEyeAltitude: physicalCamera.viewState.position[2],
        actualZoom: viewport?.zoom,
        actualPitch: (viewport as any)?.pitch,
        actualBearing: (viewport as any)?.bearing,
        actualFovy: (viewport as any)?.fovy,
        viewportSize: viewport ? [viewport.width, viewport.height] : null,
        timestamps: [trip.timestamps[0], trip.timestamps.at(-1)],
        clock: state.trailTimeSeconds, pointCount: trip.path.length,
        layerLoaded: layer?.isLoaded, drawMode: layer?.state.terrainDrawMode ?? null};
    };
    return () => { delete target.__NEWHEAT_TRAIL_PROBE__; };
  }, [layers, physicalCamera, renderedConfig, state, viewportSize]);

  const localProjection = state.projectionBlend >= 0.5;
  const baseLayers = layers.filter(layer => layer.id !== 'future-trip-trail');
  const trailLayers = layers.filter(layer => layer.id === 'future-trip-trail');
  const renderedViewState = localProjection
    ? calibration ? {...state.camera,
        ...(calibration?.zoom !== undefined ? {zoom: calibration.zoom} : {}),
        ...(calibration?.pitch !== undefined ? {pitch: calibration.pitch} : {}),
        ...(calibration?.bearing !== undefined ? {bearing: calibration.bearing} : {}),
        latitude: state.camera.latitude + (calibration?.northMeters ?? 0) / 110540,
        position: [0, 0, calibration?.altitude ?? 0]} : physicalCamera.viewState
    : state.camera;
  const createViews = () => [localProjection
    ? calibration?.firstPerson
      ? new FirstPersonView({id: 'closing-globe', fovy: calibration.fovy ?? 50, near: 0.05, far: 30000})
      : new MapView({id: 'closing-globe', fovy: calibration ? 36.86989764584402 : physicalCamera.fovy, nearZMultiplier: 0.001, farZMultiplier: 12})
    : new ClosingGlobeView({id: 'closing-globe', resolution: 2.45})];
  // The matte buffer has its own aspect ratio, but normalized coordinates map
  // to the source video. Size it to the video's cover rectangle, not the PNG AR.
  const cover = config.captureReference.gait ? coverGeometry(config.captureReference.gait, viewportSize.width, viewportSize.height) : viewportSize;
  return (
    <main className="closing-stage" data-phase={state.phase} data-frame={state.frame}>
      <DuskSky source={config.captureReference.mediaPath} frame={state.frame}
        opacity={state.skyOpacity} bearing={state.camera.bearing}
        width={viewportSize.width} height={viewportSize.height} onDrawn={setSkyReadyFrame} />
      <div
        className="render-viewport"
        style={{
          opacity: state.sceneOpacity,
          transform: `scale(${state.viewportScale})`,
          filter: `brightness(${1 - 0.28 * state.skyOpacity}) saturate(${1 - 0.1 * state.skyOpacity})`
        }}
      >
        <DeckGL
          ref={deckRef}
          views={createViews()}
          viewState={{'closing-globe': renderedViewState} as never}
          layers={baseLayers}
          controller={false}
          useDevicePixels={1.45}
          parameters={{clearColor: [0, 0, 0, 0]} as never}
          onAfterRender={() => {
            drawStatus.current = {frame: state.frame, count: drawStatus.current.count + 1, assetsReady: baseLayers.every(layer => layer.isLoaded)};
            setDeckRenderedFrame(state.frame);
            setSurfaceRevision(bridgeSurfaceRevision());
          }}
        />
      </div>
      <WorldVideoPlate
        config={config}
        state={state}
        videoRef={videoRef}
      />
      <div className="trail-viewport" style={{opacity: state.sceneOpacity, transform: `scale(${state.viewportScale})`,
        maskImage: mask ? `url("${mask.url}"), linear-gradient(to right, transparent, black 6%, black 94%, transparent)`
          : 'linear-gradient(to right, transparent, black 6%, black 94%, transparent)',
        maskMode: mask ? 'luminance, alpha' : 'alpha', maskComposite: 'intersect',
        maskSize: mask ? `${cover.width}px ${cover.height}px, 100% 100%` : '100% 100%',
        maskPosition: 'center', maskRepeat: 'no-repeat'}}>
        <DeckGL
          id="closing-trail-overlay"
          views={createViews()}
          viewState={{'closing-globe': renderedViewState} as never}
          layers={trailLayers}
          controller={false}
          useDevicePixels={1.45}
          parameters={{clearColor: [0, 0, 0, 0]} as never}
          onAfterRender={() => {
            trailDrawStatus.current = {frame: state.frame, count: trailDrawStatus.current.count + 1, assetsReady: trailLayers.every(layer => layer.isLoaded)};
          }}
        />
      </div>
      {tileAccess && state.sceneOpacity > 0 && state.videoOpacity < 1 ? (
        <aside aria-label="Map attribution" style={{position: 'absolute', zIndex: 100,
          bottom: 10, right: 10, maxWidth: '80%', color: '#fff', background: 'rgba(0,0,0,.72)',
          padding: '5px 8px', font: '12px Arial, sans-serif', pointerEvents: 'none'}}>
          <strong>Google Maps</strong>{mapCredits ? ` · ${mapCredits}` : ''}
        </aside>
      ) : null}
      {debug ? <DebugHud state={state} biometric={biometric} diagnostics={diagnostics} /> : null}
    </main>
  );
}

function WorldVideoPlate({
  config,
  state,
  videoRef
}: {
  config: SceneConfig;
  state: TimelineState;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
}) {
  return (
    <section
      className="world-video-plate"
      data-video-integrated={state.videoOpacity > 0.001}
      style={{
        opacity: state.videoOpacity,
        transform: `scale(${state.videoScale})`
      }}
    >
      <video
        ref={videoRef}
        className="world-video-plate__media"
        src={config.captureReference.mediaPath}
        muted
        playsInline
        preload="auto"
      />
    </section>
  );
}

function DebugHud({state, biometric, diagnostics}: {
  state: TimelineState;
  biometric: BiometricSample;
  diagnostics: Record<string, unknown>;
}) {
  return (
    <aside className="debug-hud">
      <div>{state.frame.toString().padStart(4, '0')} · {state.timeSeconds.toFixed(3)}s</div>
      <div>{state.phase}</div>
      <div>{biometric.heartRateBpm.toFixed(0)} bpm · {biometric.powerWatts.toFixed(0)} W</div>
      <div>{String(diagnostics.provider)} · {String(diagnostics.tileState)}</div>
      <div>video {state.videoTimeSeconds.toFixed(3)}s · {String(diagnostics.videoReadyFrame)}</div>
    </aside>
  );
}
