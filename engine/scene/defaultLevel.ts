import type { RoomLayout } from "./layout";
import { resolveSkyAtmosphere } from "./skyAtmosphere";
import { resolveHeightFog } from "./heightFog";
import { resolveCloudLayer } from "./cloudLayer";
import { resolvePostProcess } from "./postProcess";
import { resolveWorldEnvironment } from "../environment/worldEnvironment";

// Authored starter snapshot. Editing a level never changes future new levels.
// Keep creation presets separate from resolver fallbacks so existing sparse
// levels retain their authored appearance.
const starter: RoomLayout = {
  "schema": 1,
  "name": "WorldBuildTest",
  "loadGroups": [],
  "instances": [
    {
      "assetId": "floor-400x400",
      "placements": [
        {
          "position": [
            -2,
            0,
            -2
          ],
          "rotationYDeg": 0,
          "scale": 1
        }
      ]
    },
    {
      "assetId": "shape:cube",
      "placements": [
        {
          "position": [
            0,
            0.5,
            0
          ],
          "name": "Cube",
          "scaleLocked": true,
          "rotationYDeg": 0,
          "scale": 2
        }
      ]
    }
  ],
  "characters": [],
  "worldSettings": {
    "staticObjectsCastShadow": true
  },
  "skyAtmosphere": {
    "rayleigh": 1,
    "turbidity": 2,
    "mie": 0.003
  },
  "heightFog": {
    "density": 0.001
  },
  "cloudLayer": {
    "coverage": 0.4,
    "density": 0.4,
    "softness": 0.4,
    "speed": 0.1
  },
  "postProcess": {
    "antialias": "smaa",
    "bloom": {
      "enabled": true,
      "threshold": 1,
      "intensity": 1,
      "radius": 1
    },
    "ao": {
      "enabled": true,
      "radius": 1,
      "intensity": 1
    }
  },
  "worldEnvironment": {
    "time": {
      "hour": 10,
      "dayLengthMinutes": 1
    },
    "sunPath": {
      "azimuthDeg": 96.056,
      "noonElevationDeg": 60
    },
    "night": {
      "moonIntensity": 0.1,
      "moonShadowStrength": 0.5,
      "moonAngularDiameterDeg": 2,
      "moonBrightness": 2,
      "ambientFloor": 0.2,
      "ambientIntensity": 0.3
    }
  },
  "lights": [
    {
      "id": "sun",
      "type": "directional",
      "position": [
        3,
        9,
        4
      ],
      "name": "Sun",
      "rotation": [
        -55,
        35,
        0
      ],
      "color": "#ffffff",
      "intensity": 2,
      "castShadow": true,
      "cascadedShadows": true
    }
  ]
};

const environmentActors = {
  skyAtmosphere: resolveSkyAtmosphere(starter.skyAtmosphere),
  heightFog: resolveHeightFog(starter.heightFog),
  cloudLayer: resolveCloudLayer(starter.cloudLayer),
  postProcess: resolvePostProcess(starter.postProcess),
  worldEnvironment: resolveWorldEnvironment(starter.worldEnvironment),
};

/** Fresh authored settings for an actor added to any level. */
export function createDefaultEnvironmentActor<K extends keyof typeof environmentActors>(
  kind: K,
): (typeof environmentActors)[K] {
  return structuredClone(environmentActors[kind]);
}

/** New levels share the starter look, with independent data and their own name. */
export function createDefaultLevel(name: string): RoomLayout {
  return { ...structuredClone(starter), ...structuredClone(environmentActors), name };
}
