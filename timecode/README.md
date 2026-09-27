# Unified date overlay

One fixed calendar scale follows the film from geographic memories through personal work and the vis.gl community.

![The shared date axis](preview.png)

| Part | Source |
| --- | --- |
| Date mapping and drawing | [Scene](scene.cjs) |
| Frame checks and encoding | [Renderer](render.cjs) |
| Timing authority | [Approved timing](approved-timing.json), [camera timing](camera-playback-timing.json), [date lock](place-date-lock.json) |
| Observed activity bounds | [Extraction](extract-visits.py), [source audit](audit-visit-source.py) |

The renderer uses a private observed-visit input and the retained style contract. Dates describe observed activity bounds; missing activity does not establish a travel departure.

After restoring the private input and installing dependencies, `npm run timecode -- proof` checks all 8,826 states and writes still proofs. `npm run timecode -- render` encodes the 147.1-second alpha movie locally with FFmpeg. Set `SUMMIT_MONO_FONT` when macOS SFNSMono is unavailable.

Re-extracting or auditing the visit data requires `timecode/private-inputs/scene.json`. Run `python3 timecode/extract-visits.py` with Python 3.10+ to regenerate `timecode/private-inputs/observed-visits.json`. Exact activity times and counts are kept out of the public archive; see [recovery](../RECOVERY.md).

[Watch the film](https://www.youtube.com/watch?v=Rp-f-tjqKck) · [Verification](../VERIFY.json)
