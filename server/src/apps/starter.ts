import { db, getSetting, one, setSetting } from '../db.ts';
import { slugify } from '../slug.ts';
import type { Platform } from './updates.ts';

/** `keep` serves the release file from this server, so it still installs when the internet is down. */
type StarterDownload = { platform: Platform; label?: string; url?: string; asset?: string; keep?: boolean };

export type StarterApp = {
  key: string;
  name: string;
  developer: string;
  subtitle: string;
  description: string;
  category: string;
  repo?: string;
  homepage: string;
  license: string;
  icon_url?: string;
  tint?: string;
  featured?: boolean;
  downloads: StarterDownload[];
};

const store = (name: string, id: string) => `https://apps.apple.com/app/${name}/id${id}`;
const play = (pkg: string) => `https://play.google.com/store/apps/details?id=${pkg}`;
const flathub = (id: string) => `https://flathub.org/apps/${id}`;

/**
 * Open source apps most households end up wanting. Release files are matched by pattern against each
 * project's latest GitHub release, so the list stays current without edits here.
 */
export const STARTER_APPS: StarterApp[] = [
  {
    key: 'jellyfin',
    name: 'Jellyfin',
    developer: 'Jellyfin',
    subtitle: 'Movies and shows from the home server',
    description:
      'Everything in the house library, on every screen. Sign in with the same account you use in the browser and pick up where you left off.\n\nOn iPhone and iPad the app is called Swiftfin.',
    category: 'Media',
    repo: 'jellyfin/jellyfin-desktop',
    homepage: 'https://jellyfin.org/downloads/clients',
    license: 'GPL-2.0',
    tint: '#00a4dc',
    featured: true,
    downloads: [
      { platform: 'ios', label: 'Swiftfin', url: store('swiftfin', '1604098728') },
      { platform: 'android', url: play('org.jellyfin.mobile') },
      { platform: 'macos', label: 'Apple silicon', asset: '*-AppleSilicon.dmg' },
      { platform: 'macos', label: 'Intel', asset: '*-Intel.dmg' },
      { platform: 'windows', asset: '*-windows-x64.exe' },
      { platform: 'linux', label: 'Flathub', url: flathub('org.jellyfin.JellyfinDesktop') },
    ],
  },
  {
    key: 'finamp',
    name: 'Finamp',
    developer: 'Finamp contributors',
    subtitle: 'Music from Jellyfin, offline too',
    description: 'A music player for the Jellyfin library. Download albums and playlists to listen without a connection, with gapless playback and a proper queue.',
    category: 'Media',
    repo: 'finamp-app/finamp',
    homepage: 'https://github.com/finamp-app/finamp',
    license: 'MPL-2.0',
    tint: '#aa5cc3',
    downloads: [
      { platform: 'ios', url: store('finamp', '1574922594') },
      { platform: 'android', url: play('com.unicornsonlsd.finamp') },
      { platform: 'macos', asset: 'Finamp-*-macOS.zip' },
      { platform: 'windows', asset: 'Finamp-*-Windows.zip' },
      { platform: 'linux', asset: 'finamp-*-linux-x64.tar.gz' },
    ],
  },
  {
    key: 'vlc',
    name: 'VLC',
    developer: 'VideoLAN',
    subtitle: 'Plays every video and audio file',
    description: 'The player that opens whatever you throw at it: odd formats, broken files, discs and network streams, with subtitles and no codec packs.',
    category: 'Media',
    homepage: 'https://www.videolan.org/vlc/',
    license: 'GPL-2.0',
    tint: '#ff8800',
    downloads: [
      { platform: 'ios', url: store('vlc-media-player', '650377962') },
      { platform: 'android', url: play('org.videolan.vlc') },
      { platform: 'macos', url: 'https://www.videolan.org/vlc/download-macosx.html' },
      { platform: 'windows', url: 'https://www.videolan.org/vlc/download-windows.html' },
      { platform: 'linux', url: 'https://www.videolan.org/vlc/#download' },
    ],
  },
  {
    key: 'obs',
    name: 'OBS Studio',
    developer: 'OBS Project',
    subtitle: 'Record and stream your screen',
    description: 'Screen recording and live streaming with scenes, webcam overlays and audio mixing. The standard tool for streamers, and handy for a quick screen recording.',
    category: 'Media',
    repo: 'obsproject/obs-studio',
    homepage: 'https://obsproject.com',
    license: 'GPL-2.0',
    tint: '#302e31',
    downloads: [
      { platform: 'macos', label: 'Apple silicon', asset: '*-macOS-Apple.dmg' },
      { platform: 'macos', label: 'Intel', asset: '*-macOS-Intel.dmg' },
      { platform: 'windows', asset: '*-Windows-x64-Installer.exe' },
      { platform: 'linux', label: 'Flathub', url: flathub('com.obsproject.Studio') },
    ],
  },
  {
    key: 'audacity',
    name: 'Audacity',
    developer: 'Audacity Team',
    subtitle: 'Record and edit audio',
    description: 'Cut, clean up and mix recordings. Good for podcasts, voice memos and digitising old tapes.',
    category: 'Media',
    repo: 'audacity/audacity',
    homepage: 'https://www.audacityteam.org',
    license: 'GPL-3.0',
    tint: '#0b5fcb',
    downloads: [
      { platform: 'macos', asset: 'audacity-macOS-*-universal.dmg' },
      { platform: 'windows', asset: 'audacity-win-*-x86_64.msi' },
      { platform: 'linux', label: 'AppImage', asset: 'audacity-linux-*-x86_64.AppImage' },
    ],
  },
  {
    key: 'handbrake',
    name: 'HandBrake',
    developer: 'HandBrake Team',
    subtitle: 'Convert video for any device',
    description: 'Shrink and convert video files, with ready-made presets for phones, TVs and Jellyfin-friendly formats.',
    category: 'Media',
    repo: 'HandBrake/HandBrake',
    homepage: 'https://handbrake.fr',
    license: 'GPL-2.0',
    tint: '#c0392b',
    downloads: [
      { platform: 'macos', asset: 'HandBrake-*.dmg' },
      { platform: 'windows', asset: 'HandBrake-*-x86_64-Win_GUI.exe' },
      { platform: 'linux', label: 'Flathub', url: flathub('fr.handbrake.ghb') },
    ],
  },
  {
    key: 'moonlight',
    name: 'Moonlight',
    developer: 'Moonlight Game Streaming',
    subtitle: 'Play PC games on any screen',
    description: 'Stream games from a gaming PC running Sunshine to a laptop, phone, tablet or TV in another room, with low latency and controller support.',
    category: 'Games',
    repo: 'moonlight-stream/moonlight-qt',
    homepage: 'https://moonlight-stream.org',
    license: 'GPL-3.0',
    tint: '#5e4ae3',
    downloads: [
      { platform: 'ios', url: store('moonlight-game-streaming', '1000551566') },
      { platform: 'android', url: play('com.limelight') },
      { platform: 'macos', asset: 'Moonlight-*.dmg' },
      { platform: 'windows', asset: 'MoonlightSetup-*.exe' },
      { platform: 'linux', label: 'AppImage', asset: 'Moonlight-*-x86_64.AppImage' },
    ],
  },
  {
    key: 'prism',
    name: 'Prism Launcher',
    developer: 'Prism Launcher',
    subtitle: 'Minecraft with mods, made easy',
    description: 'Keep separate Minecraft installs for every modpack and version, install mods from Modrinth and CurseForge in a click, and join the house servers.',
    category: 'Games',
    repo: 'PrismLauncher/PrismLauncher',
    homepage: 'https://prismlauncher.org',
    license: 'GPL-3.0',
    tint: '#4c8a3c',
    featured: true,
    downloads: [
      { platform: 'macos', asset: 'PrismLauncher-macOS-*.dmg' },
      { platform: 'windows', asset: 'PrismLauncher-Windows-MSVC-Setup-*.exe' },
      { platform: 'linux', label: 'AppImage', asset: 'PrismLauncher-Linux-x86_64.AppImage' },
    ],
  },
  {
    key: 'firefox',
    name: 'Firefox',
    developer: 'Mozilla',
    subtitle: 'The independent web browser',
    description: 'A fast browser that blocks trackers by default and syncs bookmarks, passwords and tabs between your devices.',
    category: 'Productivity',
    homepage: 'https://www.mozilla.org/firefox/',
    license: 'MPL-2.0',
    tint: '#ff7139',
    downloads: [
      { platform: 'ios', url: store('firefox', '989804926') },
      { platform: 'android', url: play('org.mozilla.firefox') },
      { platform: 'macos', url: 'https://www.mozilla.org/firefox/new/' },
      { platform: 'windows', url: 'https://www.mozilla.org/firefox/new/' },
      { platform: 'linux', url: 'https://www.mozilla.org/firefox/new/' },
    ],
  },
  {
    key: 'libreoffice',
    name: 'LibreOffice',
    developer: 'The Document Foundation',
    subtitle: 'Documents, spreadsheets and slides',
    description: 'A full office suite that opens and saves Word, Excel and PowerPoint files. No account and no subscription.',
    category: 'Productivity',
    homepage: 'https://www.libreoffice.org',
    license: 'MPL-2.0',
    icon_url: 'https://github.com/LibreOffice.png?size=256',
    tint: '#18a303',
    downloads: [
      { platform: 'macos', url: 'https://www.libreoffice.org/download/download-libreoffice/' },
      { platform: 'windows', url: 'https://www.libreoffice.org/download/download-libreoffice/' },
      { platform: 'linux', url: 'https://www.libreoffice.org/download/download-libreoffice/' },
    ],
  },
  {
    key: 'joplin',
    name: 'Joplin',
    developer: 'Laurent Cozic',
    subtitle: 'Notes and to-dos that sync',
    description: 'Notes in Markdown, organised in notebooks, with end-to-end encrypted sync through a folder, Nextcloud or WebDAV that you control.',
    category: 'Productivity',
    repo: 'laurent22/joplin',
    homepage: 'https://joplinapp.org',
    license: 'AGPL-3.0',
    tint: '#1071d3',
    downloads: [
      { platform: 'ios', url: store('joplin', '1315599797') },
      { platform: 'android', url: play('net.cozic.joplin') },
      { platform: 'macos', label: 'Apple silicon', asset: 'Joplin-*-arm64.dmg' },
      { platform: 'windows', asset: 'Joplin-Setup-*.exe' },
      { platform: 'linux', label: 'AppImage', asset: 'Joplin-*.AppImage' },
    ],
  },
  {
    key: 'vscodium',
    name: 'VSCodium',
    developer: 'VSCodium',
    subtitle: 'Code editor, without the tracking',
    description: 'Visual Studio Code built from the open source code, with Microsoft telemetry switched off and the open extension marketplace.',
    category: 'Productivity',
    repo: 'VSCodium/vscodium',
    homepage: 'https://vscodium.com',
    license: 'MIT',
    tint: '#2f80ed',
    downloads: [
      { platform: 'macos', label: 'Apple silicon', asset: 'VSCodium.arm64.*.dmg' },
      { platform: 'macos', label: 'Intel', asset: 'VSCodium.x64.*.dmg' },
      { platform: 'windows', asset: 'VSCodiumUserSetup-x64-*.exe' },
      { platform: 'linux', label: 'AppImage', asset: 'VSCodium-*-anylinux-x86_64.AppImage' },
    ],
  },
  {
    key: 'bitwarden',
    name: 'Bitwarden',
    developer: 'Bitwarden',
    subtitle: 'Passwords for the whole family',
    description: 'A password manager on every device and browser, with shared family collections and end-to-end encryption. Works with a self-hosted Vaultwarden too.',
    category: 'Privacy & Security',
    homepage: 'https://bitwarden.com',
    license: 'GPL-3.0',
    tint: '#175ddc',
    downloads: [
      { platform: 'ios', url: store('bitwarden-password-manager', '1137397744') },
      { platform: 'android', url: play('com.x8bit.bitwarden') },
      { platform: 'macos', url: 'https://bitwarden.com/download/' },
      { platform: 'windows', url: 'https://bitwarden.com/download/' },
      { platform: 'linux', url: 'https://bitwarden.com/download/' },
    ],
  },
  {
    key: 'keepassxc',
    name: 'KeePassXC',
    developer: 'KeePassXC Team',
    subtitle: 'Passwords in a file you own',
    description: 'Keeps passwords in one encrypted file that never leaves your devices unless you move it. On iPhone use KeePassium, on Android KeePassDX: both open the same file.',
    category: 'Privacy & Security',
    repo: 'keepassxreboot/keepassxc',
    homepage: 'https://keepassxc.org',
    license: 'GPL-3.0',
    tint: '#6cac4d',
    downloads: [
      { platform: 'ios', label: 'KeePassium', url: store('keepassium', '1435127111') },
      { platform: 'android', label: 'KeePassDX', url: play('com.kunzisoft.keepass.free') },
      { platform: 'macos', label: 'Apple silicon', asset: 'KeePassXC-*-arm64.dmg' },
      { platform: 'macos', label: 'Intel', asset: 'KeePassXC-*-x86_64.dmg' },
      { platform: 'windows', asset: 'KeePassXC-*-x64.msi' },
      { platform: 'linux', label: 'AppImage', asset: 'KeePassXC-*-x86_64.AppImage' },
    ],
  },
  {
    key: 'signal',
    name: 'Signal',
    developer: 'Signal Messenger',
    subtitle: 'Private messages and calls',
    description: 'End-to-end encrypted messages, voice and video calls, and group chats. The desktop app links to your phone.',
    category: 'Privacy & Security',
    homepage: 'https://signal.org',
    license: 'AGPL-3.0',
    tint: '#3a76f0',
    downloads: [
      { platform: 'ios', url: store('signal-private-messenger', '874139669') },
      { platform: 'android', url: play('org.thoughtcrime.securesms') },
      { platform: 'macos', url: 'https://signal.org/download/' },
      { platform: 'windows', url: 'https://signal.org/download/' },
      { platform: 'linux', url: 'https://signal.org/download/' },
    ],
  },
  {
    key: 'wireguard',
    name: 'WireGuard',
    developer: 'WireGuard',
    subtitle: 'Reach home from anywhere',
    description: 'A fast, simple VPN. Scan the QR code from the router or server once, then flip it on to use home services while you are out.',
    category: 'Privacy & Security',
    homepage: 'https://www.wireguard.com',
    license: 'GPL-2.0',
    tint: '#88171a',
    downloads: [
      { platform: 'ios', url: store('wireguard', '1441195209') },
      { platform: 'android', url: play('com.wireguard.android') },
      { platform: 'macos', url: store('wireguard', '1451685025') },
      { platform: 'windows', url: 'https://www.wireguard.com/install/' },
      { platform: 'linux', url: 'https://www.wireguard.com/install/' },
    ],
  },
  {
    key: 'ente-auth',
    name: 'Ente Auth',
    developer: 'Ente',
    subtitle: 'Two-factor codes, backed up',
    description: 'An authenticator app whose codes are end-to-end encrypted and synced, so a lost phone does not lock you out of every account.',
    category: 'Privacy & Security',
    homepage: 'https://ente.com/auth',
    license: 'AGPL-3.0',
    tint: '#8f33d6',
    downloads: [
      { platform: 'ios', url: store('ente-auth', '6444121398') },
      { platform: 'android', url: play('io.ente.auth') },
      { platform: 'macos', url: 'https://ente.com/download' },
      { platform: 'windows', url: 'https://ente.com/download' },
      { platform: 'linux', url: 'https://ente.com/download' },
    ],
  },
  {
    key: 'localsend',
    name: 'LocalSend',
    developer: 'LocalSend',
    subtitle: 'AirDrop for every device',
    description: 'Send files and text between phones and computers on the same Wi-Fi, iPhone to Windows, Android to Mac. Nothing goes through the internet.',
    category: 'Utilities',
    repo: 'localsend/localsend',
    homepage: 'https://localsend.org',
    license: 'Apache-2.0',
    tint: '#16857a',
    featured: true,
    downloads: [
      { platform: 'ios', url: store('localsend', '1661733229') },
      { platform: 'android', url: play('org.localsend.localsend_app') },
      { platform: 'android', label: 'APK', asset: 'LocalSend-*-android-arm64v8.apk' },
      { platform: 'macos', asset: 'LocalSend-*.dmg' },
      { platform: 'windows', asset: 'LocalSend-*-windows-x86-64.exe' },
      { platform: 'linux', label: 'AppImage', asset: 'LocalSend-*-linux-x86-64.AppImage' },
    ],
  },
  {
    key: 'qbittorrent',
    name: 'qBittorrent',
    developer: 'qBittorrent project',
    subtitle: 'Torrents without the ads',
    description: 'A clean torrent client with search, RSS and a web interface, and nothing bundled in the installer.',
    category: 'Utilities',
    repo: 'qbittorrent/qBittorrent',
    homepage: 'https://www.qbittorrent.org',
    license: 'GPL-2.0',
    tint: '#3b78c4',
    downloads: [
      { platform: 'macos', url: 'https://www.qbittorrent.org/download' },
      { platform: 'windows', asset: 'qbittorrent_*_x64_setup.exe' },
      { platform: 'linux', label: 'AppImage', asset: 'qbittorrent-*_x86_64.AppImage' },
    ],
  },
  {
    key: 'keka',
    name: 'Keka',
    developer: 'Jorge García',
    subtitle: 'Zip, 7z and RAR on the Mac',
    description: 'Opens almost any archive and makes zip and 7z files, with passwords and splitting. Drag files onto the Dock icon to compress them.',
    category: 'Utilities',
    repo: 'aonez/Keka',
    homepage: 'https://www.keka.io',
    license: '',
    icon_url: store('keka', '470158793'),
    downloads: [{ platform: 'macos', asset: 'Keka-*.dmg' }],
  },
  {
    key: 'rectangle',
    name: 'Rectangle',
    developer: 'Ryan Hanson',
    subtitle: 'Snap windows on the Mac',
    description: 'Move and resize windows with keyboard shortcuts or by dragging them to the edges of the screen, the way Windows does.',
    category: 'Utilities',
    repo: 'rxhanson/Rectangle',
    homepage: 'https://rectangleapp.com',
    license: 'MIT',
    downloads: [{ platform: 'macos', asset: 'Rectangle*.dmg' }],
  },
  {
    key: 'stats',
    name: 'Stats',
    developer: 'Serhiy Mytrovtsiy',
    subtitle: 'System monitor in the menu bar',
    description: 'CPU, memory, disk, network, battery and temperatures, right in the Mac menu bar.',
    category: 'Utilities',
    repo: 'exelban/stats',
    homepage: 'https://mac-stats.com',
    license: 'MIT',
    downloads: [{ platform: 'macos', asset: 'Stats.dmg' }],
  },
  {
    key: 'powertoys',
    name: 'PowerToys',
    developer: 'Microsoft',
    subtitle: 'Power tools for Windows',
    description: 'A colour picker, window layouts, bulk renaming, a quick launcher and a dozen more small tools that Windows should have had built in.',
    category: 'Utilities',
    repo: 'microsoft/PowerToys',
    homepage: 'https://learn.microsoft.com/windows/powertoys/',
    license: 'MIT',
    tint: '#4a6cf7',
    downloads: [{ platform: 'windows', asset: 'PowerToysUserSetup-*-x64.exe' }],
  },
  {
    key: 'utm',
    name: 'UTM',
    developer: 'UTM',
    subtitle: 'Virtual machines on iPhone and Mac',
    description:
      'Run Windows, Linux and older systems in a window. On iPhone and iPad, UTM SE comes from the App Store; the full UTM installs through SideStore or AltStore using the house source.',
    category: 'Utilities',
    repo: 'utmapp/UTM',
    homepage: 'https://getutm.app',
    license: 'Apache-2.0',
    tint: '#2d6cdf',
    downloads: [
      { platform: 'ios', label: 'UTM SE', url: store('utm-se-retro-pc-emulator', '1564628856') },
      { platform: 'ios', label: 'UTM (sideload)', asset: 'UTM.ipa' },
      { platform: 'macos', asset: 'UTM.dmg' },
    ],
  },
  {
    key: 'sidestore',
    name: 'SideStore',
    developer: 'SideStore Team',
    subtitle: 'Install apps the App Store doesn’t have',
    description:
      'Installs apps on iPhone and iPad with your own Apple ID, and refreshes them on its own. Set it up once from a computer, then add the house source to get every sideloadable app listed here.',
    category: 'Utilities',
    repo: 'SideStore/SideStore',
    homepage: 'https://sidestore.io',
    license: 'AGPL-3.0',
    tint: '#9b5de5',
    downloads: [{ platform: 'ios', label: 'Setup guide', url: 'https://docs.sidestore.io/docs/installation/prerequisites' }],
  },
  {
    key: 'home-assistant',
    name: 'Home Assistant',
    developer: 'Home Assistant',
    subtitle: 'The smart home, in your pocket',
    description: 'Lights, heating, cameras and automations from the house Home Assistant, with notifications and location for presence.',
    category: 'Home',
    homepage: 'https://www.home-assistant.io',
    license: 'Apache-2.0',
    tint: '#18bcf2',
    downloads: [
      { platform: 'ios', url: store('home-assistant', '1099568401') },
      { platform: 'android', url: play('io.homeassistant.companion.android') },
    ],
  },
  {
    key: 'freecad',
    name: 'FreeCAD',
    developer: 'FreeCAD',
    subtitle: 'Design parts in 3D for printing and making',
    description:
      'Parametric 3D modelling: sketch a shape, give it dimensions, and change a number later to resize the whole part. Exports STL and STEP for the slicer or a CNC.\n\nThe installers are kept on the house server, so they install without an internet connection.',
    category: 'Making',
    repo: 'FreeCAD/FreeCAD',
    homepage: 'https://www.freecad.org',
    license: 'LGPL-2.1',
    tint: '#c5281c',
    downloads: [
      { platform: 'macos', label: 'Apple silicon', asset: 'FreeCAD_*-macOS-arm64-*.dmg', keep: true },
      { platform: 'macos', label: 'Intel', asset: 'FreeCAD_*-macOS-x86_64-*.dmg', keep: true },
      { platform: 'windows', asset: 'FreeCAD_*-Windows-x86_64-*-installer.exe', keep: true },
      { platform: 'linux', label: 'AppImage', asset: 'FreeCAD_*-Linux-x86_64-*.AppImage', keep: true },
      { platform: 'linux', label: 'AppImage (ARM, Raspberry Pi)', asset: 'FreeCAD_*-Linux-aarch64-*.AppImage', keep: true },
    ],
  },
  {
    key: 'orcaslicer',
    name: 'OrcaSlicer',
    developer: 'OrcaSlicer contributors',
    subtitle: 'Turn 3D models into prints',
    description:
      'Slices STL, 3MF and STEP files for Bambu, Prusa, Creality, Voron and most other printers, with calibration tests built in and print sending over the network.\n\nThe installers are kept on the house server, so they install without an internet connection.',
    category: 'Making',
    repo: 'OrcaSlicer/OrcaSlicer',
    homepage: 'https://orcaslicer.com',
    license: 'AGPL-3.0',
    tint: '#009688',
    downloads: [
      { platform: 'macos', asset: 'OrcaSlicer_Mac_universal_*.dmg', keep: true },
      { platform: 'windows', asset: 'OrcaSlicer_Windows_Installer_*_x64.exe', keep: true },
      { platform: 'linux', label: 'AppImage', asset: 'OrcaSlicer_Linux_AppImage_Ubuntu2404_V*.AppImage', keep: true },
    ],
  },
  {
    key: 'zed',
    name: 'Zed',
    developer: 'Zed Industries',
    subtitle: 'AI code editor that runs on your own models',
    description:
      'A fast code editor with an AI agent that writes and edits code across your project, like Cursor. Point it at Ollama and the AI runs on the house hardware, with nothing sent to the cloud and nothing needed from the internet.\n\nPython, C and C++ work out of the box. Language tools like clangd and pyright download the first time you open such a file, so open one of each while you\u2019re online.\n\nThe installers are kept on the house server.',
    category: 'Coding',
    repo: 'zed-industries/zed',
    homepage: 'https://zed.dev',
    license: 'GPL-3.0',
    tint: '#084ccf',
    featured: true,
    downloads: [
      { platform: 'macos', label: 'Apple silicon', asset: 'Zed-aarch64.dmg', keep: true },
      { platform: 'macos', label: 'Intel', asset: 'Zed-x86_64.dmg', keep: true },
      { platform: 'windows', asset: 'Zed-x86_64.exe', keep: true },
      { platform: 'linux', label: 'x86_64', asset: 'zed-linux-x86_64.tar.gz', keep: true },
      { platform: 'linux', label: 'ARM (Raspberry Pi)', asset: 'zed-linux-aarch64.tar.gz', keep: true },
    ],
  },
  {
    key: 'arduino-ide',
    name: 'Arduino IDE',
    developer: 'Arduino',
    subtitle: 'Write C++ and upload it to Arduino boards',
    description:
      'Write sketches in Arduino C/C++, upload them over USB and watch the serial monitor. Also programs ESP32 and Raspberry Pi Pico boards once their board package is added.\n\nThe installers are kept on the house server. Board packages and libraries still download from the internet the first time, so add the boards you use while you\u2019re online.',
    category: 'Coding',
    repo: 'arduino/arduino-ide',
    homepage: 'https://www.arduino.cc/en/software',
    license: 'AGPL-3.0',
    tint: '#00878f',
    downloads: [
      { platform: 'macos', label: 'Apple silicon', asset: 'arduino-ide_*_macOS_arm64.dmg', keep: true },
      { platform: 'macos', label: 'Intel', asset: 'arduino-ide_*_macOS_64bit.dmg', keep: true },
      { platform: 'windows', asset: 'arduino-ide_*_Windows_64bit.exe', keep: true },
      { platform: 'linux', label: 'AppImage', asset: 'arduino-ide_*_Linux_64bit.AppImage', keep: true },
    ],
  },
  {
    key: 'thonny',
    name: 'Thonny',
    developer: 'Thonny',
    subtitle: 'Python for beginners and the Raspberry Pi',
    description:
      'A simple Python editor with a step-by-step debugger that shows what every line does. Runs MicroPython on a Raspberry Pi Pico or ESP32 over USB, with a file browser for the board.\n\nRaspberry Pi OS already comes with Thonny. The Mac and Windows installers are kept on the house server.',
    category: 'Coding',
    repo: 'thonny/thonny',
    homepage: 'https://thonny.org',
    license: 'MIT',
    tint: '#3776ab',
    downloads: [
      { platform: 'macos', label: 'Apple silicon', asset: 'thonny-*-arm64.pkg', keep: true },
      { platform: 'macos', label: 'Intel', asset: 'thonny-*-x64.pkg', keep: true },
      { platform: 'windows', asset: 'thonny-*-x64.exe', keep: true },
      { platform: 'linux', label: 'Flathub', url: flathub('org.thonny.Thonny') },
    ],
  },
  {
    key: 'ollama',
    name: 'Ollama',
    developer: 'Ollama',
    subtitle: 'Run AI models on your own computer',
    description:
      'Chat with open models like Llama, Gemma, Qwen and Mistral without sending anything to the cloud. Once a model is downloaded it works fully offline.\n\nThe installers are kept on the house server. Models are downloaded inside the app (ollama pull) while online.',
    category: 'AI',
    repo: 'ollama/ollama',
    homepage: 'https://ollama.com',
    license: 'MIT',
    tint: '#1a1a1a',
    downloads: [
      { platform: 'macos', asset: 'Ollama.dmg', keep: true },
      { platform: 'windows', asset: 'OllamaSetup.exe', keep: true },
      { platform: 'linux', label: 'x86_64', asset: 'ollama-linux-amd64.tar.zst', keep: true },
      { platform: 'linux', label: 'ARM (Raspberry Pi)', asset: 'ollama-linux-arm64.tar.zst', keep: true },
    ],
  },
];

