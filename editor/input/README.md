# Editor Input

Editor DOM input helpers live here.

Current files:

- `bindings.ts`: editor-only DOM listener wiring for pointer, keyboard,
  drag/drop, wheel, and cleanup.
- `keyboard.ts`: keyboard-code filters and editable-target guards for editor controls.
- `editorCameraController.ts`: viewport camera fly/orbit/pan/dolly navigation.
- `editorCameraPose.ts`: per-level viewport pose persistence across editor reloads.

Rules:

- This folder may use browser DOM APIs.
- Runtime game code must not import this folder.
- Pure editor state helpers belong in `editor/core`, not here.
