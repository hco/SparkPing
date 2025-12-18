import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getBasePath } from './basePath'

describe('getBasePath', () => {
  beforeEach(() => {
    // Reset window.location before each test
    vi.stubGlobal('window', {
      location: {
        pathname: '/',
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns "/" for root path', () => {
    vi.stubGlobal('window', {
      location: {
        pathname: '/',
      },
    })

    expect(getBasePath()).toBe('/')
  })

  it('returns the ingress base path for Home Assistant ingress URLs', () => {
    vi.stubGlobal('window', {
      location: {
        pathname: '/api/hassio_ingress/crmYVg9cOH54X26ulJomu-i5S2cuvhhyYzdQOxpjQF8',
      },
    })

    expect(getBasePath()).toBe('/api/hassio_ingress/crmYVg9cOH54X26ulJomu-i5S2cuvhhyYzdQOxpjQF8/')
  })

  it('returns the ingress base path for Home Assistant ingress URLs with a different id', () => {
    vi.stubGlobal('window', {
      location: {
        pathname: '/api/hassio_ingress/secondThingy-i5S2cuvhhyYzdQOxpjQF8',
      },
    })

    expect(getBasePath()).toBe('/api/hassio_ingress/secondThingy-i5S2cuvhhyYzdQOxpjQF8/')
  })

  it('returns the ingress base path when pathname has trailing slash', () => {
    vi.stubGlobal('window', {
      location: {
        pathname: '/api/hassio_ingress/crmYVg9cOH54X26ulJomu-i5S2cuvhhyYzdQOxpjQF8/',
      },
    })

    expect(getBasePath()).toBe('/api/hassio_ingress/crmYVg9cOH54X26ulJomu-i5S2cuvhhyYzdQOxpjQF8/')
  })

  it('returns the ingress base path when pathname has subpaths', () => {
    vi.stubGlobal('window', {
      location: {
        pathname: '/api/hassio_ingress/crmYVg9cOH54X26ulJomu-i5S2cuvhhyYzdQOxpjQF8/settings',
      },
    })

    expect(getBasePath()).toBe('/api/hassio_ingress/crmYVg9cOH54X26ulJomu-i5S2cuvhhyYzdQOxpjQF8/')
  })

  it('returns the ingress base path when pathname has deep subpaths', () => {
    vi.stubGlobal('window', {
      location: {
        pathname: '/api/hassio_ingress/crmYVg9cOH54X26ulJomu-i5S2cuvhhyYzdQOxpjQF8/targets/42',
      },
    })

    expect(getBasePath()).toBe('/api/hassio_ingress/crmYVg9cOH54X26ulJomu-i5S2cuvhhyYzdQOxpjQF8/')
  })

  it('returns "/" for non-ingress paths', () => {
    vi.stubGlobal('window', {
      location: {
        pathname: '/settings',
      },
    })

    expect(getBasePath()).toBe('/')
  })

  it('returns "/" for incomplete ingress paths', () => {
    vi.stubGlobal('window', {
      location: {
        pathname: '/api/hassio_ingress/',
      },
    })

    expect(getBasePath()).toBe('/')
  })
})

