# Closing film

One continuous move: fly from the globe onto the bridge, blend into real running footage, then pull back to reveal a world of activity routes.

[Watch on YouTube](https://www.youtube.com/watch?v=Rp-f-tjqKck).

![Map blending into the source footage](preview.png)

Basemap: Google Maps. [Map and media credits](../THIRD_PARTY.md).

| Beat | Source |
| --- | --- |
| Globe → bridge | [Camera and timing](scene/timeline.ts), [map layers](scene/layers.ts) |
| Map ↔ footage | [Composition](scene/Scene.tsx), [footstep registration](scene/trail.ts), [gait and masks](scene/gait.ts) |
| Bridge → worldwide routes | [Route reveal](scene/globalHeat.ts) |
| Frame capture | [Render script](render.mjs) |

`scene/` contains the renderer and its supporting modules. `registration/` holds the camera-shake and lane-lock measurements used to align the footsteps. The small bridge figures are stylized runner and cyclist proxies; the close-up uses real footage. Route highlights follow the edit clock, not historical speed.

The sequence evolved through repeated camera, registration and transition passes. This archive keeps the active scene and capture path. The preserved source is the 37-second review sequence; known map/footage registration and tile seams remain, and its exact placement in the final edit has not been verified.

<details>
<summary>How the transition inputs were prepared</summary>

The five scripts in `registration/` preserve the preparation chain: [Apple Vision pose and masks](registration/pose.swift) → [footfall estimates](registration/footfalls.mjs) → [person-mask refinement](registration/person-mask.mjs) → [camera shake](registration/camera-shake.py) → [lane lock](registration/lane-lock.py). They require the original local clip, macOS Vision, FFmpeg and Python with OpenCV/NumPy. Reviewed sole positions remain in `scene/gait.ts`.

Generated inputs stay under `private-inputs/`. The Python scripts write candidate measurements to `private-inputs/analysis/`; review them before replacing the two archived JSON files. These preparation scripts have not been rerun during curation.

</details>

## Run locally

Use Node 22.5+, the root dependency lockfile, FFmpeg, and a Chrome instance with remote debugging on port 9230. From the repository root:

```sh
npm ci --legacy-peer-deps
npm run closing:build
npm run closing
```

Before building, supply the private scene config, footage, gait analysis, masks and biometric sample file under `closing/private-inputs/public/`, keeping the URL paths referenced by the config. These are excluded from Git. The build links them into the local preview without duplicating their bytes.

The capture script also needs `closing/private-inputs/heat.json`: the frozen `{payload, evidence}` input defined in [globalHeat.ts](scene/globalHeat.ts). It verifies the payload hash, route/path counts and coverage evidence before capture. This archive does not fetch a live account or include its private activity geometry.

Open `http://localhost:5195` in the debugging Chrome instance, set `VITE_GOOGLE_MAPS_API_KEY` in your environment, then:

```sh
npm run closing:render -- --check-inputs
npm run closing:render -- --stills
```

Omit `--stills` for a local movie; use `--output <new-directory>` for another capture. The 60 fps scene has 2,220 source frames; capture samples 1,110 frames at 30 fps, including the final source frame. Output remains local. A fresh GPU render has not been verified after this source cleanup; see [verification](../VERIFY.json).
