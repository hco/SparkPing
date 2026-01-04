# Device Identification Backend Migration

**Status:** Accepted  
**Date:** 2026-01-04

## Context

Device identification logic (parsing mDNS TXT records to extract device type, manufacturer, model, etc.) was implemented entirely in the frontend TypeScript code (`frontend/src/lib/deviceParser.ts`). This created several issues:

1. **Code duplication risk**: If we add other clients (CLI, mobile app), the parsing logic would need to be reimplemented.
2. **Heavy frontend**: ~1000 lines of parsing code in the frontend added bundle size.
3. **Inconsistent data model**: The frontend received raw discovery data and had to transform it, mixing concerns.
4. **Limited extensibility**: Adding new device parsers required frontend changes and redeployment.

## Decision

Move all device identification logic to the Rust backend. The backend now:

1. Parses mDNS TXT records to extract high-level device information (`DeviceInfo` struct):
   - `name`, `friendly_name`, `device_type`, `manufacturer`, `model`
   - `firmware_version`, `mac_address`, `icon_hint`
   - `primary_address`, `addresses`, `hostname`

2. Provides explicit discovery source tracking (`DiscoverySource` enum):
   - `Mdns { service_types }` - which mDNS services found this device
   - `IpScan { ports }` - which ports responded

3. Preserves raw discovery data (`RawDiscoveryData` struct) for detailed inspection:
   - Full service details, TXT properties, vendor info

4. Sends `IdentifiedDevice` (wrapping all above) to the frontend via SSE events.

The frontend now simply displays the backend-provided information without parsing logic.

## Consequences

**Easier:**
- Adding new device parsers only requires backend changes
- Frontend is simpler and lighter (~1000 lines removed)
- Consistent API for any future clients
- Better separation of concerns: backend handles data processing, frontend handles display
- Type-safe device information with clear structure

**More difficult:**
- Rust parsing code is more verbose than TypeScript
- Adding support for new devices requires Rust knowledge
- Backend must be recompiled to add new device parsers

---

## Alternatives Considered

### Option A: Keep frontend-only parsing
- Pros: No backend changes needed
- Cons: All the original issues remain
- Why rejected: Does not solve the core architecture problem

### Option B: Shared parsing library (WASM)
- Pros: Write once, run anywhere
- Cons: Complex build setup, performance overhead, still ships parsing code to frontend
- Why rejected: Over-engineered for our use case
