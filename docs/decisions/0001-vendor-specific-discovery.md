# Vendor-Specific Device Discovery

**Status:** Accepted  
**Date:** 2026-01-03

## Context

The mDNS discovery provides basic device information, but different vendors expose richer device data through their own APIs. For example:
- Sonos speakers have HTTP endpoints that return detailed device info (zone name, model, serial number)
- Shelly smart home devices include model codes in their mDNS TXT records

We needed a way to enrich discovered devices with vendor-specific information while keeping the discovery system extensible for future vendors.

## Decision

### 1. VendorInfo Architecture

We introduced a `VendorInfo` enum in Rust that can hold vendor-specific data structures:

```rust
pub enum VendorInfo {
    Sonos(SonosInfo),
    // Future vendors can be added here
}
```

This enum is part of the `DiscoveredDevice` struct as an optional field, allowing devices to have rich vendor data when available.

### 2. Sonos Discovery Strategy

For Sonos devices (identified by `_sonos._tcp.local.` service type):
- Fetch `http://{ip}:1400/status/zp` for zone player info
- Fetch `http://{ip}:1400/xml/device_description.xml` for device description
- Use **zone_name from `/status/zp`** as the device name (contains stereo setup info like "(L)" or "(R)")
- Use **model_name from `/xml/device_description.xml`** as the device model (e.g., "Era 300")
- Do NOT use `roomName` from device_description.xml as it lacks stereo position info

### 3. Shelly Discovery Strategy

For Shelly devices (identified by `_shelly._tcp.local.` service type):
- Extract info directly from mDNS TXT records (no HTTP requests needed)
- TXT properties include: `app` (model code), `gen` (generation), `ver` (firmware version)
- Map app codes to human-readable names (e.g., "PlugSG3" → "Plug S Gen 3")
- Always set manufacturer to "Shelly" when this service type is present

### 4. Frontend Device Parser

Service type parsers are registered for each vendor:
- `_sonos._tcp.local.` → Sonos parser (also uses VendorInfo when available)
- `_shelly._tcp.local.` → Shelly parser (extracts from TXT records)

VendorInfo takes priority over mDNS TXT records when parsing device information.

## Consequences

**Easier:**
- Adding new vendor support is straightforward: add a variant to `VendorInfo`, implement fetch logic, add frontend parser
- Device names and models are more accurate and user-friendly
- Stereo speaker pairs show correct L/R designation

**More difficult:**
- Each vendor requires custom implementation (fetch logic, XML/JSON parsing, frontend parser)
- Network requests to device APIs add latency to discovery
- Need to handle cases where vendor API is unavailable (device offline, firewall blocking)

---

## Alternatives Considered

### Option A: Generic Key-Value Store for Vendor Data

Store all vendor data as `HashMap<String, String>` instead of typed structs.

- Pros: More flexible, no need to update enum for each vendor
- Cons: No type safety, harder to work with in frontend, can't have nested structures
- Why rejected: Type safety and clear data contracts are more valuable for maintainability

### Option B: Fetch All Vendor Data via HTTP

Even for Shelly devices, fetch additional data from their HTTP API.

- Pros: Could get even more detailed information
- Cons: Unnecessary network requests when mDNS TXT records already have the needed data
- Why rejected: Shelly TXT records contain sufficient info; HTTP fetch would add latency without benefit
