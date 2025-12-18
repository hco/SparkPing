/**
 * Detects the base path at runtime for Home Assistant ingress support.
 *
 * When running under ingress, the app is served at a subpath like:
 *   /hassio/ingress/c215bba4_sparkping/...
 *
 * In standalone mode, it's served at the root: /
 *
 * @returns The base path (always ends with /, or is exactly "/")
 */
export function getBasePath(): string {
  const pathname = window.location.pathname

  const ingressBase = getIngressBasePath(pathname)
  if (ingressBase) {
    return ingressBase
  }

  // Default: standalone mode at root
  return '/'
}

const INGRESS_PREFIX = '/hassio/ingress/'

/**
 * Extracts `/hassio/ingress/<id>/` from a Home Assistant ingress URL.
 *
 * Examples:
 *   /hassio/ingress/abc123/            -> /hassio/ingress/abc123/
 *   /hassio/ingress/abc123/settings   -> /hassio/ingress/abc123/
 *   /hassio/ingress/abc123/targets/42 -> /hassio/ingress/abc123/
 */
function getIngressBasePath(pathname: string): string | null {
  if (!pathname.startsWith(INGRESS_PREFIX)) {
    return null
  }

  // Split and drop empty segments caused by leading/trailing slashes
  const segments = pathname.split('/').filter(Boolean)
  // Expected: ["hassio", "ingress", "<id>", ...]
  if (segments.length < 3) {
    return null
  }

  const [hassio, ingress, id] = segments
  if (hassio !== 'hassio' || ingress !== 'ingress' || !id) {
    return null
  }

  return `/${hassio}/${ingress}/${id}/`
}

