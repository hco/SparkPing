//! Sonos-specific device discovery.
//!
//! This module fetches additional information from Sonos speakers via their
//! local HTTP API at port 1400.

use quick_xml::de::from_str;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::{debug, warn};

/// The port used by Sonos speakers for their local API
const SONOS_API_PORT: u16 = 1400;

/// The endpoint for zone player status information (has zone name with L/R stereo info)
const SONOS_STATUS_ENDPOINT: &str = "/status/zp";

/// The endpoint for device description (has model name and other device details)
const SONOS_DEVICE_DESC_ENDPOINT: &str = "/xml/device_description.xml";

/// Parsed Sonos device information
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SonosInfo {
    /// The zone/room name configured on the speaker (includes L/R for stereo pairs)
    pub zone_name: String,
    /// Hardware serial number
    pub serial_number: Option<String>,
    /// Software version
    pub software_version: Option<String>,
    /// Hardware version
    pub hardware_version: Option<String>,
    /// Series ID (product identifier code like "A101")
    pub series_id: Option<String>,
    /// IP address as reported by the device
    pub ip_address: Option<String>,
    /// MAC address
    pub mac_address: Option<String>,
    /// Local UID (unique identifier like "RINCON_...")
    pub local_uid: Option<String>,
    /// Household control ID
    pub household_id: Option<String>,
    /// Model name (e.g., "Era 300", "Five", "Beam")
    pub model_name: Option<String>,
    /// Model number (e.g., "S41", "S23")
    pub model_number: Option<String>,
    /// Model URL (product page)
    pub model_url: Option<String>,
    /// API version
    pub api_version: Option<String>,
    /// Display version (user-friendly version like "17.7")
    pub display_version: Option<String>,
    /// Zone type code
    pub zone_type: Option<u32>,
    /// Icon URL path (e.g., "/img/icon-S41.png")
    pub icon_url: Option<String>,
}

// ============================================================================
// Zone Player Status XML structures (/status/zp)
// ============================================================================

/// XML structure for Sonos ZP status response
#[derive(Debug, Deserialize)]
#[serde(rename = "ZPSupportInfo")]
struct ZPSupportInfo {
    #[serde(rename = "ZPInfo")]
    zp_info: ZPInfo,
}

/// Zone player info from XML
#[derive(Debug, Deserialize)]
#[serde(rename = "ZPInfo")]
struct ZPInfo {
    #[serde(rename = "ZoneName")]
    zone_name: String,
    #[serde(rename = "LocalUID", default)]
    local_uid: Option<String>,
    #[serde(rename = "SerialNumber", default)]
    serial_number: Option<String>,
    #[serde(rename = "SoftwareVersion", default)]
    software_version: Option<String>,
    #[serde(rename = "HardwareVersion", default)]
    hardware_version: Option<String>,
    #[serde(rename = "SeriesID", default)]
    series_id: Option<String>,
    #[serde(rename = "IPAddress", default)]
    ip_address: Option<String>,
    #[serde(rename = "MACAddress", default)]
    mac_address: Option<String>,
    #[serde(rename = "HouseholdControlID", default)]
    household_id: Option<String>,
}

// ============================================================================
// Device Description XML structures (/xml/device_description.xml)
// ============================================================================

/// Root element of device description XML
#[derive(Debug, Deserialize)]
#[serde(rename = "root")]
struct DeviceDescRoot {
    device: DeviceDescDevice,
}

/// Device element in device description
#[derive(Debug, Deserialize)]
struct DeviceDescDevice {
    #[serde(rename = "modelName", default)]
    model_name: Option<String>,
    #[serde(rename = "modelNumber", default)]
    model_number: Option<String>,
    #[serde(rename = "modelURL", default)]
    model_url: Option<String>,
    #[serde(rename = "displayName", default)]
    display_name: Option<String>,
    #[serde(rename = "apiVersion", default)]
    api_version: Option<String>,
    #[serde(rename = "displayVersion", default)]
    display_version: Option<String>,
    #[serde(rename = "zoneType", default)]
    zone_type: Option<String>,
    #[serde(rename = "iconList", default)]
    icon_list: Option<IconList>,
}

/// Icon list element
#[derive(Debug, Deserialize, Default)]
struct IconList {
    #[serde(rename = "icon", default)]
    icons: Vec<Icon>,
}

