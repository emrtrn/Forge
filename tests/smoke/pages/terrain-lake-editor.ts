import { SceneApp } from "@/scene/SceneApp";
import { EditorUi } from "@/editor/EditorUi";
import { saveLayoutViaDevEndpoint } from "@/editor/layoutSaver";
import { setGameEditorCatalog } from "@/editor/gameEditorRegistry";
import { GAME_EDITOR_CATALOG } from "@/game/editorCatalog";
import { installLakeProbe } from "./terrain-lake-probe";
setGameEditorCatalog(GAME_EDITOR_CATALOG);
const app = new SceneApp(document.querySelector("canvas")!, { enabled: true });
app.setLayoutSaver(saveLayoutViaDevEndpoint); new EditorUi(app); installLakeProbe(app); app.start();
