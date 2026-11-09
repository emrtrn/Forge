import type { Page } from "@playwright/test";

export const isOptionalSidecarUrl = (url: string) =>
  /\.(?:collision|materials|uvw|skeleton|vertexcolors|fracture|deformable)\.json(?:\?|$)/.test(url);

/** Expected missing sidecars use defaults. Keep all application/shader errors,
 * and classify Chrome's network line only after confirming that exact URL's 404. */
export function observeBrowserErrors(page: Page, ignoreFavicon = false): () => string[] {
  const errors: { message: string; url: string }[] = [], missing = new Set<string>();
  page.on("pageerror", error => errors.push({ message: error.message, url: "" }));
  page.on("response", response => {
    if (response.status() === 404 && isOptionalSidecarUrl(response.url())) missing.add(response.url());
  });
  page.on("console", message => {
    if (message.type() === "error") errors.push({ message: message.text(), url: message.location().url });
  });
  return () => errors.filter(error => !(missing.has(error.url) && /^Failed to load resource:.*404/.test(error.message))
    && !(ignoreFavicon && /\/favicon\.ico(?:\?|$)/.test(error.url))).map(error => error.message);
}
