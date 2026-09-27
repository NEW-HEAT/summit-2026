import {
  VIDEO_FEED_CONTRACT,
  feedMotion,
  type FeedBeat,
  type FeedManifest,
  type FeedTrim,
} from "./contract";

declare global {
  interface Window {
    videoFeed: {
      setFrame(frame: number): Promise<void>;
      getFrame(): number;
      getManifest(): FeedManifest;
    };
  }
}

const query = new URLSearchParams(location.search);
const showUi = query.get("ui") !== "0";
const usePreparedMedia = query.get("prepared") === "1";
const requestedFrame = Number(query.get("frame") ?? 0);
const app = document.querySelector<HTMLElement>("#app")!;
const manifest = (await fetch(
  usePreparedMedia ? "/api/feed?prepared=1" : "/api/feed"
).then((response) => response.json())) as FeedManifest;
let currentFrame = clampFrame(requestedFrame);
let playing = query.get("autoplay") === "1";
let playbackStartedAt = performance.now();
let playbackStartFrame = currentFrame;
let activeBeatIndex = -1;
let saveTimer = 0;
let dragDepth = 0;
const cards = new Map<number, HTMLElement>();

document.body.classList.toggle("output", !showUi);
document.documentElement.classList.toggle("output", !showUi);
app.innerHTML = buildShell();

const stage = document.querySelector<HTMLElement>("#stage")!;
const stageWrap = document.querySelector<HTMLElement>("#stage-wrap")!;
const feed = document.querySelector<HTMLElement>("#feed")!;
const scrubber = document.querySelector<HTMLInputElement>("#scrubber")!;
const playButton = document.querySelector<HTMLButtonElement>("#play")!;
const timeLabel = document.querySelector<HTMLElement>("#time")!;
const beatList = document.querySelector<HTMLElement>("#beat-list")!;
const dropMask = document.querySelector<HTMLElement>("#drop-mask")!;
const statusPill = document.querySelector<HTMLElement>(".status-pill")!;

for (const button of Array.from(
  document.querySelectorAll<HTMLButtonElement>(".beat-row")
)) {
  button.addEventListener("click", () => {
    const beat = manifest.beats[Number(button.dataset.beat) - 1];
    pause();
    void setFrame(beat.intervalStartFrame + 20);
  });
}

document.querySelector<HTMLButtonElement>("#previous")?.addEventListener("click", () => {
  const {beatIndex} = feedMotion(currentFrame);
  const beat = manifest.beats[Math.max(0, beatIndex - 1)];
  pause();
  void setFrame(beat.intervalStartFrame + 20);
});
document.querySelector<HTMLButtonElement>("#next")?.addEventListener("click", () => {
  const {beatIndex} = feedMotion(currentFrame);
  const beat = manifest.beats[Math.min(31, beatIndex + 1)];
  pause();
  void setFrame(beat.intervalStartFrame + 20);
});
playButton.addEventListener("click", () => (playing ? pause() : play()));
scrubber.addEventListener("input", () => {
  pause();
  void setFrame(Number(scrubber.value));
});

window.addEventListener("resize", sizeStage);
window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === "Space") {
    event.preventDefault();
    playing ? pause() : play();
  } else if (event.code === "ArrowLeft") {
    pause();
    void setFrame(currentFrame - (event.shiftKey ? 10 : 1));
  } else if (event.code === "ArrowRight") {
    pause();
    void setFrame(currentFrame + (event.shiftKey ? 10 : 1));
  }
});

for (const input of Array.from(
  document.querySelectorAll<HTMLInputElement>("#trim-panel input")
)) {
  input.addEventListener("input", onTrimInput);
  input.addEventListener("change", onTrimInput);
}

const uploadInput = document.querySelector<HTMLInputElement>("#upload")!;
uploadInput.addEventListener("change", () =>
  void ingestFiles(Array.from(uploadInput.files ?? []))
);
window.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth++;
  dropMask.classList.add("visible");
});
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropMask.classList.remove("visible");
});
window.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropMask.classList.remove("visible");
  void ingestFiles(Array.from(event.dataTransfer!.files));
});

