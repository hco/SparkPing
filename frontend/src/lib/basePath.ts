/**
 * Detects the base path at runtime for Home Assistant ingress support.
 *
 * When running under ingress, the app is served at a subpath like:
 *   /api/hassio_ingress/<token>/...
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

const INGRESS_PREFIX = '/api/hassio_ingress/'

/**
 * Extracts `/api/hassio_ingress/<token>/` from a Home Assistant ingress URL.
 *
 * Examples:
 *   /api/hassio_ingress/abc123/            -> /api/hassio_ingress/abc123/
 *   /api/hassio_ingress/abc123/settings   -> /api/hassio_ingress/abc123/
 *   /api/hassio_ingress/abc123/targets/42 -> /api/hassio_ingress/abc123/
 */
function getIngressBasePath(pathname: string): string | null {
  if (!pathname.startsWith(INGRESS_PREFIX)) {
    return null
  }

  // Split and drop empty segments caused by leading/trailing slashes
  const segments = pathname.split('/').filter(Boolean)
  // Expected: ["api", "hassio_ingress", "<token>", ...]
  if (segments.length < 3) {
    return null
  }

  const [api, hassioIngress, token] = segments
  if (api !== 'api' || hassioIngress !== 'hassio_ingress' || !token) {
    return null
  }

  return `/${api}/${hassioIngress}/${token}/`
}

