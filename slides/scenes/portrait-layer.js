import {IconLayer} from '@deck.gl/layers';

// Native IconLayer uses a local atlas of 96 fictional avatar icons.
// Circular edge and border share each node's alpha with its attached arcs.
export class PortraitLayer extends IconLayer{
 static layerName='NEWHEATPortraitLayer';
 getShaders(){const shaders=super.getShaders();return {...shaders,inject:{...shaders.inject,'fs:DECKGL_FILTER_COLOR':`
   float radius=length(geometry.uv);
   if(radius>1.0)discard;
   float border=smoothstep(.84,.94,radius);
   color.rgb=mix(color.rgb,vec3(.867,.624,.286),border);
   color.a*=1.0-smoothstep(.94,1.0,radius);
 `}}}
}

export const avatarAtlas='/assets/people-avatar-atlas.svg';
export const avatarMapping=Object.fromEntries(Array.from({length:96},(_,id)=>[id,{x:id%12*128,y:Math.floor(id/12)*128,width:128,height:128,mask:false}]));