window.videoFeed = {
  setFrame,
  getFrame: () => currentFrame,
  getManifest: () => manifest,
};

sizeStage();
await setFrame(currentFrame);
requestAnimationFrame(tick);
if (manifest.media.status !== "ready") {
  window.setInterval(() => void refreshMediaStatus(), 2_000);
}

function buildShell(): string {
  const mediaStatus = `${manifest.media.readyCount}/${manifest.media.expectedCount} source videos`;
  return `
    <section class="workspace">
      <header class="topbar">
        <div class="brand"><strong>Around the World</strong><span>32-video trim + location sync</span></div>
        <span class="status-pill ${manifest.media.status}">${escapeHtml(mediaStatus)}</span>
        <label class="upload-label" for="upload">Add source videos</label>
        <input id="upload" type="file" accept="video/*,.mov,.MOV,.mp4" multiple hidden />
        <button id="clean-view" type="button">Clean alpha view</button>
      </header>
      <section class="preview-shell">
        <div class="stage-wrap" id="stage-wrap"><div class="stage" id="stage"><div class="feed-clip" id="feed"></div></div></div>
      </section>
      <aside class="sidebar">
        <section class="selection" id="selection"></section>
        <section class="trim-panel" id="trim-panel"></section>
        <nav class="beat-list" id="beat-list" aria-label="32-location sequence">
          ${manifest.beats.map((beat) => `
            <button class="beat-row" type="button" data-beat="${beat.beat}">
              <span class="beat-number">${String(beat.beat).padStart(2, "0")}</span>
              <span><span class="beat-place">${escapeHtml(beat.targetPlace)}</span><span class="beat-detail">${escapeHtml([beat.targetRegion, beat.targetCountry].filter(Boolean).join(", "))}</span></span>
              <span class="beat-media ${beat.sourceReady ? "ready" : ""}" title="${beat.sourceReady ? "Source ready" : "Source missing"}"></span>
            </button>`).join("")}
        </nav>
      </aside>
      <footer class="transport">
        <div class="transport-controls"><button id="previous" type="button">← Place</button><button id="play" type="button">Play</button><button id="next" type="button">Place →</button></div>
        <div class="scrubber"><input id="scrubber" type="range" min="0" max="${manifest.contract.frameCount - 1}" value="${currentFrame}" step="1" /><div class="ticks"><span>00:00.0</span><span>32 WORLD beats · locked 30.9 s timing</span><span>00:30.9</span></div></div>
        <output class="time" id="time"></output>
      </footer>
    </section>
    <div class="drop-mask" id="drop-mask">Drop the 32 exported Photos videos to ingest them locally</div>`;
}

function tick(now: number): void {
  if (playing) {
    const elapsedFrames = Math.floor(
      ((now - playbackStartedAt) * manifest.contract.fps) / 1_000
    );
    currentFrame = clampFrame(playbackStartFrame + elapsedFrames);
    if (currentFrame >= manifest.contract.frameCount - 1) pause();
    void renderFrame(false);
  }
  requestAnimationFrame(tick);
}

function play(): void {
  if (currentFrame >= manifest.contract.frameCount - 1) currentFrame = 0;
  playing = true;
  playbackStartedAt = performance.now();
  playbackStartFrame = currentFrame;
  playButton.textContent = "Pause";
}

function pause(): void {
  playing = false;
  playButton.textContent = "Play";
  for (const video of Array.from(feed.querySelectorAll("video"))) video.pause();
}

async function setFrame(frame: number): Promise<void> {
  currentFrame = clampFrame(frame);
  playbackStartFrame = currentFrame;
  playbackStartedAt = performance.now();
  await renderFrame(true);
}

