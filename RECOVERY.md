# Inputs and recovery

This repository preserves the latest source and selected screenshots. [The finished talk is on YouTube](https://www.youtube.com/watch?v=Rp-f-tjqKck). Git does not contain private routes, source footage, credentials, generated masks, editor packages or rendered movies.

## Where the originals live

| Input | Recovery source | Use |
| --- | --- | --- |
| Activity scene | NEWHEAT application's local `.cache/fitness-archive/scene.json`; rebuild from the owner's activity account with [sync-archive.mts](rewind/sync-archive.mts) if needed | Rewind routes and private observed dates |
| Sprint footage | Owner's Downloads: `original-sprint.mov` | Closing map-to-footage transition; source seconds 5–19, 30 fps |
| Orchard film | Apple Notes → **New Heat Summit Show Script** → **Final.mov** attachment | Presentation film; export from Notes |
| Brand presentation | Owner's Downloads: `[identity]newheat.pdf` | Original identity presentation |
| Opening television clip | Owner's Downloads: `television-rules-the-nation-14.1s-60fps (2).mp4` | Opening edit |
| Opening audience clip | Owner's Downloads: `Video-15568.mp4` | Opening edit |
| Rewind footage | Owner's Apple Photos library; recreate the curated 32-item album in its original order | [Album exporter](rewind/video-feed/export-photos-album.swift) writes `source-01.mov` through `source-32.mov`; [contract](rewind/video-feed/contract.ts) defines beat order and trim lengths |
| Contribution history | GitHub accounts and public organization repositories | Use the acquisition scripts in [personal](personal/) and [community](community/) |
| Provider credentials | Owner's provider console or private environment | Supply locally; never commit them |

The first six sources were read and hashed during retirement on September 27, 2026. The Notes attachment was exported again and matched byte for byte. The Photos album and live provider accounts were not re-exported or checked; no sole copy was deleted on that assumption. Downloads and an application cache are local recovery sources, not independent offsite backups. Preserve those originals when doing any future machine-wide cleanup.

## Verified original identities

Use `shasum -a 256 <file>` to compare a recovered original. A new service export may contain equivalent content with different bytes.

| Input | SHA-256 |
| --- | --- |
| Activity scene | `aba656e9da8af83110234dbffe011edae27234bf66db4c2b3ebc42efbe5e87ce` |
| Sprint footage | `b9db96af312fadd138d1382beed7cb65e619bbe28a2ca70648f3d492289f2396` |
| Orchard film | `9c6c3ec9b3648ef0e4ac70ad284592f4bd01a0eecfd1a0927bc61da51aad719a` |
| Brand presentation | `7c72b33161725f1ea9d36f00f8c7c2968aaf8e3d903fbeae6a965a3ab6752d15` |
| Television clip | `25a32c450125fe8b9aea2ff884a35696fe3c6c3074e7edb9127aa99447921523` |
| Audience clip | `82981cfbb043b0244be38eb90cca3d47a598d21de772133a8b93a770d4279ba1` |

## Restore only what you need

For the rewind, put the activity scene at `.cache/fitness-archive/scene.json`. For the date overlay, put it at `timecode/private-inputs/scene.json`, then run Python 3.10+:

```sh
python3 timecode/extract-visits.py
python3 timecode/audit-visit-source.py
npm run timecode -- proof
```

The exact visit times and counts are generated into ignored `private-inputs/`; they are not public sample data.

For the closing film, [import-sprint.mjs](closing/import-sprint.mjs) recreates the selected playback clip:

```sh
node closing/import-sprint.mjs /path/to/original-sprint.mov
```

Then follow [the registration chain](closing/README.md) to derive pose, footsteps, person masks, camera shake and lane alignment. Encoding bytes can change with tool versions; use the original hash and documented timing as the source identity. The original HDR-to-playback conversion is preserved as an experiment, not a newly certified color master.

At project closeout, the owner chose to discard the remaining local videos, private scene settings, exact Photos lookup records, CapCut project snapshots and cleanup history, including files without another verified copy. These are not part of the public archive and are no longer designated for retention. External originals listed above remain outside the project cleanup. **This repository recovers the published code and screenshots; exact reproduction of the private edit may require rebuilding inputs and authoring scene settings again.**

Generated renders and diagnostic caches can be recreated. The already published movie is a viewing copy, not a replacement for editable originals.
