/**
 * `?url` imports are a Vite feature: the bundler copies the file into the build and hands back its
 * final URL. Declared narrowly here instead of pulling in `vite/client`, whose DOM and `ImportMeta`
 * declarations would apply to the whole monorepo, including the Worker.
 */
declare module "*.glb?url" {
  const url: string;
  export default url;
}