import type { ComponentType } from 'react';
import {
  FaApple,
  FaGoogle,
  FaSpotify,
  FaMicrosoft,
  FaAmazon,
} from 'react-icons/fa';
import {
  SiSonos,
  SiEspressif,
  SiHomeassistant,
  SiSamsung,
  SiSony,
  SiHp,
  SiEpson,
} from 'react-icons/si';

/**
 * Map of manufacturer names (normalized) to their brand icon components
 */
const brandIconMap: Map<string, ComponentType<{ className?: string }>> = new Map([
  // Apple
  ['apple', FaApple],
  
  // Google
  ['google', FaGoogle],
  
  // Spotify
  ['spotify', FaSpotify],
  
  // Microsoft
  ['microsoft', FaMicrosoft],
  
  // Amazon
  ['amazon', FaAmazon],
  
  // Samsung
  ['samsung', SiSamsung],
  
  // Sony
  ['sony', SiSony],
  
  // Printer manufacturers
  ['hp', SiHp],
  ['hewlett-packard', SiHp],
  ['epson', SiEpson],
  
  // Audio/Home automation
  ['sonos', SiSonos],
  ['espressif', SiEspressif],
  ['esphome', SiEspressif],
  ['home assistant', SiHomeassistant],
  ['homeassistant', SiHomeassistant],
]);

/**
 * Get a brand icon component for a manufacturer name
 * 
 * @param manufacturer - Manufacturer name (case-insensitive)
 * @returns Icon component or null if no icon found
 */
export function getBrandIcon(
  manufacturer: string | null | undefined
): ComponentType<{ className?: string }> | null {
    
  if (!manufacturer) {
    return null;
  }
  
  // Normalize manufacturer name for lookup
  const normalized = manufacturer.toLowerCase().trim();
  
  // Try exact match first
  const icon = brandIconMap.get(normalized);
  
  if (icon) {
    return icon;
  }
  
  // Try partial matches (e.g., "Apple Inc." should match "apple")
  for (const [key, iconComponent] of brandIconMap.entries()) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return iconComponent;
    }
  }
  
  return null;
}
