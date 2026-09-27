import {useEffect, useRef, useState} from 'react';

/** A clean cloud-only crop of the actual sprint source, not invented scenery. */
export function DuskSky({source, frame, opacity, bearing, width, height, onDrawn}: {
  source: string; frame: number; opacity: number; bearing: number;
  width: number; height: number; onDrawn: (frame: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const element = document.createElement('video');
    video.current = element;
    element.muted = true; element.playsInline = true; element.preload = 'auto';
    // Source second 9 (trimmed second 4) has no bridge house in the sky crop.
    const seek = () => { element.currentTime = 4; };
    const done = () => { setReady(true); };
    element.addEventListener('loadedmetadata', seek);
    element.addEventListener('seeked', done);
    element.src = source; element.load();
    return () => {
      element.removeEventListener('loadedmetadata', seek);
      element.removeEventListener('seeked', done);
      element.pause(); element.removeAttribute('src'); element.load();
    };
  }, [source]);
  useEffect(() => {
    // Claim the 2D context before the first black frame is marked ready.
    // Capture tooling must never accidentally initialize this as WebGL.
    const context = canvas.current?.getContext('2d', {willReadFrequently: true});
    if (!context) return;
    if (opacity === 0) { onDrawn(frame); return; }
    if (!ready || !canvas.current || !video.current) return;
    const element = video.current;
    const cropHeight = element.videoHeight * 0.20;
    const horizon = height * 0.55;
    const scale = Math.max(width / element.videoWidth, horizon / cropHeight);
    const drawnWidth = element.videoWidth * scale;
    const pan = Math.max(-1, Math.min(1, (bearing - 199) / 65));
    const x = (width - drawnWidth) / 2 - pan * (drawnWidth - width) * 0.3;
    context.clearRect(0, 0, width, height);
    context.drawImage(element, 0, 0, element.videoWidth, cropHeight, x, 0, drawnWidth, horizon);
    const sample = context.getImageData(Math.floor(width / 2), Math.floor(horizon - 2), 1, 1).data;
    const gradient = context.createLinearGradient(0, horizon - 2, 0, height);
    gradient.addColorStop(0, `rgb(${sample[0]} ${sample[1]} ${sample[2]})`);
    gradient.addColorStop(1, '#192632');
    context.fillStyle = gradient; context.fillRect(0, horizon - 2, width, height - horizon + 2);
    onDrawn(frame);
  }, [source, ready, frame, opacity, bearing, width, height, onDrawn]);
  return <canvas ref={canvas} className="dusk-sky" width={width} height={height}
    style={{opacity}} aria-hidden="true" />;
}
