import View from "./view";
import GlobeViewport from "../viewports/globe-viewport";
import WebMercatorViewport from "../viewports/web-mercator-viewport";
import GlobeController from "../controllers/globe-controller";
const GLOBE_VIEW_DEFAULT_PARAMETERS = {
  cullMode: "back"
};
class GlobeView extends View {
  static displayName = "GlobeView";
  constructor(props = {}) {
    super({
      ...props,
      parameters: {
        ...GLOBE_VIEW_DEFAULT_PARAMETERS,
        ...props.parameters
      }
    });
  }
  getViewportType(viewState) {
    return viewState.zoom > 12 ? WebMercatorViewport : GlobeViewport;
  }
  get ControllerType() {
    return GlobeController;
  }
  /** Resolve navigation explicitly so saved view state cannot override the default. */
  get controller() {
    const controller = super.controller;
    return controller && { ...controller, navigation: controller.navigation ?? "map" };
  }
}
export {
  GlobeView as default
};
