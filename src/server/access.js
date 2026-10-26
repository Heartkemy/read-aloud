const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function parseAuthority(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(`http://${value}`)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url
  } catch {
    return null
  }
}

function canonicalOrigin(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    if (url.username || url.password || !url.host || (url.pathname && url.pathname !== '/') || url.search || url.hash) return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

function isLoopbackAddress(address) {
  const value = String(address ?? '').toLowerCase().replace(/^::ffff:/, '')
  return LOOPBACK_HOSTS.has(value)
}

/** Turns configured sidecar origins into exact, comparable values. */
export function normalizeAllowedOrigins(origins = []) {
  if (!Array.isArray(origins)) throw new TypeError('allowedOrigins must be an array of exact origins.')
  return new Set(
    origins.map((origin) => {
      const value = canonicalOrigin(origin)
      if (!value) throw new TypeError(`Invalid allowed origin: ${origin}`)
      return value
    }),
  )
}

/**
 * The supported service boundary is one local user. A Node request must have a
 * loopback peer and Host. Fetch runtimes cannot expose a peer, so their adapter
 * can validate only the URL authority and browser-origin contract.
 */
export function authorizeLocalRequest({
  host,
  origin,
  protocol,
  remoteAddress,
  fetchSite,
  allowedOrigins = [],
  requireLoopbackPeer = false,
} = {}) {
  const request = parseAuthority(host)
  const hostname = request?.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!request || !LOOPBACK_HOSTS.has(hostname)) {
    return { allowed: false, error: 'read-aloud only serves loopback hosts.' }
  }
  if (requireLoopbackPeer && !isLoopbackAddress(remoteAddress)) {
    return { allowed: false, error: 'read-aloud only accepts loopback connections.' }
  }

  const requestOrigin = canonicalOrigin(origin)
  if (origin && !requestOrigin) {
    return { allowed: false, error: 'read-aloud rejects malformed origins.' }
  }

  const approvedOrigins = allowedOrigins instanceof Set ? allowedOrigins : normalizeAllowedOrigins(allowedOrigins)
  if (requestOrigin) {
    const serviceOrigin = protocol === 'http:' || protocol === 'https:' ? `${protocol}//${request.host}` : null
    const sameOrigin = requestOrigin === serviceOrigin
    const approvedSidecar = approvedOrigins.has(requestOrigin)
    if (!sameOrigin && !approvedSidecar) {
      return { allowed: false, error: 'read-aloud rejects unapproved cross-origin requests.' }
    }
    return { allowed: true, corsOrigin: sameOrigin ? null : requestOrigin }
  }

  if (String(fetchSite ?? '').toLowerCase() === 'cross-site') {
    return { allowed: false, error: 'read-aloud rejects cross-site requests without an approved origin.' }
  }
  return { allowed: true, corsOrigin: null }
}
