import { clamp } from "@math.gl/core";
import { MAX_LATITUDE } from "@math.gl/web-mercator";
import Controller from "./controller";
import { getMaxBoundsExtents, getMaxBoundsRect } from "./utils";
import { MapState } from "./map-controller";
import { CONSTRAINT_AROUND } from "./view-state";
import { mod } from "../utils/math-utils";
import LinearInterpolator from "../transitions/linear-interpolator";
import GlobeViewport, { zoomAdjust, GLOBE_RADIUS } from "../viewports/globe-viewport";
import {
  Globe,
  GLOBE_INERTIA_EASING,
  GlobeInertiaInterpolator
} from "../viewports/globe-utils";
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
function degreesToPixels(angle, zoom = 0) {
  const radians = Math.min(180, angle) * DEGREES_TO_RADIANS;
  const size = GLOBE_RADIUS * 2 * Math.sin(radians / 2);
  return size * Math.pow(2, zoom);
}
function pixelsToDegrees(pixels, zoom = 0) {
  const size = pixels / Math.pow(2, zoom);
  const radians = Math.asin(Math.min(1, size / GLOBE_RADIUS / 2)) * 2;
  return radians * RADIANS_TO_DEGREES;
}
class GlobeState extends MapState {
  constructor(options) {
    const { startPanPos, startPanCameraFrame, startPanAngularRate, ...mapStateOptions } = options;
    mapStateOptions.normalize = false;
    super(mapStateOptions);
    const s = this._state;
    if (startPanPos !== void 0) s.startPanPos = startPanPos;
    if (startPanCameraFrame !== void 0) s.startPanCameraFrame = startPanCameraFrame;
    if (startPanAngularRate !== void 0) s.startPanAngularRate = startPanAngularRate;
  }
  panStart({ pos }) {
    const { latitude, longitude, zoom, bearing = 0 } = this.getViewportProps();
    const cameraFrame = Globe.cameraFrame(longitude, latitude, bearing);
    if (this.getViewportProps().navigation === "map") {
      cameraFrame.axisHorizontal = [0, 0, 1];
      cameraFrame.axisVertical = Globe.cameraFrame(longitude, latitude, 0).axisVertical;
    }
    const scale = Math.pow(2, zoom - zoomAdjust(latitude, true));
    const angularRate = 0.25 / scale * DEGREES_TO_RADIANS;
    return this._getUpdatedState({
      startPanPos: pos,
      startPanCameraFrame: cameraFrame,
      startPanAngularRate: angularRate,
      startZoom: zoom
    });
  }
  pan({ pos, startPos }) {
    const state = this.getState();
    const startPanPos = state.startPanPos || startPos;
    if (!startPanPos) return this;
    const frame = state.startPanCameraFrame;
    const rate = state.startPanAngularRate;
    const startZoom = state.startZoom ?? this.getViewportProps().zoom;
    if (!frame || !rate) {
      return this;
    }
    const deltaX = startPanPos[0] - pos[0];
    const deltaY = startPanPos[1] - pos[1];
    const lockBearing = this.getViewportProps().navigation === "map";
    let horizontalAngle = deltaX * rate;
    let verticalAngle = -deltaY * rate;
    if (lockBearing) {
      const bearing = frame.bearing * DEGREES_TO_RADIANS;
      horizontalAngle = (deltaX * Math.cos(bearing) - deltaY * Math.sin(bearing)) * rate / Math.max(Math.cos(frame.latitude * DEGREES_TO_RADIANS), 0.25);
      verticalAngle = clamp(
        -(deltaX * Math.sin(bearing) + deltaY * Math.cos(bearing)) * rate,
        -(MAX_LATITUDE + frame.latitude) * DEGREES_TO_RADIANS,
        (MAX_LATITUDE - frame.latitude) * DEGREES_TO_RADIANS
      );
    }
    const rotated = Globe.rotateFrame(frame, horizontalAngle, verticalAngle, lockBearing);
    const zoom = startZoom + zoomAdjust(rotated.latitude, true) - zoomAdjust(frame.latitude, true);
    return this._getUpdatedState({
      longitude: rotated.longitude,
      latitude: rotated.latitude,
      bearing: rotated.bearing,
      zoom
    });
  }
  panEnd() {
    return this._getUpdatedState({
      startPanPos: null,
      startPanCameraFrame: null,
      startPanAngularRate: null,
      startZoom: null
    });
  }
  _panFromCenter(offset) {
    const { width, height } = this.getViewportProps();
    const center = [width / 2, height / 2];
    return this.panStart({ pos: center }).pan({ pos: [center[0] + offset[0], center[1] + offset[1]] }).panEnd();
  }
  applyConstraints(props) {
    const internalProps = props;
    const constraintAround = internalProps[CONSTRAINT_AROUND];
    delete internalProps[CONSTRAINT_AROUND];
    const { latitude, maxBounds } = props;
    props.zoom = this._constrainZoom(props.zoom, props);
    if (constraintAround) {
      const viewport = this.makeViewport(props);
      const { position, screenPosition } = constraintAround;
      if (!(viewport instanceof GlobeViewport) || props.navigation === "map") {
        Object.assign(
          props,
          viewport instanceof GlobeViewport ? viewport.panByPosition(position, screenPosition, void 0, true) : viewport.panByPosition(position, screenPosition)
        );
      } else {
        const anchorStrength = viewport.getZoomAnchorStrength(screenPosition);
        if (anchorStrength > 0) {
          const currentCoordinates = viewport.unproject(screenPosition);
          const cameraFrame = Globe.cameraFrame(
            props.longitude,
            props.latitude,
            props.bearing || 0
          );
          const rotatedFrame = Globe.rotateFrameToMatch(
            cameraFrame,
            [currentCoordinates[0], currentCoordinates[1]],
            [position[0], position[1]],
            anchorStrength
          );
          props.longitude = rotatedFrame.longitude;
          props.latitude = rotatedFrame.latitude;
          props.bearing = rotatedFrame.bearing;
        }
      }
    }
    if (props.longitude < -180 || props.longitude > 180) {
      props.longitude = mod(props.longitude + 180, 360) - 180;
    }
    if (props.bearing < -180 || props.bearing > 180) {
      props.bearing = mod(props.bearing + 180, 360) - 180;
    }
    const latitudeLimit = props.navigation === "map" ? MAX_LATITUDE : 90;
    props.latitude = clamp(props.latitude, -latitudeLimit, latitudeLimit);
    props.pitch = clamp(props.pitch, props.minPitch, props.maxPitch);
    const maxBoundsRect = maxBounds ? getMaxBoundsRect(props.width, props.height, props.maxBoundsPadding) : null;
    if (maxBounds && maxBoundsRect) {
      if (maxBoundsRect.width >= 0) {
        props.longitude = clamp(props.longitude, maxBounds[0][0], maxBounds[1][0]);
      }
      if (maxBoundsRect.height >= 0) {
        props.latitude = clamp(props.latitude, maxBounds[0][1], maxBounds[1][1]);
      }
    }
    if (maxBounds && maxBoundsRect) {
      const viewport = this.makeViewport({ ...props, bearing: 0, pitch: 0 });
      const screenExtents = getMaxBoundsExtents(
        viewport,
        [props.longitude, props.latitude],
        maxBoundsRect
      );
      const effectiveZoom = props.zoom - zoomAdjust(latitude);
      const lngSpan = maxBounds[1][0] - maxBounds[0][0];
      const latSpan = maxBounds[1][1] - maxBounds[0][1];
      if (maxBoundsRect.height >= 0 && latSpan > 0 && latSpan < 180) {
        const heightDegrees = Math.min(
          pixelsToDegrees(maxBoundsRect.height, effectiveZoom),
          latSpan
        );
        const bottomDegrees = maxBoundsRect.height ? heightDegrees * screenExtents.bottom / maxBoundsRect.height : pixelsToDegrees(screenExtents.bottom, effectiveZoom);
        const topDegrees = maxBoundsRect.height ? heightDegrees * screenExtents.top / maxBoundsRect.height : pixelsToDegrees(screenExtents.top, effectiveZoom);
        props.latitude = clamp(
          props.latitude,
          maxBounds[0][1] + bottomDegrees,
          maxBounds[1][1] - topDegrees
        );
      }
      if (maxBoundsRect.width >= 0 && lngSpan > 0 && lngSpan < 360) {
        const widthDegrees = Math.min(
          pixelsToDegrees(
            maxBoundsRect.width / Math.cos(props.latitude * DEGREES_TO_RADIANS),
            effectiveZoom
          ),
          lngSpan
        );
        const leftDegrees = maxBoundsRect.width ? widthDegrees * screenExtents.left / maxBoundsRect.width : pixelsToDegrees(
          screenExtents.left / Math.cos(props.latitude * DEGREES_TO_RADIANS),
          effectiveZoom
        );
        const rightDegrees = maxBoundsRect.width ? widthDegrees * screenExtents.right / maxBoundsRect.width : pixelsToDegrees(
          screenExtents.right / Math.cos(props.latitude * DEGREES_TO_RADIANS),
          effectiveZoom
        );
        props.longitude = clamp(
          props.longitude,
          maxBounds[0][0] + leftDegrees,
          maxBounds[1][0] - rightDegrees
        );
      }
    }
    props.latitude = clamp(props.latitude, -latitudeLimit, latitudeLimit);
    if (props.latitude !== latitude) {
      props.zoom += zoomAdjust(props.latitude, true) - zoomAdjust(latitude, true);
    }
    return props;
  }
  _constrainZoom(zoom, props) {
    props ||= this.getViewportProps();
    const { maxZoom, maxBounds } = props;
    let { minZoom } = props;
    const shouldApplyMaxBounds = maxBounds !== null && props.width > 0 && props.height > 0;
    if (shouldApplyMaxBounds) {
      const maxBoundsRect = getMaxBoundsRect(props.width, props.height, props.maxBoundsPadding);
      const minLatitude = maxBounds[0][1];
      const maxLatitude = maxBounds[1][1];
      const fitLatitude = Math.sign(minLatitude) === Math.sign(maxLatitude) ? Math.min(Math.abs(minLatitude), Math.abs(maxLatitude)) : 0;
      const ZOOM0 = zoomAdjust(0);
      const w = degreesToPixels(maxBounds[1][0] - maxBounds[0][0]) * Math.cos(fitLatitude * DEGREES_TO_RADIANS);
      const h = degreesToPixels(maxBounds[1][1] - maxBounds[0][1]);
      if (maxBoundsRect.width > 0 && w > 0) {
        minZoom = Math.max(minZoom, Math.log2(maxBoundsRect.width / w) + ZOOM0);
      }
      if (maxBoundsRect.height > 0 && h > 0) {
        minZoom = Math.max(minZoom, Math.log2(maxBoundsRect.height / h) + ZOOM0);
      }
      if (minZoom > maxZoom) minZoom = maxZoom;
    }
    const zoomAdjustment = zoomAdjust(props.latitude, true) - zoomAdjust(0, true);
    return clamp(zoom, minZoom + zoomAdjustment, maxZoom + zoomAdjustment);
  }
}
class GlobeController extends Controller {
  ControllerState = GlobeState;
  transition = {
    transitionDuration: 300,
    transitionInterpolator: new LinearInterpolator({
      transitionProps: {
        compare: ["longitude", "latitude", "zoom", "bearing", "pitch"],
        required: ["longitude", "latitude", "zoom"]
      }
    })
  };
  dragMode = "pan";
  // Ring buffer tracking globe position during pan for inertia velocity
  _panHistory = [];
  /** Update navigation policy without retaining gestures or inertia from the previous mode. */
  setProps(props) {
    const navigation = props.navigation || "map";
    const navigationChanged = this.props && navigation !== (this.props.navigation || "map");
    const oldViewState = navigationChanged ? new this.ControllerState({
      ...this.props,
      makeViewport: this.makeViewport
    }).getViewportProps() : void 0;
    if (navigationChanged) {
      this._panHistory = [];
      this._cancelInteraction();
      props = { ...props, transitionDuration: 0 };
    }
    super.setProps(props);
    if (navigationChanged) {
      this.updateViewport(
        new this.ControllerState({ ...props, makeViewport: this.makeViewport }),
        null,
        {},
        oldViewState
      );
    }
  }
  _onPanStart(event) {
    this._panHistory = [];
    return super._onPanStart(event);
  }
  _onMultiPanStart(event) {
    this._panHistory = [];
    return super._onMultiPanStart(event);
  }
  _onPanMove(event) {
    if (!this.dragPan) {
      return false;
    }
    const pos = this.getCenter(event);
    const newControllerState = this.controllerState.pan({ pos });
    this.updateViewport(
      newControllerState,
      { transitionDuration: 0 },
      {
        isDragging: true,
        isPanning: true
      }
    );
    const { longitude, latitude } = newControllerState.getViewportProps();
    this._panHistory.push({ longitude, latitude, timestamp: Date.now() });
    if (this._panHistory.length > 5) {
      this._panHistory.shift();
    }
    return true;
  }
  _onPanMoveEnd(event) {
    const { inertia } = this;
    if (this.dragPan && inertia && this._panHistory.length >= 2) {
      const first = this._panHistory[0];
      const last = this._panHistory[this._panHistory.length - 1];
      const dt = last.timestamp - first.timestamp;
      if (dt > 0) {
        const viewportProps = this.controllerState.getViewportProps();
        const angularDistance = Globe.angularDistance(first, last);
        const angularVelocity = angularDistance / dt;
        if (angularVelocity > 1e-6) {
          const totalAngle = angularVelocity * inertia / 2;
          let endLongitude;
          let endLatitude;
          let interpolator;
          if (viewportProps.navigation === "map") {
            const longitudeDelta = mod(last.longitude - first.longitude + 180, 360) - 180;
            endLongitude = viewportProps.longitude + longitudeDelta * inertia / (2 * dt);
            endLatitude = clamp(
              viewportProps.latitude + (last.latitude - first.latitude) * inertia / (2 * dt),
              -MAX_LATITUDE,
              MAX_LATITUDE
            );
            interpolator = new GlobeInertiaInterpolator({ targetLongitude: endLongitude });
          } else {
            const axis = Globe.greatCircleAxis(first, last);
            const currentFrame = Globe.cameraFrame(
              viewportProps.longitude,
              viewportProps.latitude,
              viewportProps.bearing || 0
            );
            const endFrame = Globe.rotateFrame(
              { ...currentFrame, axisHorizontal: axis },
              totalAngle,
              0
            );
            endLongitude = endFrame.longitude;
            endLatitude = clamp(endFrame.latitude, -90, 90);
            interpolator = new GlobeInertiaInterpolator({ axis, totalAngle });
          }
          const newControllerState2 = this.controllerState.panEnd();
          this.updateViewport(
            newControllerState2,
            {
              transitionInterpolator: interpolator,
              transitionDuration: inertia,
              transitionEasing: GLOBE_INERTIA_EASING,
              longitude: endLongitude,
              latitude: endLatitude
            },
            {
              isDragging: false,
              isPanning: true
            }
          );
          this._panHistory = [];
          return true;
        }
      }
    }
    this._panHistory = [];
    const newControllerState = this.controllerState.panEnd();
    this.updateViewport(newControllerState, null, {
      isDragging: false,
      isPanning: false
    });
    return true;
  }
}
export {
  GlobeController as default
};