/// Single icon element
#[derive(Debug, Deserialize)]
struct Icon {
    #[serde(default)]
    url: Option<String>,
}

/// Parsed device description data
struct DeviceDescription {
    model_name: Option<String>,
    model_number: Option<String>,
    model_url: Option<String>,
    api_version: Option<String>,
    display_version: Option<String>,
    zone_type: Option<u32>,
    icon_url: Option<String>,
}

/// Fetch Sonos device information from its local HTTP API
///
/// Fetches both the zone player status (/status/zp) and device description
/// (/xml/device_description.xml) endpoints and merges the data.
///
/// # Arguments
/// * `ip_address` - The IP address of the Sonos device
/// * `timeout` - Request timeout duration
///
/// # Returns
/// Parsed Sonos information if successful
pub async fn fetch_sonos_info(
    ip_address: &str,
    timeout: Duration,
) -> Result<SonosInfo, SonosError> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| SonosError::HttpClient(e.to_string()))?;

    // Fetch zone player status (primary source, has zone name with L/R info)
    let status_url = format!(
        "http://{}:{}{}",
        ip_address, SONOS_API_PORT, SONOS_STATUS_ENDPOINT
    );
    debug!("Fetching Sonos status from: {}", status_url);

    let status_response = client
        .get(&status_url)
        .send()
        .await
        .map_err(|e| SonosError::Request(e.to_string()))?;

    if !status_response.status().is_success() {
        return Err(SonosError::HttpStatus(status_response.status().as_u16()));
    }

    let status_body = status_response
        .text()
        .await
        .map_err(|e| SonosError::ReadBody(e.to_string()))?;

    let mut info = parse_zp_status(&status_body)?;

    // Fetch device description (for model name and other details)
    let desc_url = format!(
        "http://{}:{}{}",
        ip_address, SONOS_API_PORT, SONOS_DEVICE_DESC_ENDPOINT
    );
    debug!("Fetching Sonos device description from: {}", desc_url);

    match client.get(&desc_url).send().await {
        Ok(response) if response.status().is_success() => {
            match response.text().await {
                Ok(body) => {
                    match parse_device_description(&body) {
                        Ok(desc) => {
                            // Merge device description into info
                            info.model_name = desc.model_name;
                            info.model_number = desc.model_number;
                            info.model_url = desc.model_url;
                            info.api_version = desc.api_version;
                            info.display_version = desc.display_version;
                            info.zone_type = desc.zone_type;
                            info.icon_url = desc.icon_url;
                        }
                        Err(e) => {
                            warn!("Failed to parse Sonos device description: {}", e);
                        }
                    }
                }
                Err(e) => {
                    warn!("Failed to read Sonos device description: {}", e);
                }
            }
        }
        Ok(response) => {
            warn!(
                "Sonos device description returned status: {}",
                response.status()
            );
        }
        Err(e) => {
            warn!("Failed to fetch Sonos device description: {}", e);
        }
    }

    Ok(info)
}

/// Parse the zone player status XML response
fn parse_zp_status(xml: &str) -> Result<SonosInfo, SonosError> {
    // Remove the XML stylesheet processing instruction if present
    // It can appear on the same line as content, so we use regex-like replacement
    let clean_xml = if let Some(start) = xml.find("<?xml-stylesheet") {
        if let Some(end) = xml[start..].find("?>") {
            let mut result = String::with_capacity(xml.len());
            result.push_str(&xml[..start]);
            result.push_str(&xml[start + end + 2..]);
            result
        } else {
            xml.to_string()
        }
    } else {
        xml.to_string()
    };

    let support_info: ZPSupportInfo = from_str(&clean_xml)
        .map_err(|e: quick_xml::DeError| SonosError::XmlParse(e.to_string()))?;

    let zp = support_info.zp_info;

    Ok(SonosInfo {
        zone_name: zp.zone_name,
        serial_number: zp.serial_number.filter(|s: &String| !s.is_empty()),
        software_version: zp.software_version.filter(|s: &String| !s.is_empty()),
        hardware_version: zp.hardware_version.filter(|s: &String| !s.is_empty()),
        series_id: zp.series_id.filter(|s: &String| !s.is_empty()),
        ip_address: zp.ip_address.filter(|s: &String| !s.is_empty()),
        mac_address: zp.mac_address.filter(|s: &String| !s.is_empty()),
        local_uid: zp.local_uid.filter(|s: &String| !s.is_empty()),
        household_id: zp.household_id.filter(|s: &String| !s.is_empty()),
        // These will be filled from device description
        model_name: None,
        model_number: None,
        model_url: None,
        api_version: None,
        display_version: None,
        zone_type: None,
        icon_url: None,
    })
}

