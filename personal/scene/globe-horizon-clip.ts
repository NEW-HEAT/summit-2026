import {
  LayerExtension,
  type Layer,
} from "@deck.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";
import { globeUnitVector } from "./globe-camera-model";

type HorizonClipShaderProps = {
  centerNormal: [number, number, number];
};

const CONTRIBUTION_HORIZON_CLIP_SHADER_MODULE: ShaderModule<HorizonClipShaderProps> = {
  name: "contributionHorizonClip",
  vs: /* glsl */ `
layout(std140) uniform contributionHorizonClipUniforms {
  vec3 centerNormal;
} contributionHorizonClip;

out float contributionHorizonVisibility;
`,
  fs: /* glsl */ `
in float contributionHorizonVisibility;
`,
  inject: {
    "vs:DECKGL_FILTER_GL_POSITION": /* glsl */ `
  vec2 horizonLngLat = radians(geometry.worldPosition.xy);
  float horizonCosLatitude = cos(horizonLngLat.y);
  vec3 horizonSurfaceNormal = vec3(
    sin(horizonLngLat.x) * horizonCosLatitude,
    -cos(horizonLngLat.x) * horizonCosLatitude,
    sin(horizonLngLat.y)
  );
  contributionHorizonVisibility = dot(
    horizonSurfaceNormal,
    contributionHorizonClip.centerNormal
  );
`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
  if (contributionHorizonVisibility < 0.002) {
    discard;
  }
`,
  },
  uniformTypes: {
    centerNormal: "vec3<f32>",
  },
};

export class ContributionHorizonClipExtension extends LayerExtension {
  static extensionName = "ContributionHorizonClipExtension";

  private centerNormal: HorizonClipShaderProps["centerNormal"] = [0, -1, 0];

  setCamera(longitude: number, latitude: number): void {
    this.centerNormal = globeUnitVector(longitude, latitude);
  }

  getShaders(): { modules: ShaderModule<HorizonClipShaderProps>[] } {
    return { modules: [CONTRIBUTION_HORIZON_CLIP_SHADER_MODULE] };
  }

  draw(
    this: Layer,
    _parameters: unknown,
    extension: ContributionHorizonClipExtension,
  ): void {
    this.setShaderModuleProps({
      contributionHorizonClip: { centerNormal: extension.centerNormal },
    });
  }
}