/** Adds starter apps by key, skipping any already in the catalog. Returns how many were added. */
export function addStarterApps(keys: string[]): number {
  const wanted = STARTER_APPS.filter((a) => keys.includes(a.key) && !one('SELECT id FROM apps WHERE starter = ?', a.key));
  if (!wanted.length) return 0;
  const insertApp = db.prepare(
    `INSERT INTO apps (slug, name, developer, subtitle, description, category, repo, homepage, license, icon_url, tint, featured, starter, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertDownload = db.prepare(
    `INSERT INTO app_downloads (app_id, platform, label, source, url, asset, keep, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let pos = one<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM apps')!.p;
  db.exec('BEGIN');
  try {
    for (const a of wanted) {
      let slug = slugify(a.name);
      for (let i = 2; one('SELECT id FROM apps WHERE slug = ?', slug); i++) slug = `${slugify(a.name)}-${i}`;
      const res = insertApp.run(
        slug, a.name, a.developer, a.subtitle, a.description, a.category, a.repo ?? '', a.homepage, a.license,
        a.icon_url ?? '', a.tint ?? '', a.featured ? 1 : 0, a.key, pos++,
      );
      a.downloads.forEach((d, i) =>
        insertDownload.run(Number(res.lastInsertRowid), d.platform, d.label ?? '', d.asset ? 'release' : 'link', d.url ?? '', d.asset ?? '', d.asset && d.keep ? 1 : 0, i),
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return wanted.length;
}

/** Fills the catalog the first time Bellhop starts with this feature. Removing apps later sticks. */
export function seedStarterApps() {
  if (getSetting('apps_seeded')) return;
  addStarterApps(STARTER_APPS.map((a) => a.key));
  setSetting('apps_seeded', '1');
}
