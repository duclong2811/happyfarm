/**
 * Pre-rendered portraits of the character roster, one per id, rendered from the shipped models.
 *
 * Explicit imports rather than a glob, like every other asset table in the client, so a missing
 * portrait is a build error and the bundle names exactly what ships.
 */
import PlayerFarmerPortrait from "./assets/ui/characters/player_farmer.webp?url";
import KenneyFemaleAPortrait from "./assets/ui/characters/kenney_female_a.webp?url";
import KenneyFemaleBPortrait from "./assets/ui/characters/kenney_female_b.webp?url";
import KenneyFemaleCPortrait from "./assets/ui/characters/kenney_female_c.webp?url";
import KenneyFemaleDPortrait from "./assets/ui/characters/kenney_female_d.webp?url";
import KenneyFemaleEPortrait from "./assets/ui/characters/kenney_female_e.webp?url";
import KenneyFemaleFPortrait from "./assets/ui/characters/kenney_female_f.webp?url";
import KenneyMaleBPortrait from "./assets/ui/characters/kenney_male_b.webp?url";
import KenneyMaleCPortrait from "./assets/ui/characters/kenney_male_c.webp?url";
import KenneyMaleDPortrait from "./assets/ui/characters/kenney_male_d.webp?url";
import KenneyMaleEPortrait from "./assets/ui/characters/kenney_male_e.webp?url";
import KenneyMaleFPortrait from "./assets/ui/characters/kenney_male_f.webp?url";
import KenneyMaleGPortrait from "./assets/ui/characters/kenney_male_g.webp?url";
import KenneyWorkerPortrait from "./assets/ui/characters/kenney_worker.webp?url";
import KenneyKnightPortrait from "./assets/ui/characters/kenney_knight.webp?url";
import KenneyRobotPortrait from "./assets/ui/characters/kenney_robot.webp?url";
import KenneyAlienPortrait from "./assets/ui/characters/kenney_alien.webp?url";

export const CHARACTER_PORTRAITS: ReadonlyMap<string, string> = new Map([
  ["character.player_farmer", PlayerFarmerPortrait],
  ["character.kenney_female_a", KenneyFemaleAPortrait],
  ["character.kenney_female_b", KenneyFemaleBPortrait],
  ["character.kenney_female_c", KenneyFemaleCPortrait],
  ["character.kenney_female_d", KenneyFemaleDPortrait],
  ["character.kenney_female_e", KenneyFemaleEPortrait],
  ["character.kenney_female_f", KenneyFemaleFPortrait],
  ["character.kenney_male_b", KenneyMaleBPortrait],
  ["character.kenney_male_c", KenneyMaleCPortrait],
  ["character.kenney_male_d", KenneyMaleDPortrait],
  ["character.kenney_male_e", KenneyMaleEPortrait],
  ["character.kenney_male_f", KenneyMaleFPortrait],
  ["character.kenney_male_g", KenneyMaleGPortrait],
  ["character.kenney_worker", KenneyWorkerPortrait],
  ["character.kenney_knight", KenneyKnightPortrait],
  ["character.kenney_robot", KenneyRobotPortrait],
  ["character.kenney_alien", KenneyAlienPortrait]
]);
