import fs from 'node:fs/promises';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const backgrounds=['#314954','#3C5446','#775647','#55486C','#4D6478','#6D6143'];
const skins=['#F4CCA8','#D99D75','#B77753','#8D543B','#673C2E'];
const hairs=['#201D1C','#49312A','#73503A','#C89347','#C6C1B8'];
const shirts=['#DD9F49','#9EBFC2','#A6BA8B','#D0AAA5','#B4A6C9','#E5D8B2'];
let seed=4701;const random=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n};
let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024">';
for(let i=0;i<96;i++){
 const bg=backgrounds[random(6)],skin=skins[random(5)],hair=hairs[random(5)],shirt=shirts[random(6)],style=random(4),glasses=random(5)===0;
 svg+=`<g transform="translate(${i%12*128} ${Math.floor(i/12)*128})"><circle cx="64" cy="64" r="62" fill="${bg}"/><path d="M15 127 Q18 89 64 88 Q110 89 113 127" fill="${shirt}"/><path d="M51 78h26v25H51z" fill="${skin}"/><ellipse cx="64" cy="53" rx="${style===2?31:29}" ry="37" fill="${hair}"/><ellipse cx="64" cy="58" rx="25" ry="31" fill="${skin}"/>`;
 if(style===0)svg+=`<path d="M37 51Q28 12 64 17Q101 13 93 51L80 28Q64 53 37 51" fill="${hair}"/>`;
 if(style===1)svg+=`<path d="M36 48Q29 18 61 17Q96 15 93 48L80 34L67 40L53 32z" fill="${hair}"/>`;
 if(style===2)svg+=`<path d="M31 93V52Q25 11 64 14Q103 11 97 52V93L84 78V43L75 29Q60 44 43 43V78z" fill="${hair}"/>`;
 if(style===3)svg+=`<path d="M39 36Q63 10 89 36Q83 17 64 18Q46 19 39 36" fill="${hair}"/>`;
 svg+='<circle cx="54" cy="58" r="2.5" fill="#292321"/><circle cx="75" cy="58" r="2.5" fill="#292321"/><path d="M57 73Q64 79 72 73" fill="none" stroke="#623F35" stroke-width="2.8" stroke-linecap="round"/>';
 if(glasses)svg+='<g fill="none" stroke="#292321" stroke-width="2.6"><rect x="42" y="50" width="20" height="15" rx="5"/><rect x="67" y="50" width="20" height="15" rx="5"/><path d="M62 56h5"/></g>';
 svg+='</g>';
}
svg+='</svg>';await fs.writeFile(root+'assets/people-avatar-atlas.svg',svg+'\n');
console.log('Generated 96 deterministic, fictional avatar icons.');
