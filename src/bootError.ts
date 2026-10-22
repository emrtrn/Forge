/** Last-resort boot UI: no renderer, project, or game modules are required. */
export function showBootError(error: unknown): void {
  console.error("[boot] Unable to start Forge:", error);

  const message = error instanceof Error ? error.message : String(error);
  const unsupportedGraphics = /WebGL2 is not supported|Error creating WebGL context/i.test(message);
  const root = document.createElement("section");
  root.className = "forge-boot-error";
  root.setAttribute("role", "alert");
  root.setAttribute("aria-labelledby", "forge-boot-error-title");
  root.tabIndex = -1;

  const panel = document.createElement("div");
  panel.className = "forge-boot-error-panel";
  const title = document.createElement("h1");
  title.id = "forge-boot-error-title";
  title.textContent = "Unable to start Forge";
  const explanation = document.createElement("p");
  explanation.textContent = unsupportedGraphics
    ? "Forge needs WebGL2 to display the scene. Enable hardware acceleration in your browser, or try a browser or device that supports WebGL2."
    : "Forge could not finish starting. Check your connection and reload the page. If the problem continues, share the error details below.";

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Error details";
  const diagnostic = document.createElement("pre");
  diagnostic.textContent = message;
  details.append(summary, diagnostic);

  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload page";
  reload.addEventListener("click", () => location.reload());
  panel.append(title, explanation, details, reload);
  root.append(panel);

  // A partially constructed app must not keep keyboard focus behind the error.
  for (const child of document.body.children) {
    if (child instanceof HTMLElement) child.inert = true;
  }
  document.body.append(root);
  root.focus();
}
