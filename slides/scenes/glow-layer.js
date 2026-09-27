import {Layer} from '@deck.gl/core';
import {Model,Geometry} from '@luma.gl/engine';
import {Matrix4} from '@math.gl/core';

const block=`layout(std140) uniform glowUniforms {
 mat4 inverseVP;
 mat4 vp;
 vec3 right;
 float time;
 vec3 up;
 float morph;
 float strength;
 float clockTime;
 float atmosphereOnly;
} glow;`;
const uniforms={name:'glow',vs:block,fs:block,uniformTypes:{inverseVP:'mat4x4<f32>',vp:'mat4x4<f32>',right:'vec3<f32>',time:'f32',up:'vec3<f32>',morph:'f32',strength:'f32',clockTime:'f32',atmosphereOnly:'f32'}};
const vs=`#version 300 es
in vec2 positions;
out vec2 clipXY;
void main(){clipXY=positions;gl_Position=vec4(positions,0.0,1.0);}`;
const fs=`#version 300 es
precision highp float;
in vec2 clipXY;
out vec4 fragColor;
float lineDistance(vec2 p,vec2 a,vec2 b){vec2 v=b-a;return length(p-a-v*clamp(dot(p-a,v)/dot(v,v),0.0,1.0));}
vec2 hand(float angle,float length){return vec2(sin(angle),cos(angle))*length;}
void main(){
 vec4 nearH=glow.inverseVP*vec4(clipXY,-1.0,1.0);
 vec4 farH=glow.inverseVP*vec4(clipXY,1.0,1.0);
 vec3 origin=nearH.xyz/nearH.w;
 vec3 ray=normalize(farH.xyz/farH.w-origin);
 float b=dot(origin,ray),c=dot(origin,origin)-256.0*256.0;
 float discriminant=b*b-c;
 vec3 amber=vec3(.867,.624,.286);
 float power=max(1.0,glow.strength),boost=log2(power);
 if(discriminant<0.0){
   float distanceToSphere=length(origin-ray*b)/256.0-1.0;
   float width=.045+boost*.021;
   float halo=(exp(-distanceToSphere/width)*.65+exp(-pow(distanceToSphere/(width*3.0),2.0))*.18)*(.55+boost*.16);
   if(halo<.002)discard;
   fragColor=vec4(amber,halo);gl_FragDepth=.999999;return;
 }
 if(glow.atmosphereOnly>.5)discard;
 float t=-b-sqrt(discriminant);
 if(t<0.0)discard;
 vec3 hit=origin+t*ray,n=normalize(hit);
 // Light lives behind the globe. The front stays dark even at maximum shine.
 float rim=pow(1.0-max(0.0,dot(n,-ray)),7.0);
 vec3 sphere=vec3(.055,.055,.058)+amber*rim*(.7+boost*.28);
 vec2 p=vec2(dot(n,glow.right),dot(n,glow.up));
 float r=length(p),angle=atan(p.x,p.y);
 float minuteD=abs(sin(angle*30.0))*r/30.0;
 float hourD=abs(sin(angle*6.0))*r/6.0;
 float minuteTicks=(1.0-smoothstep(.002,.006,minuteD))*smoothstep(.79,.81,r)*(1.0-smoothstep(.89,.90,r));
 float hourTicks=(1.0-smoothstep(.003,.009,hourD))*smoothstep(.71,.73,r)*(1.0-smoothstep(.90,.91,r));
 float ring=1.0-smoothstep(.003,.009,abs(r-.94));
 float elapsed=glow.clockTime;
 float minuteHand=1.0-smoothstep(.006,.014,lineDistance(p,vec2(0),hand(1.047+elapsed*.001745,.65)));
 float hourHand=1.0-smoothstep(.009,.019,lineDistance(p,vec2(0),hand(-1.047+elapsed*.0001454,.43)));
 float secondHand=1.0-smoothstep(.002,.006,lineDistance(p,hand(elapsed*.10472,-.12),hand(elapsed*.10472,.76)));
 float hub=1.0-smoothstep(.020,.030,r);
 vec3 clockFace=vec3(.045,.045,.047)+amber*(minuteTicks*.55+hourTicks*.8+ring*.8);
 clockFace=mix(clockFace,vec3(.96,.92,.84),max(max(minuteHand,hourHand),hub));
 clockFace=mix(clockFace,vec3(.96,.40,.012),secondHand);
 fragColor=vec4(mix(sphere,clockFace,glow.morph),1.0);
 vec4 projected=glow.vp*vec4(hit,1.0);gl_FragDepth=projected.z/projected.w*.5+.5;
}`;

// Ray/sphere intersection uses the active native GlobeView matrices and its
// 256-unit globe radius, so geospatial ArcLayers share the same surface/depth.
export class GlowLayer extends Layer{
 static layerName='NEWHEATGlowLayer';
 static defaultProps={time:0,morph:0,strength:1,clockTime:0,atmosphereOnly:false};
 getShaders(){return super.getShaders({vs,fs,modules:[uniforms]})}
 initializeState(){this.setState({model:new Model(this.context.device,{id:this.props.id,...this.getShaders(),geometry:new Geometry({topology:'triangle-strip',attributes:{positions:{size:2,value:new Float32Array([-1,-1,1,-1,-1,1,1,1])}}}),isInstanced:false})})}
 draw(){const viewport=this.context.viewport,v=viewport.viewMatrix;const unit=a=>{const l=Math.hypot(...a);return a.map(x=>x/l)};this.state.model.shaderInputs.setProps({glow:{inverseVP:new Matrix4(viewport.viewProjectionMatrix).invert(),vp:viewport.viewProjectionMatrix,right:unit([v[0],v[4],v[8]]),up:unit([v[1],v[5],v[9]]),time:this.props.time,morph:this.props.morph,strength:this.props.strength,clockTime:this.props.clockTime,atmosphereOnly:this.props.atmosphereOnly?1:0}});this.state.model.draw(this.context.renderPass)}
}