async function renderFrame(forceSeek: boolean): Promise<void> {
  const motion = feedMotion(currentFrame);
  if (motion.beatIndex !== activeBeatIndex) {
    activeBeatIndex = motion.beatIndex;
    rebuildCards(activeBeatIndex);
    renderEditor(activeBeatIndex);
  }
  const travel = manifest.contract.feed.height + manifest.contract.feed.gap;
  const previous = cards.get(activeBeatIndex - 1);
  const current = cards.get(activeBeatIndex);
  const next = cards.get(activeBeatIndex + 1);
  if (previous) {
    previous.style.transform = `translate3d(0, ${-motion.scrollProgress * travel}px, 0)`;
    previous.style.opacity = String(1 - Math.max(0, (motion.scrollProgress - .78) / .22));
  }
  if (current) {
    const incoming = activeBeatIndex === 0 ? 0 : (1 - motion.scrollProgress) * travel;
    current.style.transform = `translate3d(0, ${incoming}px, 0)`;
    current.style.opacity = String(activeBeatIndex === 0 ? 1 : Math.min(1, motion.scrollProgress / .2));
  }
  if (next) {
    next.style.transform = `translate3d(0, ${travel}px, 0)`;
    next.style.opacity = "0";
  }
  scrubber.value = String(currentFrame);
  timeLabel.textContent = `${formatTime(currentFrame / 60)} · ${String(activeBeatIndex + 1).padStart(2, "0")}/32`;
  await syncVideos(forceSeek);
}

function rebuildCards(centerIndex: number): void {
  cards.clear();
  feed.replaceChildren();
  for (const index of [centerIndex - 1, centerIndex, centerIndex + 1]) {
    const beat = manifest.beats[index];
    if (!beat) continue;
    const card = document.createElement("article");
    card.className = "video-card";
    card.dataset.index = String(index);
    if (beat.sourceReady && beat.mediaUrl) {
      const video = document.createElement("video");
      video.src = beat.mediaUrl;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.style.objectPosition = `${beat.trim.cropXPercent}% ${beat.trim.cropYPercent}%`;
      video.style.transform = `scale(${beat.trim.scale})`;
      card.append(video);
    } else {
      card.innerHTML = `<div class="missing-card"><div><strong>${escapeHtml(beat.targetPlace)}</strong><span>${escapeHtml(beat.source.fileName)}<br />awaiting export from Photos</span></div></div>`;
    }
    feed.append(card);
    cards.set(index, card);
  }
}

async function syncVideos(force: boolean): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const [index, card] of cards) {
    const video = card.querySelector("video");
    if (!video) continue;
    const beat = manifest.beats[index];
    const spanFrames = Math.max(1, beat.markerFrame - beat.intervalStartFrame);
    const progress = clamp((currentFrame - beat.intervalStartFrame) / spanFrames, 0, 1);
    const desired =
      beat.trim.trimInSeconds +
      progress * (beat.trim.trimOutSeconds - beat.trim.trimInSeconds);
    video.playbackRate = clamp(
      ((beat.trim.trimOutSeconds - beat.trim.trimInSeconds) * manifest.contract.fps) /
        spanFrames,
      .25,
      4
    );
    if (force || Math.abs(video.currentTime - desired) > .14) {
      tasks.push(seekVideo(video, desired));
    }
    if (playing && index === activeBeatIndex) void video.play().catch(() => undefined);
    else video.pause();
  }
  await Promise.all(tasks);
}

async function seekVideo(video: HTMLVideoElement, seconds: number): Promise<void> {
  if (video.readyState < 1) {
    await new Promise<void>((resolve) => {
      video.addEventListener("loadedmetadata", () => resolve(), {once: true});
      video.addEventListener("error", () => resolve(), {once: true});
    });
  }
  if (!Number.isFinite(video.duration)) return;
  const target = Math.min(seconds, Math.max(0, video.duration - .001));
  if (Math.abs(video.currentTime - target) < .01) {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve) => {
        video.addEventListener("loadeddata", () => resolve(), {once: true});
        video.addEventListener("error", () => resolve(), {once: true});
      });
    }
    return;
  }
  await new Promise<void>((resolve) => {
    video.addEventListener("seeked", () => resolve(), {once: true});
    video.addEventListener("error", () => resolve(), {once: true});
    video.currentTime = target;
  });
}

