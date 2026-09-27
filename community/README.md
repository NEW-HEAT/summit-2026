# vis.gl community

The personal calendar opens into a decade of contributions and a globe of people across the vis.gl ecosystem.

![The vis.gl contributor network](preview.png)

| Part | Source |
| --- | --- |
| Continuous calendar and synchronized tracks | [Renderer](render-synchronized-alpha-tracks.mjs), [calendar scene](living-ladder-scene.mjs) |
| Contributor network across repositories | [Producer](produce-visgl-social.mjs), [globe scene](social-orb-scene.mjs), [model](social-orb-model.mjs) |
| Frozen inputs | [Repository history](acquire.mjs), [decade manifest](build-ten-year-manifest.mjs), [avatars](freeze-all-contributor-avatars.mjs), [ecosystem acquisition](acquire-visgl-social.mjs) |

The calendar, contributor globe and dates are separate transparent tracks. The capture script retains the decoded-frame checks at the personal-history boundary. Both the calendar preparation and ecosystem preparation scripts are needed for these sources.

After root dependency setup, run `node community/produce-visgl-social.mjs`. Supply the frozen manifests, avatar pack and personal-track boundary inputs; set `SOCIAL_MANIFEST` for the frozen ecosystem manifest. Without that manifest the producer makes read-only public GitHub requests, which may differ from the original cutoff.

Private inputs and movies remain outside Git. A fresh full reproduction remains unverified.

[Watch the film](https://www.youtube.com/watch?v=Rp-f-tjqKck) · [Verification](../VERIFY.json)
