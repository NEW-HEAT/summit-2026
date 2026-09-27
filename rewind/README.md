# Geographic rewind

Travel backwards through activity routes and memories, then settle over Orlando for the contribution-history handoff.

![Routes, media and dates during the rewind](preview.png)

| Part | Source |
| --- | --- |
| Map, route timing and captions | [Scene](scene/scene.ts), [memory model](scene/geographic-memory-model.ts) |
| Main capture | [Renderer](render.mts) |
| Footage overlay | [Video feed](video-feed/) |
| Closing date recap | [Timecode extension](full-timecode-extension/) |
| Orlando handoff | [Presence scene](orlando-presence/) |

`scene/` holds the shared rendering models; `tests/` holds their checks. [sync-archive.mts](sync-archive.mts) prepares the activity input. The timecode extension and Orlando scene are separate tracks referenced by the show manifest.

After root dependency setup, run `npm run rewind`. Supply the frozen activity archive at `.cache/fitness-archive/scene.json`, provider access and selected local videos. Private inputs and rendered movies are excluded from Git; a fresh full render remains unverified.

[Watch the film](https://www.youtube.com/watch?v=Rp-f-tjqKck) · [Verification](../VERIFY.json)
