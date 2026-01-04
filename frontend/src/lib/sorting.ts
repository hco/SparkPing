export type SortField = 'name' | 'ip'

/**
 * Compare two IP addresses for sorting.
 * Supports both IPv4 and IPv6 addresses.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
export function compareIpAddresses(a: string, b: string): number {
  const aIsV6 = a.includes(':')
  const bIsV6 = b.includes(':')

  // IPv4 addresses sort before IPv6
  if (aIsV6 !== bIsV6) {
    return aIsV6 ? 1 : -1
  }

  if (!aIsV6) {
    // IPv4 comparison
    const aParts = a.split('.').map((p) => parseInt(p, 10))
    const bParts = b.split('.').map((p) => parseInt(p, 10))
    if (aParts.length === 4 && bParts.length === 4) {
      for (let i = 0; i < 4; i++) {
        if (aParts[i] !== bParts[i]) {
          return aParts[i] - bParts[i]
        }
      }
      return 0
    }
  } else {
    // IPv6 comparison - expand and compare segment by segment
    const expandV6 = (addr: string): number[] => {
      // Handle IPv4-mapped IPv6 (::ffff:192.168.1.1)
      const v4Match = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
      if (v4Match) {
        const v4Parts = v4Match[1].split('.').map((p) => parseInt(p, 10))
        return [0, 0, 0, 0, 0, 0xffff, (v4Parts[0] << 8) | v4Parts[1], (v4Parts[2] << 8) | v4Parts[3]]
      }

      // Split on :: to handle zero compression
      const halves = addr.split('::')
      let segments: number[] = []

      if (halves.length === 2) {
        const left = halves[0] ? halves[0].split(':').map((s) => parseInt(s, 16)) : []
        const right = halves[1] ? halves[1].split(':').map((s) => parseInt(s, 16)) : []
        const missing = 8 - left.length - right.length
        segments = [...left, ...Array(missing).fill(0), ...right]
      } else {
        segments = addr.split(':').map((s) => parseInt(s, 16))
      }

      return segments.length === 8 ? segments : []
    }

    const aSegs = expandV6(a)
    const bSegs = expandV6(b)

    if (aSegs.length === 8 && bSegs.length === 8) {
      for (let i = 0; i < 8; i++) {
        if (aSegs[i] !== bSegs[i]) {
          return aSegs[i] - bSegs[i]
        }
      }
      return 0
    }
  }

  // Fallback to string comparison
  return a.localeCompare(b)
}
