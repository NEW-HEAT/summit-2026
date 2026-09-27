# Personal contribution history

A moving contribution calendar connects work across organizations with the places where it happened.

![Contribution history across multiple organizations](preview.png)

| Track | Source |
| --- | --- |
| Calendar, legend and date overlays | [Calendar renderer](render-vertical.mts), [scene](scene/vertical-scene.ts) |
| Geographic history and organization overlays | [Globe renderer](render-globe.mts), [scene](scene/globe-scene.ts) |
| Shared counting, timing and geography | [Scene models](scene/) |
| Input preparation | [Contribution acquisition](acquire-project-contributions.mts), [prefilled history](prepare-prefilled-history.mts) |

The calendar and globe are separate transparent tracks. Their 62-second source sequence ends on frame 3,719, which the archived community renderer uses for its boundary. `tests/` covers the models and this shared frame contract; a fresh decoded-pixel handoff remains unverified.

After root dependency setup, render the globe from a frozen private dataset:

```sh
npm run personal -- --dataset personal/private-inputs/location-heat.json --output personal/output/globe.mov
```

The contribution snapshots and location archive are not included. Outputs stay local; no live account access is needed when using a frozen dataset.

[Watch the film](https://www.youtube.com/watch?v=Rp-f-tjqKck) · [Verification](../VERIFY.json)
