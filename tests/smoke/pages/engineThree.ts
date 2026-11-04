// The three.js module instance the engine runs on, for `page.evaluate` code.
// Vite rewrites this bare import to the current dependency URL. A hard-coded
// `/node_modules/.vite/deps/three.js` is a leftover bundle from `npm run editor`,
// not what the smoke server serves: possibly another three version altogether.
export * from "three";
