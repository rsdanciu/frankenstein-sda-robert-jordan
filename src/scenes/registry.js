import { PlaceholderScene } from './PlaceholderScene.js';
import IngolstadtScene from './locations/ingolstadt.js';
import RuralGermanyScene from './locations/ruralGermany.js';
import GenevaMountainsScene from './locations/genevaMountains.js';
import ScotlandScene from './locations/scotland.js';
import PathToRuralRussiaScene from './locations/pathToRuralRussia.js';
import ArcticWaltonsBoatScene from './locations/arcticWaltonsBoat.js';

// world.json location id → scene class. Keys must match the ids in world.json
// (which are also the scene JSON file names). Unknown ids fall back to the placeholder.
export const SCENES = {
  ingolstadt: IngolstadtScene,
  ruralGermany: RuralGermanyScene,
  genevaMountains: GenevaMountainsScene,
  scotland: ScotlandScene,
  pathToRuralRussia: PathToRuralRussiaScene,
  arcticWaltonsBoat: ArcticWaltonsBoatScene,
};

export function sceneClassFor(id) {
  return SCENES[id] ?? PlaceholderScene;
}