function renderEditor(index: number): void {
  const beat = manifest.beats[index];
  document.querySelector<HTMLElement>("#selection")!.innerHTML = `
    <div class="selection-kicker">Beat ${String(beat.beat).padStart(2, "0")} · ${formatTime(beat.intervalStartFrame / 60)}</div>
    <h1>${escapeHtml(beat.targetPlace)}</h1>
    <div class="details">${escapeHtml([beat.targetRegion, beat.targetCountry].filter(Boolean).join(", "))}<br />${escapeHtml(beat.targetDateStart)} – ${escapeHtml(beat.targetDateEnd)}<br />Source ${escapeHtml(beat.source.fileName)}</div>
    ${beat.beat === 32 ? `<div class="gainesville">Locked correction: Gainesville, Florida replaces the North Carolina timeline label.</div>` : ""}`;
  document.querySelector<HTMLElement>("#trim-panel")!.innerHTML = trimPanel(beat);
  for (const input of Array.from(
    document.querySelectorAll<HTMLInputElement>("#trim-panel input")
  )) {
    input.addEventListener("input", onTrimInput);
    input.addEventListener("change", onTrimInput);
  }
  for (const row of Array.from(document.querySelectorAll(".beat-row"))) {
    row.classList.remove("active");
  }
  document.querySelector(`.beat-row[data-beat="${beat.beat}"]`)?.classList.add("active");
  document.querySelector(`.beat-row[data-beat="${beat.beat}"]`)?.scrollIntoView({block: "nearest"});
}

function trimPanel(beat: FeedBeat): string {
  const maxStart = Math.max(
    0,
    beat.source.durationSeconds - VIDEO_FEED_CONTRACT.feed.trimWindowSeconds
  );
  return `
    <div class="selection-kicker">Editorial trim</div>
    <div class="locked-window"><strong>0.90 s locked</strong><span>Choose the start moment</span></div>
    ${range("trimInSeconds", "Start", beat.trim.trimInSeconds, maxStart, .01, formatTrimWindow(beat.trim))}
    ${range("cropXPercent", "Pan X", beat.trim.cropXPercent, 100, 1, `${beat.trim.cropXPercent}%`)}
    ${range("cropYPercent", "Pan Y", beat.trim.cropYPercent, 100, 1, `${beat.trim.cropYPercent}%`)}
    ${range("scale", "Scale", beat.trim.scale, 2, .01, `${beat.trim.scale.toFixed(2)}×`, 1)}
    <div class="approve-row"><label><input name="approved" type="checkbox" ${beat.trim.approved ? "checked" : ""} /> Trim approved</label><span class="save-state" id="save-state">Saved locally</span></div>`;
}

function range(name: keyof FeedTrim, label: string, value: number, max: number, step: number, display: string, min = 0): string {
  return `<div class="trim-row"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" /><output data-output="${name}">${display}</output></div>`;
}

function onTrimInput(): void {
  const beat = manifest.beats[activeBeatIndex];
  const panel = document.querySelector<HTMLElement>("#trim-panel")!;
  const read = (name: string) => Number(panel.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value);
  const trimInSeconds = clamp(
    read("trimInSeconds"),
    0,
    Math.max(0, beat.source.durationSeconds - VIDEO_FEED_CONTRACT.feed.trimWindowSeconds)
  );
  const next: FeedTrim = {
    trimInSeconds,
    trimOutSeconds: roundMillis(
      trimInSeconds + VIDEO_FEED_CONTRACT.feed.trimWindowSeconds
    ),
    cropXPercent: read("cropXPercent"),
    cropYPercent: read("cropYPercent"),
    scale: read("scale"),
    approved: panel.querySelector<HTMLInputElement>(`[name="approved"]`)!.checked,
  };
  beat.trim = next;
  updateOutputs(next);
  rebuildCards(activeBeatIndex);
  void renderFrame(true);
  const state = document.querySelector<HTMLElement>("#save-state")!;
  state.textContent = "Saving…";
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveTrim(beat), 180);
}

