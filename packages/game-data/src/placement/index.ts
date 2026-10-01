/**
 * The build catalogue, in one import.
 *
 * Two modules, deliberately split: `schema.ts` is the *rules* - what a catalogue entry may say and
 * what makes a catalogue valid - and `catalog.ts` is the *content* - the rows the game ships. The
 * split exists because the content has to import the rules, and a single module that both defined the
 * schema and re-exported its own consumer initialised the schema after the catalogue that needed it.
 */
export * from "./schema";
export * from "./catalog";
export * from "./gameplay";
