import { Laptop, Monitor, Smartphone, Terminal, type LucideIcon } from 'lucide-react';
import type { DownloadFrom, Platform } from './types.ts';

export const PLATFORMS: Platform[] = ['ios', 'android', 'macos', 'windows', 'linux'];

export const PLATFORM_INFO: Record<Platform, { label: string; device: string; icon: LucideIcon }> = {
  ios: { label: 'iPhone & iPad', device: 'iPhone', icon: Smartphone },
  android: { label: 'Android', device: 'Android phone', icon: Smartphone },
  macos: { label: 'Mac', device: 'Mac', icon: Laptop },
  windows: { label: 'Windows', device: 'PC', icon: Monitor },
  linux: { label: 'Linux', device: 'Linux computer', icon: Terminal },
};

export const FROM_LABEL: Record<DownloadFrom, string> = {
  server: 'From this server',
  appstore: 'App Store',
  play: 'Google Play',
  fdroid: 'F-Droid',
  flathub: 'Flathub',
  github: 'GitHub',
  web: 'Website',
};

/** The visitor's platform. iPads ask for the desktop site, so a touch-screen "Mac" is an iPad. */
export function detectPlatform(): Platform | null {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'macos';
  if (/Windows/.test(ua)) return 'windows';
  if (/Linux|X11|CrOS/.test(ua)) return 'linux';
  return null;
}

/** Deep links that hand an address to the sideloading apps. */
export const sideloadLinks = (kind: 'source' | 'install', url: string) => [
  { name: 'SideStore', href: `sidestore://${kind}?url=${encodeURIComponent(url)}` },
  { name: 'AltStore', href: `altstore://${kind}?url=${encodeURIComponent(url)}` },
];