function updateOutputs(trim: FeedTrim): void {
  const values: Record<keyof FeedTrim, string> = {
    trimInSeconds: formatTrimWindow(trim),
    trimOutSeconds: `${trim.trimOutSeconds.toFixed(2)} s`,
    cropXPercent: `${trim.cropXPercent}%`,
    cropYPercent: `${trim.cropYPercent}%`,
    scale: `${trim.scale.toFixed(2)}×`,
    approved: String(trim.approved),
  };
  for (const [name, value] of Object.entries(values)) {
    const output = document.querySelector<HTMLOutputElement>(`[data-output="${name}"]`);
    if (output) output.value = value;
  }
}

async function saveTrim(beat: FeedBeat): Promise<void> {
  const response = await fetch("/api/trims", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({beat: beat.beat, trim: beat.trim}),
  });
  const state = document.querySelector<HTMLElement>("#save-state")!;
  state.textContent = response.ok ? "Saved locally" : "Save failed";
}

async function ingestFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const byName = new Map(manifest.beats.map((beat) => [beat.source.fileName.toLocaleLowerCase(), beat]));
  for (const file of files) {
    const beat = byName.get(file.name.toLocaleLowerCase());
    if (!beat) continue;
    const response = await fetch(`/api/media/${encodeURIComponent(beat.source.fileName)}`, {
      method: "POST",
      headers: {"Content-Type": "application/octet-stream"},
      body: file,
    });
    if (!response.ok) throw new Error(`Could not ingest ${file.name}.`);
  }
  location.reload();
}

async function refreshMediaStatus(): Promise<void> {
  const next = (await fetch(`/api/feed?scan=${Date.now()}`, {cache: "no-store"}).then(
    (response) => response.json()
  )) as FeedManifest;
  if (next.media.readyCount === manifest.media.readyCount) return;
  manifest.media = next.media;
  for (let index = 0; index < manifest.beats.length; index++) {
    manifest.beats[index].sourceReady = next.beats[index].sourceReady;
    manifest.beats[index].mediaUrl = next.beats[index].mediaUrl;
  }
  statusPill.textContent = `${manifest.media.readyCount}/${manifest.media.expectedCount} source videos`;
  statusPill.classList.toggle("ready", manifest.media.status === "ready");
  statusPill.classList.toggle("missing", manifest.media.status !== "ready");
  for (const row of Array.from(document.querySelectorAll<HTMLElement>(".beat-row"))) {
    const beat = manifest.beats[Number(row.dataset.beat) - 1];
    row.querySelector(".beat-media")?.classList.toggle("ready", beat.sourceReady);
  }
  rebuildCards(activeBeatIndex);
  await renderFrame(true);
}

function sizeStage(): void {
  if (!showUi) return;
  const scale = Math.min(
    stageWrap.clientWidth / VIDEO_FEED_CONTRACT.width,
    stageWrap.clientHeight / VIDEO_FEED_CONTRACT.height
  );
  stage.style.transform = `scale(${scale})`;
}

document.querySelector<HTMLButtonElement>("#clean-view")?.addEventListener("click", () => {
  window.open(`${location.pathname}?ui=0&autoplay=1&frame=${currentFrame}`, "_blank");
});

function clampFrame(value: number): number {
  return Math.max(0, Math.min(manifest.contract.frameCount - 1, Number.isFinite(value) ? Math.round(value) : 0));
}
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function roundMillis(value: number): number { return Math.round(value * 1_000) / 1_000; }
function formatTrimWindow(trim: FeedTrim): string { return `${trim.trimInSeconds.toFixed(2)}–${trim.trimOutSeconds.toFixed(2)} s`; }
function formatTime(seconds: number): string { return `00:${seconds.toFixed(1).padStart(4, "0")}`; }
function formatCaptureDate(value: string): string { return new Intl.DateTimeFormat("en-US", {year: "numeric", month: "short", day: "numeric"}).format(new Date(value)); }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"})[character]!); }
