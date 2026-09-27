"""Read the immutable scene archive; export private observed activity dates and counts.

A return window ends when the archive records an activity at least 120 km
away (and beyond twice the scene collection radius) before the next local
activity. Missing activity alone never implies a departure. These are observed
activity bounds, not a claim about the exact arrival or departure time.
"""
import datetime
import hashlib
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
SUPPLIER = HERE / 'private-inputs/scene.json'
raw = SUPPLIER.read_bytes()
archive = json.loads(raw)
lock = json.loads((HERE / 'place-date-lock.json').read_text())['windows']

def date(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime('%Y-%m-%d')

def distance(p, q):
    a, b = map(math.radians, [p[1], q[1]])
    dy, dx = math.radians(q[1] - p[1]), math.radians(q[0] - p[0])
    return 12742 * math.asin(min(1, math.sqrt(math.sin(dy / 2) ** 2 + math.cos(a) * math.cos(b) * math.sin(dx / 2) ** 2)))

windows = []
for approved, beat in zip(lock, archive['sequence']['beats'], strict=True):
    assert date(beat['targetMs']) == approved['startDate']
    assert date(beat['sourceMs']) == approved['endDate']
    zone = beat['zone']
    ids = set(zone['allRouteIds'])
    local = sorted((r for r in archive['routes'] if r['id'] in ids), key=lambda r: r['startMs'])
    center = [zone['longitude'], zone['latitude']]
    away = [r for r in archive['routes'] if beat['targetMs'] < r['startMs'] < beat['sourceMs'] and r['id'] not in ids and distance(center, r['center']) > max(120, 2 * zone['collectionRadiusKm'])]
    groups = []
    for activity in local:
        previous_end = max(r['endMs'] for r in groups[-1]) if groups else None
        departed = previous_end is not None and any(previous_end < r['startMs'] < activity['startMs'] for r in away)
        if not groups or departed:
            groups.append([activity])
        else:
            groups[-1].append(activity)
    visits = []
    for index, group in enumerate(groups):
        start, end = min(r['startMs'] for r in group), max(r['endMs'] for r in group)
        days = sorted({date(r['startMs']) for r in group})
        visits.append(dict(index=index, startMs=start, endMs=end, startDate=date(start), endDate=date(end), observedDates=days, observedDays=len(days), activityCount=len(group), recordedActivityCount=sum(r['timing'] == 'recorded' for r in group), inferredActivityCount=sum(r['timing'] == 'inferred' for r in group)))
    gaps = []
    for before, after in zip(visits, visits[1:]):
        evidence = [r for r in away if before['endMs'] < r['startMs'] < after['startMs']]
        assert evidence
        gaps.append(dict(startMs=before['endMs'], endMs=after['startMs'], awayObservedDates=sorted({date(r['startMs']) for r in evidence}), awayActivityCount=len(evidence), recordedAwayActivityCount=sum(r['timing'] == 'recorded' for r in evidence)))
    windows.append(dict(**approved, startMs=beat['targetMs'], endMs=beat['sourceMs'], observedDays=len({date(r['startMs']) for r in local}), activityCount=len(local), visits=visits, gaps=gaps))

result = dict(schemaVersion=1, kind='private-observed-visit-windows', source=dict(originalPath='private-inputs/scene.json', sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw), importMode='allowlisted-date-and-count-extract; private source not copied'), dateSemantics='UTC source activity timestamps. Inferred source timestamps retain their provenance. Bounds are first/last observed activity, not exact travel arrival/departure.', separationRule='Split only when an intervening activity is outside both 120 km and twice the selected scene collection radius. No split from missing activity alone.', cameraClock='Incoming date = source targetMs + (sourceMs - targetMs) * quinticSmootherstep((beatProgress - 0.32) / 0.62). Gaps retain the source clock; they never receive an active-stay highlight.', windows=windows)
(HERE / 'private-inputs/observed-visits.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(dict(places=len(windows), returnWindows=sum(len(w['visits']) for w in windows), palmBeachWindows=len(windows[14]['visits']), sourceSha256=result['source']['sha256'])))
