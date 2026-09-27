"""Track one continuous lane stripe using camera motion, rejecting jumps to the curb."""
import hashlib,json
from pathlib import Path
import cv2
import numpy as np
root=Path(__file__).resolve().parent.parent
output=root/'private-inputs/analysis/lane-lock.json'
output.parent.mkdir(parents=True, exist_ok=True)
if output.exists(): raise RuntimeError('Preserve existing lane lock')
source=root/'private-inputs/public/media/sprint-seekable.mp4'
camera=json.loads((root/'private-inputs/analysis/camera-shake.json').read_text())
cap=cv2.VideoCapture(str(source));candidates=[]
for f in range(420):
    ok,frame=cap.read()
    if not ok: raise RuntimeError('Missing frame')
    im=cv2.resize(frame,(960,540))
    edge=cv2.Canny(cv2.cvtColor(im,cv2.COLOR_BGR2GRAY),20,60)
    edge[:280]=0;edge[:,:400]=0
    found=cv2.HoughLinesP(edge,1,np.pi/720,30,minLineLength=90,maxLineGap=35)
    rows=[]
    for x,y,u,v in ([] if found is None else found[:,0]):
        if abs(u-x)<80:continue
        m=(v-y)/(u-x);b=y-m*x
        if -.4<m<.12: rows.append([float(m),float(b*2)])
    candidates.append(rows)
cap.release()
seed=129
line=min(candidates[seed],key=lambda l:abs(l[0]*550+l[1]-1052))
locked=[None]*420;locked[seed]={'frame':seed,'slope':line[0],'intercept':line[1],'method':'reviewed-contact-seed'}
def propagate(line,m):
    p=m@np.array([0,line[1],1]);q=m@np.array([1920,line[0]*1920+line[1],1])
    slope=(q[1]-p[1])/(q[0]-p[0]);return [float(slope),float(p[1]-slope*p[0])]
for direction in [1,-1]:
    last=line
    for f in range(seed+direction,420 if direction>0 else -1,direction):
        raw=camera['measurements'][f if direction>0 else f+1]['matrix']
        m=np.vstack((np.array(raw).reshape(2,3),[0,0,1]))
        pred=propagate(last,m if direction>0 else np.linalg.inv(m))
        options=candidates[f]
        best=min(options,key=lambda l:abs((l[0]-pred[0])*960+l[1]-pred[1])+400*abs(l[0]-pred[0])) if options else None
        observed=best is not None and abs((best[0]-pred[0])*960+best[1]-pred[1])<36 and abs(best[0]-pred[0])<.05
        last=[.8*best[j]+.2*pred[j] for j in range(2)] if observed else pred
        locked[f]={'frame':f,'slope':last[0],'intercept':last[1],'method':'lane-edge-and-camera' if observed else 'camera-propagated-line'}
result={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sourceFps':30,'sourceWidth':1920,'sourceHeight':1080,
    'method':'Continuous painted-lane track: source-frame 129 seed, camera-propagated prediction and gated local Hough edges. Reject curb-line switches; gaps retain the camera prediction.',
    'cameraAnalysisSha256':hashlib.sha256((root/'private-inputs/analysis/camera-shake.json').read_bytes()).hexdigest(),
    'rows':locked,'observedFrames':sum(r['method']=='lane-edge-and-camera' for r in locked),
    'physicalRoadDepth':'UNVERIFIED'}
output.write_text(json.dumps(result,separators=(',',':'))+'\n');print(json.dumps({'observedFrames':result['observedFrames']}))
