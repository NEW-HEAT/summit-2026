"""Audit sanitized date bounds against the immutable private supplier in memory."""
import hashlib
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'output'
data = json.loads((HERE / 'private-inputs/observed-visits.json').read_text())
raw = (HERE / 'private-inputs/scene.json').read_bytes()
assert hashlib.sha256(raw).hexdigest() == data['source']['sha256']
source = json.loads(raw)

def km(a, b):
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(math.radians(b[0]-a[0])/2)**2
    return 6371 * 2 * math.asin(math.sqrt(min(1, h)))

checks = []
for w, beat in zip(data['windows'], source['sequence']['beats'], strict=True):
    assert (w['startMs'], w['endMs']) == (beat['targetMs'], beat['sourceMs'])
    zone = beat['zone']
    selected = {r['id']: r for r in source['routes'] if r['id'] in set(zone['allRouteIds'])}
    used = set()
    for visit in w['visits']:
        actual = [r for r in selected.values() if visit['startMs'] <= r['startMs'] and r['endMs'] <= visit['endMs']]
        assert len(actual) == visit['activityCount']
        assert min(r['startMs'] for r in actual) == visit['startMs']
        assert max(r['endMs'] for r in actual) == visit['endMs']
        assert not used.intersection(r['id'] for r in actual)
        used.update(r['id'] for r in actual)
    assert used == set(selected)
    for gap in w['gaps']:
        away = [r for r in source['routes'] if gap['startMs'] < r['startMs'] < gap['endMs'] and r['id'] not in selected and km([zone['longitude'],zone['latitude']],r['center']) > max(120,2*zone['collectionRadiusKm'])]
        assert len(away) == gap['awayActivityCount'] and away
    checks.append(dict(number=w['number'], place=w['place'], visitCount=len(w['visits']), activityCount=len(selected), sourceTimestampBounds='PASS', activityCoverageOnceOnly='PASS', interveningAwayEvidence='PASS'))

allowed_top={'schemaVersion','kind','source','dateSemantics','separationRule','cameraClock','windows'}
assert set(data) == allowed_top
serialized=json.dumps(data)
for forbidden in ['routeIds','allRouteIds','longitude','latitude','coordinates','ownerFingerprint','http://','https://','token','userId']:
    assert forbidden not in serialized
result=dict(status='PASS', supplierSha256=data['source']['sha256'], places=checks, totals=dict(places=len(checks),observedWindows=sum(c['visitCount'] for c in checks),palmBeachWindows=checks[14]['visitCount']), sanitizedFieldAudit='PASS', sourceCalendarEndpoints='PASS', travelArrivalDepartureAccuracy='UNVERIFIED', note='Activity evidence supports observed windows. Inferred source timestamps do not become recorded timestamps. Exact travel arrival/departure remains unverified.')
OUT.mkdir(parents=True,exist_ok=True)
(OUT / 'visit-source-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(dict(status=result['status'],totals=result['totals'],sanitizedFieldAudit=result['sanitizedFieldAudit'])))
