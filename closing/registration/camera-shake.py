"""Measure camera shake on static skyline/bridge features; keep route travel unchanged."""
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'private-inputs/public/media/sprint-seekable.mp4'
OUTPUT=ROOT/'private-inputs/analysis/camera-shake.json'
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
EXPECTED='c615e8c7eedae264dd034153a4755c23b03234691cc58d46d60e2da7e83b1eaa'
if OUTPUT.exists(): raise RuntimeError('Preserve existing camera analysis')
if hashlib.sha256(SOURCE.read_bytes()).hexdigest()!=EXPECTED: raise RuntimeError('Source identity mismatch')
cv2.setNumThreads(2);cv2.setRNGSeed(32032)
sift=cv2.SIFT_create(nfeatures=3000,contrastThreshold=.008,edgeThreshold=15)
matcher=cv2.BFMatcher()
cap=cv2.VideoCapture(str(SOURCE));features=[]
for f in range(420):
    ok,im=cap.read()
    if not ok: raise RuntimeError('Missing source frame')
    gray=cv2.cvtColor(cv2.resize(im,(960,540)),cv2.COLOR_BGR2GRAY)
    mask=cv2.resize(cv2.imread(str(ROOT/f'private-inputs/public/analysis/bridge-occlusion/mask-{f:05d}.png'),0),(960,540))
    mask=cv2.erode(np.uint8(mask>250)*255,np.ones((9,9),np.uint8))
    mask[:90]=0;mask[310:]=0
    features.append(sift.detectAndCompute(gray,mask))
cap.release()
rows=[{'frame':0,'matrix':[1,0,0,0,1,0],'accepted':True,'method':'identity'}]
for i in range(1,420):
    (k0,d0),(k1,d1)=features[i-1:i+1]
    matches=[a for a,b in matcher.knnMatch(d0,d1,k=2) if a.distance<.72*b.distance]
    p=np.float32([k0[m.queryIdx].pt for m in matches]);q=np.float32([k1[m.trainIdx].pt for m in matches])
    keep=(np.abs(q[:,0]-p[:,0])<90)&(np.abs(q[:,1]-p[:,1])<70)
    p,q=p[keep],q[keep]
    held=np.arange(len(p))%5==0
    matrix,ins=cv2.estimateAffinePartial2D(p[~held],q[~held],method=cv2.RANSAC,ransacReprojThreshold=2.5,maxIters=5000,confidence=.999)
    if matrix is None: raise RuntimeError(f'No static camera model at {i}')
    residual=np.linalg.norm(p[held]@matrix[:,:2].T+matrix[:,2]-q[held],axis=1)*2
    scale=np.hypot(matrix[0,0],matrix[1,0]);angle=np.arctan2(matrix[1,0],matrix[0,0])
    accepted=.97<scale<1.03 and abs(angle)<.035 and int(ins.sum())>=6
    matrix[:,2]*=2
    rows.append({'frame':i,'matrix':matrix.ravel().tolist(),'accepted':bool(accepted),
        'method':'static-background-sift-ransac','matches':len(p),'inliers':int(ins.sum()),
        'heldOutMedianPixels':float(np.median(residual))})
    if i%60==0: print(f'camera shake {i}/419',flush=True)
good=[r for r in rows[1:] if r['accepted']]
for r in rows[1:]:
    if not r['accepted']:
        r['rawMatrix']=r['matrix']
        r['matrix']=[float(np.interp(r['frame'],[v['frame'] for v in good],[v['matrix'][j] for v in good])) for j in range(6)]
        r['method']='low-confidence-neighbor-interpolation'
cumulative=[np.eye(3)]
for r in rows[1:]: cumulative.append(np.vstack((np.array(r['matrix']).reshape(2,3),[0,0,1]))@cumulative[-1])
params=[]
for m in cumulative:
    center=m@np.array([960,540,1])
    params.append([center[0],center[1],np.arctan2(m[1,0],m[0,0]),np.log(np.hypot(m[0,0],m[1,0]))])
params=np.array(params);params[:,2]=np.unwrap(params[:,2])
kernel=np.exp(-np.arange(-8,9,dtype=float)**2/(2*3.2**2));kernel/=kernel.sum()
smooth=np.stack([np.convolve(np.pad(params[:,i],8,mode='edge'),kernel,mode='valid') for i in range(4)],axis=1)
shakes=[]
for i,(cx,cy,angle,logscale) in enumerate(smooth):
    a=np.exp(logscale)*np.cos(angle);b=np.exp(logscale)*np.sin(angle)
    nominal=np.array([[a,-b,cx-a*960+b*540],[b,a,cy-b*960-a*540],[0,0,1]])
    jitter=cumulative[i]@np.linalg.inv(nominal)
    shakes.append([round(float(v),9) for v in jitter.ravel()])
result={'schemaVersion':1,'sourceSha256':EXPECTED,'sourceFps':30,'sourceWidth':1920,'sourceHeight':1080,
    'sourceFrameRange':[0,419],'method':'Static skyline and bridge SIFT features excluding the runner; similarity RANSAC; subtract 17-frame Gaussian nominal camera motion. Apply only camera shake, never replace route travel with far-background parallax.',
    'opencvVersion':cv2.__version__,'matrices':shakes,'measurements':rows,
    'verification':{'acceptedFrames':len(good),'interpolatedFrames':419-len(good),
        'heldOutMedianPixels':float(np.median([r['heldOutMedianPixels'] for r in good])),
        'heldOutP95Pixels':float(np.percentile([r['heldOutMedianPixels'] for r in good],95)),
        'physicalRoadRegistration':'UNVERIFIED'}}
OUTPUT.write_text(json.dumps(result,separators=(',',':'))+'\n')
print(json.dumps(result['verification']),flush=True)
