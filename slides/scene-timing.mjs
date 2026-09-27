export const CLOCK_MORPH_START=.1;
export const CLOCK_MORPH_DURATION=1.4;
export const CLOCK_MORPH_END=CLOCK_MORPH_START+CLOCK_MORPH_DURATION;
export function clockMorph(time){const t=Math.max(0,Math.min(1,(time-CLOCK_MORPH_START)/CLOCK_MORPH_DURATION));return t*t*(3-2*t)}
