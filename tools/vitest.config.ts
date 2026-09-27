import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'node',pool:'forks',maxWorkers:1,minWorkers:1,include:['rewind/**/*.test.ts','personal/tests/*.test.ts','closing/scene/BridgeTile3DLayer.test.ts','closing/scene/surface.test.ts','closing/scene/tileCredits.test.ts']}});
