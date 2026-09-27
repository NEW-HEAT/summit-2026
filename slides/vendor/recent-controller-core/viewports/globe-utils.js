import { clamp, vec3, Quaternion } from "@math.gl/core";
import TransitionInterpolator from "../transitions/transition-interpolator";
import { zoomAdjust } from "./globe-viewport";
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
class Globe {
  /** Convert (lng, lat) in degrees to a unit-sphere position */
  static toPosition(lng, lat) {
    const phi = lat * DEGREES_TO_RADIANS;
    const lam = lng * DEGREES_TO_RADIANS;
    const cp = Math.cos(phi);
    return [cp * Math.cos(lam), cp * Math.sin(lam), Math.sin(phi)];
  }
  /** Convert a unit-sphere position to [lng, lat] in degrees */
  static toLngLat(v) {
    return [
      Math.atan2(v[1], v[0]) * RADIANS_TO_DEGREES,
      Math.asin(clamp(v[2], -1, 1)) * RADIANS_TO_DEGREES
    ];
  }
  /** North and East tangent vectors at a given (lng, lat) */
  static tangentBasis(lng, lat) {
    const phi = lat * DEGREES_TO_RADIANS;
    const lam = lng * DEGREES_TO_RADIANS;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    const sl = Math.sin(lam);
    const cl = Math.cos(lam);
    return {
      N: [-sp * cl, -sp * sl, cp],
      E: [-sl, cl, 0]
    };
  }
  /** Camera "up" direction on the unit sphere for a given bearing */
  static upVector(lng, lat, bearing) {
    const { N, E } = Globe.tangentBasis(lng, lat);
    const b = bearing * DEGREES_TO_RADIANS;
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    return [N[0] * cb + E[0] * sb, N[1] * cb + E[1] * sb, N[2] * cb + E[2] * sb];
  }
  /** Bearing (degrees) from a camera up vector at a given lng/lat */
  static bearing(upVector, lng, lat) {
    const { N, E } = Globe.tangentBasis(lng, lat);
    return Math.atan2(vec3.dot(upVector, E), vec3.dot(upVector, N)) * RADIANS_TO_DEGREES;
  }
  /** Camera frame for panning at a given position/bearing */
  static cameraFrame(lng, lat, bearing) {
    const position = Globe.toPosition(lng, lat);
    const up = Globe.upVector(lng, lat, bearing);
    const { N, E } = Globe.tangentBasis(lng, lat);
    const b = bearing * DEGREES_TO_RADIANS;
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    const right = [E[0] * cb - N[0] * sb, E[1] * cb - N[1] * sb, E[2] * cb - N[2] * sb];
    return {
      position,
      up,
      axisHorizontal: vec3.cross([], position, right),
      axisVertical: vec3.cross([], position, up),
      longitude: lng,
      latitude: lat,
      bearing
    };
  }
  /** Angular distance in radians between two lng/lat points (great circle arc) */
  static angularDistance(a, b) {
    const pa = Globe.toPosition(a.longitude, a.latitude);
    const pb = Globe.toPosition(b.longitude, b.latitude);
    return Math.acos(clamp(vec3.dot(pa, pb), -1, 1));
  }
  /** Normalized rotation axis of the great circle between two lng/lat points */
  static greatCircleAxis(a, b) {
    const pa = Globe.toPosition(a.longitude, a.latitude);
    const pb = Globe.toPosition(b.longitude, b.latitude);
    return vec3.normalize([], vec3.cross([], pa, pb));
  }
  /** Rotate a vector around a unit axis by an angle (radians) using quaternions */
  static rotate(v, axis, angle) {
    const q = new Quaternion().fromAxisRotation(axis, angle);
    return vec3.transformQuat([], v, q);
  }
  /**
   * Rotate a camera frame by horizontal/vertical angles (radians).
   * Returns a new frame with updated position, up, longitude, latitude,
   * and bearing. If lockBearing is true, preserve the input bearing and rebuild
   * the up vector at the new position to match it.
   */
  static rotateFrame(frame, horizontalAngle, verticalAngle, lockBearing) {
    let position = Globe.rotate(frame.position, frame.axisHorizontal, horizontalAngle);
    position = Globe.rotate(position, frame.axisVertical, verticalAngle);
    const [longitude, latitude] = Globe.toLngLat(position);
    let up;
    let bearing;
    if (lockBearing) {
      bearing = frame.bearing;
      up = Globe.upVector(longitude, latitude, bearing);
    } else {
      up = Globe.rotate(frame.up, frame.axisHorizontal, horizontalAngle);
      up = Globe.rotate(up, frame.axisVertical, verticalAngle);
      bearing = Globe.bearing(up, longitude, latitude);
    }
    return {
      ...frame,
      // preserve axes
      position,
      up,
      longitude,
      latitude,
      bearing
    };
  }
  /**
   * Rotate a camera frame so one globe position moves toward another.
   * The position and camera up vector share one rigid-body rotation, allowing
   * bearing to evolve continuously as the camera moves around the sphere.
   */
  static rotateFrameToMatch(frame, currentCoordinates, targetCoordinates, strength = 1) {
    const currentPosition = Globe.toPosition(...currentCoordinates);
    const targetPosition = Globe.toPosition(...targetCoordinates);
    let rotationAxis = vec3.cross([], currentPosition, targetPosition);
    const axisLength = vec3.len(rotationAxis);
    const cosine = clamp(vec3.dot(currentPosition, targetPosition), -1, 1);
    if (axisLength < 1e-12) {
      if (cosine > 0) {
        return frame;
      }
      rotationAxis = vec3.cross([], currentPosition, frame.up);
      if (vec3.len(rotationAxis) < 1e-12) {
        rotationAxis = vec3.cross([], currentPosition, frame.axisVertical);
      }
    }
    vec3.normalize(rotationAxis, rotationAxis);
    const angle = Math.atan2(axisLength, cosine) * clamp(strength, 0, 1);
    const position = Globe.rotate(frame.position, rotationAxis, angle);
    const up = Globe.rotate(frame.up, rotationAxis, angle);
    const [longitude, latitude] = Globe.toLngLat(position);
    return {
      ...frame,
      position,
      up,
      longitude,
      latitude,
      bearing: Globe.bearing(up, longitude, latitude)
    };
  }
}
const INERTIA_DECAY = 5;
const INERTIA_NORM = 1 / (1 - Math.exp(-INERTIA_DECAY));
const GLOBE_INERTIA_EASING = (t) => (1 - Math.exp(-INERTIA_DECAY * t)) * INERTIA_NORM;
class GlobeInertiaInterpolator extends TransitionInterpolator {
  _mode;
  _targetLongitude;
  _axis;
  _totalAngle;
  _startFrame;
  _startZoom;
  constructor(opts) {
    const isRotation = "axis" in opts;
    super({
      compare: ["longitude", "latitude"],
      extract: isRotation ? ["longitude", "latitude", "zoom", "bearing"] : ["longitude", "latitude", "zoom"],
      required: ["longitude", "latitude"]
    });
    if (isRotation) {
      this._mode = "rotation";
      this._axis = opts.axis;
      this._totalAngle = opts.totalAngle;
    } else {
      this._mode = "linear";
      this._targetLongitude = opts.targetLongitude;
    }
  }
  initializeProps(startProps, endProps) {
    const result = super.initializeProps(startProps, endProps);
    this._startZoom = startProps.zoom;
    if (this._mode === "rotation") {
      this._startFrame = {
        ...Globe.cameraFrame(startProps.longitude, startProps.latitude, startProps.bearing || 0),
        axisHorizontal: this._axis
      };
    } else {
      result.end.longitude = this._targetLongitude;
    }
    return result;
  }
  interpolateProps(startProps, endProps, t) {
    if (this._mode === "rotation") {
      const { longitude: longitude2, latitude: latitude2, bearing } = Globe.rotateFrame(
        this._startFrame,
        this._totalAngle * t,
        0
      );
      const zoom2 = this._startZoom + zoomAdjust(latitude2, true) - zoomAdjust(this._startFrame.latitude, true);
      return { bearing, longitude: longitude2, latitude: latitude2, zoom: zoom2 };
    }
    const longitude = startProps.longitude + (endProps.longitude - startProps.longitude) * t;
    const latitude = startProps.latitude + (endProps.latitude - startProps.latitude) * t;
    const zoom = this._startZoom + zoomAdjust(latitude, true) - zoomAdjust(startProps.latitude, true);
    return { longitude, latitude, zoom };
  }
}
export {
  GLOBE_INERTIA_EASING,
  Globe,
  GlobeInertiaInterpolator
};