/// Parse the device description XML response
fn parse_device_description(xml: &str) -> Result<DeviceDescription, SonosError> {
    let root: DeviceDescRoot =
        from_str(xml).map_err(|e: quick_xml::DeError| SonosError::XmlParse(e.to_string()))?;

    let device = root.device;

    // Prefer displayName over modelName if available (it's cleaner, e.g., "Era 300" vs "Sonos Era 300")
    let model_name = device.display_name.filter(|s| !s.is_empty()).or_else(|| {
        // Strip "Sonos " prefix from model_name if present for cleaner display
        device.model_name.map(|name| {
            name.strip_prefix("Sonos ")
                .map(|s| s.to_string())
                .unwrap_or(name)
        })
    });

    // Parse zone_type as u32
    let zone_type = device.zone_type.and_then(|s| s.parse::<u32>().ok());

    // Get first icon URL
    let icon_url = device
        .icon_list
        .and_then(|list| list.icons.into_iter().next())
        .and_then(|icon| icon.url)
        .filter(|s| !s.is_empty());

    Ok(DeviceDescription {
        model_name,
        model_number: device.model_number.filter(|s| !s.is_empty()),
        model_url: device.model_url.filter(|s| !s.is_empty()),
        api_version: device.api_version.filter(|s| !s.is_empty()),
        display_version: device.display_version.filter(|s| !s.is_empty()),
        zone_type,
        icon_url,
    })
}

/// Errors that can occur when fetching Sonos information
#[derive(Debug, Clone)]
pub enum SonosError {
    /// Failed to create HTTP client
    HttpClient(String),
    /// HTTP request failed
    Request(String),
    /// Non-success HTTP status
    HttpStatus(u16),
    /// Failed to read response body
    ReadBody(String),
    /// Failed to parse XML
    XmlParse(String),
}

impl std::fmt::Display for SonosError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SonosError::HttpClient(e) => write!(f, "Failed to create HTTP client: {}", e),
            SonosError::Request(e) => write!(f, "HTTP request failed: {}", e),
            SonosError::HttpStatus(code) => write!(f, "HTTP error: {}", code),
            SonosError::ReadBody(e) => write!(f, "Failed to read response: {}", e),
            SonosError::XmlParse(e) => write!(f, "Failed to parse XML: {}", e),
        }
    }
}

