import type { IpaInfo } from './ipa.ts';
import type { AppRow, DownloadRow } from './updates.ts';

// AltStore only knows these; anything else shows as "Other".
const CATEGORIES: Record<string, string> = {
  media: 'entertainment',
  entertainment: 'entertainment',
  games: 'games',
  utilities: 'utilities',
  'privacy & security': 'utilities',
  productivity: 'lifestyle',
  developer: 'developer',
  photos: 'photo-video',
  social: 'social',
  home: 'lifestyle',
};

export const altstoreCategory = (category: string) => CATEGORIES[category.trim().toLowerCase()] ?? 'other';

export type SourceApp = { app: AppRow; downloads: DownloadRow[] };

/**
 * An AltStore source (the format SideStore reads too) listing every .ipa kept on this server.
 * `base` is the public, key-protected address that phones fetch everything from.
 */
export function buildSource(base: string, site: string, entries: SourceApp[]) {
  const apps = [];
  for (const { app, downloads } of entries) {
    for (const d of downloads) {
      if (d.platform !== 'ios' || !d.file || !d.ipa || !d.file_name) continue;
      const info = JSON.parse(d.ipa) as IpaInfo;
      const downloadURL = `${base}/files/${d.id}/${encodeURIComponent(d.file_name)}`;
      const date = d.released_at ?? new Date().toISOString();
      const name = downloads.filter((x) => x.ipa).length > 1 && d.label ? `${app.name} (${d.label})` : app.name;
      apps.push({
        name,
        bundleIdentifier: info.bundleId,
        developerName: app.developer || 'Unknown',
        subtitle: app.subtitle || undefined,
        localizedDescription: app.description || app.subtitle || app.name,
        iconURL: app.icon ? `${base}/icons/${app.icon}` : undefined,
        tintColor: app.tint ? app.tint.replace(/^#/, '') : undefined,
        category: altstoreCategory(app.category),
        screenshots: [],
        versions: [
          {
            version: info.version,
            buildVersion: info.build || undefined,
            date,
            localizedDescription: `Version ${info.version}`,
            downloadURL,
            size: d.size ?? 0,
            minOSVersion: info.minOS || undefined,
          },
        ],
        appPermissions: { entitlements: info.entitlements, privacy: info.privacy },
        // Older AltStore and SideStore builds read these instead of `versions`.
        version: info.version,
        versionDate: date,
        downloadURL,
        size: d.size ?? 0,
      });
    }
  }
  const host = new URL(site).hostname;
  return {
    name: 'Bellhop',
    identifier: `bellhop.${host.split('.').reverse().join('.')}`,
    subtitle: 'Apps from the house server',
    description: 'Apps your household admin keeps on Bellhop.',
    website: site,
    tintColor: 'e3ab4c',
    apps,
    news: [],
  };
}
