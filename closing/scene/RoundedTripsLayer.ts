import {TripsLayer} from '@deck.gl/geo-layers';
import {CompositeLayer} from '@deck.gl/core';

const registrationUniforms = {
  name: 'groundRegistration',
  vs: `layout(std140) uniform groundRegistrationUniforms {
  vec3 rowX;
  vec3 rowY;
  vec3 rowZ;
} groundRegistration;`,
  uniformTypes: {rowX: 'vec3<f32>', rowY: 'vec3<f32>', rowZ: 'vec3<f32>'},
  defaultUniforms: {rowX: [1, 0, 0], rowY: [0, 1, 0], rowZ: [0, 0, 1]}
} as const;

/** Preserve rounded caps and register the whole ground ribbon, not only its centerline. */
export class RegisteredTripStrokeLayer<DataT> extends TripsLayer<DataT, {registration: number[]}> {
  static layerName = 'RegisteredTripStrokeLayer';
  static defaultProps = {
    registration: {type: 'array', value: [1, 0, 0, 0, 1, 0, 0, 0, 1], compare: true}
  } as any;

  override draw(parameters: any) {
    const m = this.props.registration;
    this.state.model?.shaderInputs.setProps({groundRegistration: {rowX: m.slice(0, 3), rowY: m.slice(3, 6), rowZ: m.slice(6, 9)}});
    super.draw(parameters);
  }

  override getShaders() {
    const shaders = super.getShaders();
    shaders.modules = [...shaders.modules, registrationUniforms as any];
    shaders.inject = {
      ...shaders.inject,
      'vs:#main-end': `
vTime = instanceTimestamps + (instanceNextTimestamps - instanceTimestamps)
  * clamp(vPathPosition.y / max(vPathLength, 0.000001), 0.0, 1.0);
vec3 screen = vec3(gl_Position.xy / gl_Position.w, 1.0);
vec3 registered = vec3(dot(groundRegistration.rowX, screen), dot(groundRegistration.rowY, screen), dot(groundRegistration.rowZ, screen));
if (abs(registered.z) > 0.000001) {
  gl_Position.xy = registered.xy / registered.z * gl_Position.w;
}
`
    };
    return shaders;
  }
}

/** A few active deposits use uniform-backed native TripsLayers, within WebGL's attribute limit. */
export class RoundedTripsLayer<DataT> extends CompositeLayer<any> {
  static layerName = 'RoundedTripsLayer';
  renderLayers() {
    const {data, ...props} = this.props;
    return (data as Array<DataT & {kind: string; sourceFrame: number; registration: number[]}>).map(item =>
      new RegisteredTripStrokeLayer({
        ...props,
        ...this.getSubLayerProps({id: `${item.kind}-${item.sourceFrame}`}),
        data: [item], registration: item.registration
      } as any));
  }
}