impl std::error::Error for SonosError {}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_ZP_STATUS: &str = r#"<?xml version="1.0" ?>
<?xml-stylesheet type="text/xsl" href="/xml/review.xsl"?><ZPSupportInfo><ZPInfo><ZoneName>Musikzimmer (R)</ZoneName><ZoneIcon></ZoneIcon><Configuration>1</Configuration><LocalUID>RINCON_F0F6C1C6E78401400</LocalUID><SerialNumber>F0-F6-C1-C6-E7-84:6</SerialNumber><SoftwareVersion>92.0-72090</SoftwareVersion><BuildType>release</BuildType><SWGen>2</SWGen><SoftwareDate>2025-12-09 14:38:46.991734</SoftwareDate><SoftwareScm>49880089d95</SoftwareScm><HHSwgenState>allow:2</HHSwgenState><MinCompatibleVersion>91.0-00000</MinCompatibleVersion><LegacyCompatibleVersion>91.0-00000</LegacyCompatibleVersion><HardwareVersion>1.38.3.10-2.2</HardwareVersion><DspVersion>0.25.3</DspVersion><SeriesID>A101</SeriesID><MfgLocation>4</MfgLocation><DateCode>0</DateCode><HwFlags>0x30</HwFlags><HwFeatures>0x0</HwFeatures><Variant>2</Variant><GeneralFlags>0x0</GeneralFlags><IPAddress>192.168.83.233</IPAddress><MACAddress>F0:F6:C1:C6:E7:84</MACAddress><Copyright>© 2003-2025, Sonos, Inc. All rights reserved.</Copyright><ExtraInfo></ExtraInfo><HTAudioInCode>0</HTAudioInCode><HTSNKPipelineVer>1</HTSNKPipelineVer><IdxTrk></IdxTrk><MDP2Ver>5</MDP2Ver><MDP3Ver>2</MDP3Ver><RelBuild>1</RelBuild><AllowlistBuild>0x0</AllowlistBuild><ProdUnit>1</ProdUnit><FuseCfg>OK</FuseCfg><RevokeFuse>0x1</RevokeFuse><AuthFlags>0x0</AuthFlags><SwFeatures>0x0</SwFeatures><HouseholdControlID>Sonos_s4D7nHwbnXPQyjIspOes8oqTGA.yGfssh9YWZPWWoLX6BFS</HouseholdControlID><LocationId>lc_86d0fd8588694f42933de61c7c17c539</LocationId></ZPInfo><!-- SDT: 3 ms --></ZPSupportInfo>"#;

    const SAMPLE_DEVICE_DESC: &str = r#"<?xml version="1.0" encoding="utf-8" ?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType>
    <friendlyName>192.168.1.39 - Sonos Era 300 - RINCON_F0F6C1CBE8C201400</friendlyName>
    <manufacturer>Sonos, Inc.</manufacturer>
    <modelNumber>S41</modelNumber>
    <modelDescription>Sonos Era 300</modelDescription>
    <modelName>Sonos Era 300</modelName>
    <modelURL>http://www.sonos.com/products/zoneplayers/S41</modelURL>
    <softwareVersion>92.0-72090</softwareVersion>
    <apiVersion>1.49.1</apiVersion>
    <displayVersion>17.7</displayVersion>
    <displayName>Era 300</displayName>
    <zoneType>43</zoneType>
    <iconList>
      <icon>
        <id>0</id>
        <mimetype>image/png</mimetype>
        <width>48</width>
        <height>48</height>
        <depth>24</depth>
        <url>/img/icon-S41.png</url>
      </icon>
    </iconList>
  </device>
</root>"#;

    #[test]
    fn test_parse_zp_status() {
        let info = parse_zp_status(SAMPLE_ZP_STATUS).expect("Failed to parse");

        assert_eq!(info.zone_name, "Musikzimmer (R)");
        assert_eq!(info.serial_number, Some("F0-F6-C1-C6-E7-84:6".to_string()));
        assert_eq!(info.software_version, Some("92.0-72090".to_string()));
        assert_eq!(info.hardware_version, Some("1.38.3.10-2.2".to_string()));
        assert_eq!(info.series_id, Some("A101".to_string()));
        assert_eq!(info.ip_address, Some("192.168.83.233".to_string()));
        assert_eq!(info.mac_address, Some("F0:F6:C1:C6:E7:84".to_string()));
        assert_eq!(info.local_uid, Some("RINCON_F0F6C1C6E78401400".to_string()));
        assert_eq!(
            info.household_id,
            Some("Sonos_s4D7nHwbnXPQyjIspOes8oqTGA.yGfssh9YWZPWWoLX6BFS".to_string())
        );
    }

    #[test]
    fn test_parse_device_description() {
        let desc = parse_device_description(SAMPLE_DEVICE_DESC).expect("Failed to parse");

        // displayName should be preferred over modelName
        assert_eq!(desc.model_name, Some("Era 300".to_string()));
        assert_eq!(desc.model_number, Some("S41".to_string()));
        assert_eq!(
            desc.model_url,
            Some("http://www.sonos.com/products/zoneplayers/S41".to_string())
        );
        assert_eq!(desc.api_version, Some("1.49.1".to_string()));
        assert_eq!(desc.display_version, Some("17.7".to_string()));
        assert_eq!(desc.zone_type, Some(43));
        assert_eq!(desc.icon_url, Some("/img/icon-S41.png".to_string()));
    }

    #[test]
    fn test_parse_minimal_zp_status() {
        let minimal = r#"<?xml version="1.0"?><ZPSupportInfo><ZPInfo><ZoneName>Living Room</ZoneName></ZPInfo></ZPSupportInfo>"#;
        let info = parse_zp_status(minimal).expect("Failed to parse");

        assert_eq!(info.zone_name, "Living Room");
        assert!(info.serial_number.is_none());
    }
}
