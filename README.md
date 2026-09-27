# NEWHEAT Summit 2026

The aim of this project was to build a Summit presentation and its visual stories with **vis.gl and Codex** — from animated routes and contribution histories to live demos and transitions between maps and real footage.

[**Watch on YouTube →**](https://www.youtube.com/watch?v=Rp-f-tjqKck)

The visuals evolved through many small iterations. This repository keeps the latest source and selected screenshots. Thanks to [**@ibgreen**](https://github.com/ibgreen) for his support.

| Preview | Explore the source |
|---|---|
| <img src="opening/preview.png" width="360" alt="Glowing routes across the Cyclades"> | [Authorship opening](opening/) — Glowing routes across the Cyclades. |
| <img src="rewind/preview.png" width="360" alt="Routes, media, and dates in the geographic rewind"> | [Geographic rewind](rewind/) — Activity routes, memories, and journeys through time. |
| <img src="personal/preview.png" width="360" alt="Contribution history across multiple organizations"> | [Personal contribution history](personal/) — Contributions across organizations, calendars, and places. |
| <img src="community/preview.png" width="360" alt="The vis.gl contributor network"> | [vis.gl community](community/) — Contributors and connections across the ecosystem. |
| <img src="closing/preview.png" width="360" alt="A transition between the map and real footage"> | [Closing film](closing/) — Moving from the map into real footage and back. |
| <img src="timecode/preview.png" width="360" alt="The film's shared date axis"> | [Unified date overlay](timecode/) — A shared date axis for the film. |
| <img src="slides/preview.png" width="360" alt="A slide from the presentation"> | [Presentation and live demos](slides/) — Talk cues, slides, and interactive demos. |

Each folder contains its scripts and setup notes. To get started with the slides, use Node.js 22.5+:

```sh
npm ci --legacy-peer-deps
npm run slides:build
npm run slides
```

Original code is [MIT licensed](LICENSE): use it, adapt it, and build on it. This is an experimental creative archive; some renderers need private inputs and provider credentials. [Input recovery](RECOVERY.md) · [Map and media credits](THIRD_PARTY.md).
