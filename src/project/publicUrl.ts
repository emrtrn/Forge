/** Resolve authored public-relative paths against the build's deployment base. */
export function publicFileUrl(path: string, base: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${base.endsWith("/") ? base : `${base}/`}${normalized}`;
}
