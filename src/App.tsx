// Copyright (C) 2026 dumbapplee
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, CircleHelp, Coffee, Download, ExternalLink, Github, History, LoaderCircle, PanelsTopLeft, Pause, Play, RotateCcw, Search, ShieldCheck, X } from 'lucide-react';
import AvatarEditor, { DEFAULT_AVATAR_EDIT, type AvatarEditState } from './components/AvatarEditor';
import AvatarFramePicker, { type SteamAvatarFrame } from './components/AvatarFramePicker';
import BackgroundPicker, { type ProfileBackgroundSize, type SteamBackground } from './components/BackgroundPicker';
import ProfileThemePicker, { type AppliedProfileTheme } from './components/ProfileThemePicker';
import ShowcaseEditor, { type RemovedShowcase } from './components/ShowcaseEditor';
import SupportPopup from './components/SupportPopup';
import GuideDialog from './components/GuidePage';
import { ensureShowcaseArea } from './utils/showcaseArea';
import { dehydrateArtworkUrls, hydrateArtworkUrls, listArtworkAssetIds, scheduleArtworkSweep, setArtworkRoots, sweepArtwork } from './utils/artworkAssets';

type ProfilePreview = {
  name: string;
  url: string;
  html: string;
  avatar?: string;
  level?: number;
};

const mosaicLayouts = [
  {
    columns: '1.4fr 1fr .8fr',
    order: ['a', 'b', 'c', 'd', 'e', 'f'],
  },
  {
    columns: '.8fr 1.4fr 1fr',
    order: ['b', 'c', 'a', 'e', 'f', 'd'],
  },
  {
    columns: '1fr .8fr 1.4fr',
    order: ['c', 'a', 'b', 'f', 'd', 'e'],
  },
];

type ProjectDraft = {
  format: 'steamcanvas-project';
  version: 1;
  profileIdentifier: string;
  showcaseAreaHtml: string;
  removedShowcases?: RemovedShowcase[];
  settings: {
    avatarEdit: AvatarEditState;
    avatarFrame: SteamAvatarFrame | null;
    background: SteamBackground | null;
    backgroundSize?: ProfileBackgroundSize;
    profileTheme: AppliedProfileTheme | null;
    previewLevel: number;
  };
};

const projectDatabaseName = 'steamcanvas-projects';
const projectStoreName = 'drafts';
const autosaveKey = 'autosave';
// Artwork files placed in showcases, keyed by asset id. The draft refers to them as steamcanvas-asset:<id>
// (utils/artworkAssets.ts) instead of holding the images as data URLs.
const assetStoreName = 'assets';
let projectDatabase: Promise<IDBDatabase> | null = null;
// Told when an older SteamCanvas tab keeps the previous database version open and the upgrade waits.
let onProjectStorageBlocked: (() => void) | null = null;

const changelogSeenKey = 'steamcanvas-changelog-seen';

function readChangelogSeen(): string | null {
  try {
    return localStorage.getItem(changelogSeenKey);
  } catch {
    return null;
  }
}

const changelogEntries = [
  {
    date: '2026-11-02',
    displayDate: 'November 2, 2026',
    category: 'TRANSPARENT BACKGROUND',
    title: 'Showcases that blend into your background',
    details: [
      'Crop the profile background behind Artwork, Featured Artwork, Screenshot, and Workshop showcases with one click, then drag the preview to set the height.',
      'Choose Full size or Original size for your background, and the crop follows that choice; empty areas are filled with black.',
    ],
  },
  {
    date: '2026-10-09',
    displayDate: 'October 9, 2026',
    category: 'WORKSHOP',
    title: 'More room for Workshop artwork',
    details: [
      'Choose the default 1 × 5 layout or use an upgraded 2 × 5 showcase with one image per row.',
      'Export Workshop images ready for Steam upload, plus a local HTML preview with linked image assets.',
    ],
  },
  {
    date: '2026-10-08',
    displayDate: 'October 8, 2026',
    category: 'PROFILE CUSTOMIZATION',
    title: 'More profile styles to explore',
    details: [
      'Browse Steam profile themes, avatar frames, and animated backgrounds.',
      'Catalog loading, caching, and retry handling make large Steam collections easier to explore.',
    ],
  },
  {
    date: '2026-10-02',
    displayDate: 'October 2, 2026',
    category: 'PREVIEW RELIABILITY',
    title: 'Smoother profile previews',
    details: [
      'Preview animated profile backgrounds without video controls covering the artwork.',
      'Steam requests use throttling and retry handling to cope better with rate limits.',
    ],
  },
  {
    date: '2026-10-01',
    displayDate: 'October 1, 2026',
    category: 'SHOWCASE EDITOR',
    title: 'Arrange, edit, and restore showcases',
    details: [
      'Add, reorder, remove, and restore Artwork, Featured Artwork, Screenshot, and Workshop showcases.',
      'Split artwork into Steam-sized panels, choose public screenshots, and download showcase assets as ZIPs.',
    ],
  },
  {
    date: '2026-09-30',
    displayDate: 'September 30, 2026',
    category: 'THE FIRST PREVIEW',
    title: 'Start with a public Steam profile',
    details: [
      'Load a profile by custom URL, SteamID64, or profile link and preview changes before making them.',
      'Try avatar and background changes in SteamCanvas; the preview does not modify your Steam account.',
    ],
  },
] as const;

function openProjectDatabase(): Promise<IDBDatabase> {
  if (!projectDatabase) {
    projectDatabase = new Promise((resolve, reject) => {
      const request = indexedDB.open(projectDatabaseName, 2);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(projectStoreName)) database.createObjectStore(projectStoreName);
        if (!database.objectStoreNames.contains(assetStoreName)) database.createObjectStore(assetStoreName);
      };
      // Another tab still has the previous version open; the upgrade waits until that tab closes it.
      request.onblocked = () => onProjectStorageBlocked?.();
      request.onsuccess = () => {
        const database = request.result;
        // Let a newer version of the app upgrade the database instead of being blocked by this tab.
        database.onversionchange = () => {
          database.close();
          projectDatabase = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        projectDatabase = null;
        reject(request.error || new Error('Could not open local project storage.'));
      };
    });
  }
  return projectDatabase;
}

async function readProjectDraft(): Promise<ProjectDraft | null> {
  const database = await openProjectDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(projectStoreName, 'readonly').objectStore(projectStoreName).get(autosaveKey);
    request.onsuccess = () => resolve((request.result as ProjectDraft | undefined) || null);
    request.onerror = () => reject(request.error || new Error('Could not read the saved project.'));
  });
}

type ProjectSnapshot = { draft: ProjectDraft; blobs: Map<string, Blob> };

/** Asset ids in the showcase area and in removed showcases, which can be restored from the trash. */
function draftAssetIds(draft: ProjectDraft): string[] {
  const html = [draft.showcaseAreaHtml, ...(draft.removedShowcases || []).map((showcase) => showcase.html)];
  return [...new Set(html.flatMap(listArtworkAssetIds))];
}

/**
 * The saved draft and every file it refers to, read in one transaction. Reading them separately let another
 * tab's save replace the draft and delete its files in between, so the images came back broken.
 */
async function readProjectSnapshot(): Promise<ProjectSnapshot | null> {
  const database = await openProjectDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([projectStoreName, assetStoreName], 'readonly');
    const blobs = new Map<string, Blob>();
    let draft: ProjectDraft | null = null;
    const request = transaction.objectStore(projectStoreName).get(autosaveKey);
    request.onsuccess = () => {
      if (!isProjectDraft(request.result)) return;
      draft = request.result;
      const assets = transaction.objectStore(assetStoreName);
      for (const id of draftAssetIds(draft)) {
        const asset = assets.get(id);
        asset.onsuccess = () => {
          if (asset.result instanceof Blob) blobs.set(id, asset.result);
        };
      }
    };
    transaction.oncomplete = () => resolve(draft ? { draft, blobs } : null);
    transaction.onerror = () => reject(transaction.error || new Error('Could not read the saved project.'));
    transaction.onabort = () => reject(transaction.error || new Error('Could not read the saved project.'));
  });
}

/**
 * Swaps a saved draft's asset tokens (and any base64 images from older drafts) for blob URLs, in the
 * showcase area and in removed showcases. Rejects if a file is missing rather than restore broken images.
 */
async function hydrateProjectDraft({ draft, blobs }: ProjectSnapshot): Promise<ProjectDraft> {
  const [showcaseAreaHtml, ...removedHtml] = await Promise.all([
    hydrateArtworkUrls(draft.showcaseAreaHtml, blobs),
    ...(draft.removedShowcases || []).map((showcase) => hydrateArtworkUrls(showcase.html, blobs)),
  ]);
  return {
    ...draft,
    showcaseAreaHtml,
    ...(draft.removedShowcases ? { removedShowcases: draft.removedShowcases.map((showcase, index) => ({ ...showcase, html: removedHtml[index] })) } : {}),
  };
}

/**
 * Saves the draft; its artwork files are written once and dropped when the draft no longer uses them.
 * `files` holds the blobs captured when the draft was made. A referenced file that is neither stored
 * nor captured aborts the save, so a draft with broken images never replaces a good one.
 */
async function writeProjectDraft(draft: ProjectDraft, files: Map<string, Blob>): Promise<void> {
  const database = await openProjectDatabase();
  const assetIds = draftAssetIds(draft);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([projectStoreName, assetStoreName], 'readwrite');
    let missing = 0;
    const assets = transaction.objectStore(assetStoreName);
    const storedKeys = assets.getAllKeys();
    storedKeys.onsuccess = () => {
      const stored = new Set(storedKeys.result.map(String));
      const referenced = new Set(assetIds);
      missing = assetIds.filter((id) => !stored.has(id) && !files.has(id)).length;
      if (missing) {
        transaction.abort();
        return;
      }
      transaction.objectStore(projectStoreName).put(draft, autosaveKey);
      for (const id of assetIds) {
        const blob = files.get(id);
        if (!stored.has(id) && blob) assets.put(blob, id);
      }
      for (const id of stored) if (!referenced.has(id)) assets.delete(id);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not save the project locally.'));
    transaction.onabort = () => reject(missing
      ? new Error(`Autosave skipped: ${missing} image${missing === 1 ? ' is' : 's are'} missing.`)
      : transaction.error || new Error('Could not save the project locally.'));
  });
}

function serializeShowcaseArea(document: Document): string {
  const area = document.querySelector<HTMLElement>('.profile_leftcol > .profile_customization_area');
  if (!area) return '';
  const copy = area.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[data-steamcanvas-showcase-controls], [data-steamcanvas-drag-placeholder], [data-steamcanvas-dragging="true"]').forEach((element) => element.remove());
  for (const element of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
    element.removeAttribute('data-steamcanvas-showcase-controls');
    element.removeAttribute('data-steamcanvas-showcase-id');
    element.removeAttribute('data-steamcanvas-draggable');
    element.removeAttribute('data-steamcanvas-dragging');
  }
  return copy.innerHTML;
}

function restoreShowcaseArea(document: Document, html: string): void {
  const area = ensureShowcaseArea(document);
  if (!area) return;
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script, iframe, object, embed, form').forEach((element) => element.remove());
  template.content.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || attribute.name === 'srcdoc') element.removeAttribute(attribute.name);
      if (/^(href|src|xlink:href)$/i.test(attribute.name) && /^\s*javascript:/i.test(attribute.value)) element.removeAttribute(attribute.name);
    }
  });
  area.replaceChildren(template.content.cloneNode(true));
}

function isProjectDraft(value: unknown): value is ProjectDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  const settings = draft.settings;
  if (!settings || typeof settings !== 'object') return false;
  const state = settings as Record<string, unknown>;
  const avatarEdit = state.avatarEdit;
  const frame = state.avatarFrame;
  const background = state.background;
  const theme = state.profileTheme;
  const avatarIsValid = !!avatarEdit && typeof avatarEdit === 'object'
    && ((avatarEdit as Record<string, unknown>).imageUrl === null || typeof (avatarEdit as Record<string, unknown>).imageUrl === 'string');
  const frameIsValid = frame === null || (!!frame && typeof frame === 'object'
    && typeof (frame as Record<string, unknown>).imageUrl === 'string'
    && ((frame as Record<string, unknown>).animatedImageUrl === undefined || typeof (frame as Record<string, unknown>).animatedImageUrl === 'string'));
  const backgroundIsValid = background === null || (!!background && typeof background === 'object'
    && typeof (background as Record<string, unknown>).imageUrl === 'string');
  const themeIsValid = theme === null || (!!theme && typeof theme === 'object'
    && !!(theme as Record<string, unknown>).variables
    && typeof (theme as Record<string, unknown>).variables === 'object'
    && Object.values((theme as { variables: Record<string, unknown> }).variables).every((item) => typeof item === 'string'));
  return draft.format === 'steamcanvas-project'
    && draft.version === 1
    && typeof draft.profileIdentifier === 'string'
    && typeof draft.showcaseAreaHtml === 'string'
    && (draft.removedShowcases === undefined || (Array.isArray(draft.removedShowcases) && draft.removedShowcases.every((item) => {
      if (!item || typeof item !== 'object') return false;
      const showcase = item as Record<string, unknown>;
      return typeof showcase.key === 'string' && typeof showcase.title === 'string'
        && typeof showcase.html === 'string' && Number.isInteger(showcase.index)
        && (showcase.beforeKey === null || typeof showcase.beforeKey === 'string')
        && (showcase.afterKey === null || typeof showcase.afterKey === 'string');
    })))
    && avatarIsValid
    && frameIsValid
    && backgroundIsValid
    && (state.backgroundSize === undefined || state.backgroundSize === 'full' || state.backgroundSize === 'original')
    && themeIsValid
    && Number.isFinite(state.previewLevel);
}

function SiteDisclaimer() {
  return (
    <p className="site-disclaimer">
      <strong>Disclaimer:</strong> SteamCanvas is an unofficial, community-made project. It is not affiliated with, endorsed by, sponsored by, or approved by Valve Corporation or Steam. "Steam" and related names and logos are trademarks of Valve Corporation and are used here only to describe compatibility.
    </p>
  );
}

export default function App() {
  const [motionEnabled, setMotionEnabled] = useState(
    () => typeof window === 'undefined' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [motionLayout, setMotionLayout] = useState(0);
  const [identifier, setIdentifier] = useState('');
  const [profile, setProfile] = useState<ProfilePreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [avatarEdit, setAvatarEdit] = useState<AvatarEditState>(DEFAULT_AVATAR_EDIT);
  const [avatarFrame, setAvatarFrame] = useState<SteamAvatarFrame | null>(null);
  const [background, setBackground] = useState<SteamBackground | null>(null);
  const [backgroundSize, setBackgroundSize] = useState<ProfileBackgroundSize>('full');
  const [profileTheme, setProfileTheme] = useState<AppliedProfileTheme | null>(null);
  const [previewLevel, setPreviewLevel] = useState(0);
  const [sourceBackgroundImage, setSourceBackgroundImage] = useState('');
  const [sourceBackgroundAnimated, setSourceBackgroundAnimated] = useState(false);
  const backgroundIsAnimated = background ? Boolean(background.animated) : sourceBackgroundAnimated;
  const [sourceAvatarFrameImage, setSourceAvatarFrameImage] = useState('');
  const [showcaseDocument, setShowcaseDocument] = useState<Document | null>(null);
  const [showcaseAddTarget, setShowcaseAddTarget] = useState<HTMLDivElement | null>(null);
  const [guideSlug, setGuideSlug] = useState<string | null>(null);
  const [showcaseTrashTarget, setShowcaseTrashTarget] = useState<HTMLDivElement | null>(null);
  const [removedShowcases, setRemovedShowcases] = useState<RemovedShowcase[]>([]);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [projectStatus, setProjectStatus] = useState('Autosave ready');
  const [savedDraft, setSavedDraft] = useState<ProjectDraft | null>(null);
  // The status bar is not shown before a profile loads, so a blocked database upgrade is explained here.
  const [storageBlocked, setStorageBlocked] = useState(false);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const changelogDialog = useRef<HTMLDialogElement>(null);
  const [changelogSeen, setChangelogSeen] = useState(() => readChangelogSeen() === changelogEntries[0].date);
  const exportAssetsRef = useRef<(() => Promise<void>) | null>(null);
  const pendingDraft = useRef<ProjectDraft | null>(null);
  // Read by the artwork sweep, which runs outside React's render cycle.
  const artworkRoots = useRef<{ document: Document | null; removed: RemovedShowcase[] }>({ document: null, removed: [] });
  artworkRoots.current = { document: showcaseDocument, removed: removedShowcases };
  const identifierRef = useRef('');
  const sourceBackgroundStyle = useRef<string | null>(null);
  const sourceBackgroundVideo = useRef<HTMLElement | null>(null);
  const sourceAvatarFrame = useRef<HTMLElement | null>(null);
  const sourceBodyClass = useRef('');
  const sourceThemeVariables = useRef<Record<string, { value: string; priority: string }>>({});

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotionPreference = () => setMotionEnabled(!reducedMotion.matches);
    reducedMotion.addEventListener('change', syncMotionPreference);
    return () => reducedMotion.removeEventListener('change', syncMotionPreference);
  }, []);

  useEffect(() => {
    if (!motionEnabled || profile) return;

    const timer = window.setInterval(
      () => setMotionLayout((layout) => (layout + 1) % mosaicLayouts.length),
      2400,
    );

    return () => window.clearInterval(timer);
  }, [motionEnabled, profile]);

  const themeVariableNames = [
    '--gradient-right', '--gradient-left', '--gradient-background', '--gradient-background-right',
    '--gradient-background-left', '--color-showcase-header', '--gradient-showcase-header-left',
    '--btn-background', '--btn-background-hover', '--btn-outline',
  ];

  useEffect(() => {
    if (!profile || !previewLoaded) return;

    const frameDocument = previewFrame.current?.contentDocument;
    const picture = frameDocument?.querySelector<HTMLPictureElement>('.playerAvatarAutoSizeInner > picture');
    const image = picture?.querySelector('img');
    const imageSource = avatarEdit.imageUrl || profile.avatar;
    if (!picture || !image || !imageSource) return;

    picture.querySelectorAll('source').forEach((source) => source.removeAttribute('srcset'));
    image.removeAttribute('srcset');
    image.src = imageSource;
    picture.style.display = 'block';
    picture.style.width = '100%';
    picture.style.height = '100%';
    picture.style.overflow = 'hidden';
    picture.style.borderRadius = '0';
    image.style.width = '100%';
    image.style.height = '100%';
    image.style.objectFit = 'cover';
    image.style.borderRadius = '0';
    image.style.boxSizing = 'border-box';
    image.style.removeProperty('object-position');
    image.style.removeProperty('transform');
    image.style.removeProperty('transform-origin');
    image.style.removeProperty('border');
  }, [avatarEdit, previewLoaded, profile]);

  useEffect(() => {
    if (!profile || !previewLoaded) return;

    const avatarInner = previewFrame.current?.contentDocument?.querySelector<HTMLElement>('.playerAvatarAutoSizeInner');
    if (!avatarInner) return;
    avatarInner.querySelector('.profile_avatar_frame')?.remove();

    const frameElement = avatarFrame
      ? avatarInner.ownerDocument.createElement('div')
      : sourceAvatarFrame.current?.cloneNode(true) as HTMLElement | undefined;
    if (!frameElement) return;

    frameElement.classList.add('profile_avatar_frame');
    if (avatarFrame) {
      const picture = avatarInner.ownerDocument.createElement('picture');
      if (avatarFrame.animatedImageUrl) {
        const animatedSource = avatarInner.ownerDocument.createElement('source');
        animatedSource.media = '(prefers-reduced-motion: no-preference)';
        animatedSource.srcset = avatarFrame.animatedImageUrl;
        picture.append(animatedSource);
        const reducedMotionSource = avatarInner.ownerDocument.createElement('source');
        reducedMotionSource.media = '(prefers-reduced-motion: reduce)';
        reducedMotionSource.srcset = avatarFrame.imageUrl;
        picture.append(reducedMotionSource);
      }
      const image = avatarInner.ownerDocument.createElement('img');
      image.src = avatarFrame.imageUrl;
      image.alt = '';
      picture.append(image);
      frameElement.replaceChildren(picture);
    }
    avatarInner.insertBefore(frameElement, avatarInner.firstElementChild);
  }, [avatarFrame, previewLoaded, profile]);

  useEffect(() => {
    if (!profile || !previewLoaded) return;
    const level = previewFrame.current?.contentDocument?.querySelector<HTMLElement>('.profile_header_badgeinfo .friendPlayerLevelNum');
    if (level) level.textContent = String(previewLevel);
  }, [previewLevel, previewLoaded, profile]);

  useEffect(() => {
    if (!profile || !previewLoaded) return;
    const body = previewFrame.current?.contentDocument?.body;
    if (!body) return;

    body.className = sourceBodyClass.current;
    if (profileTheme) {
      for (const className of [...body.classList]) {
        if (className.endsWith('Theme')) body.classList.remove(className);
      }
      if (profileTheme.themeClass) body.classList.add(profileTheme.themeClass);
    }
    for (const property of themeVariableNames) {
      const value = profileTheme?.variables[property];
      if (value) {
        body.style.setProperty(property, value);
        continue;
      }
      const original = sourceThemeVariables.current[property];
      if (original?.value) body.style.setProperty(property, original.value, original.priority);
      else body.style.removeProperty(property);
    }
  }, [profileTheme, previewLoaded, profile]);

  useEffect(() => {
    if (!profile || !previewLoaded) return;

    const document = previewFrame.current?.contentDocument;
    if (!document) return;
    document.querySelectorAll('video').forEach((video) => {
      video.controls = false;
      video.removeAttribute('controls');
    });

    const page = document.querySelector<HTMLElement>('.no_header.profile_page');
    if (!page) return;
    page.querySelectorAll('.profile_animated_background').forEach((element) => element.remove());
    if (sourceBackgroundStyle.current !== null) {
      page.setAttribute('style', sourceBackgroundStyle.current);
    } else {
      page.removeAttribute('style');
    }

    if (background) {
      if (background.animated && (background.videoWebm || background.videoMp4)) {
        page.style.setProperty('background-image', 'none', 'important');
        const wrapper = page.ownerDocument.createElement('div');
        wrapper.className = 'profile_animated_background';
        wrapper.dataset.steamcanvasBackgroundVideo = 'true';

        const video = page.ownerDocument.createElement('video');
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.controls = false;
        video.playsInline = true;
        video.poster = background.videoPoster || background.imageUrl;
        video.setAttribute('aria-hidden', 'true');

        if (background.videoWebm) {
          const source = page.ownerDocument.createElement('source');
          source.src = background.videoWebm;
          source.type = 'video/webm';
          video.append(source);
        }
        if (background.videoMp4) {
          const source = page.ownerDocument.createElement('source');
          source.src = background.videoMp4;
          source.type = 'video/mp4';
          video.append(source);
        }

        wrapper.append(video);
        page.prepend(wrapper);
        void video.play().catch(() => {});
      } else {
        page.style.setProperty('background-image', `url("${background.imageUrl}")`, 'important');
      }
    } else if (sourceBackgroundVideo.current) {
      const originalBackground = sourceBackgroundVideo.current.cloneNode(true) as HTMLElement;
      originalBackground.querySelectorAll('video').forEach((video) => {
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.controls = false;
        video.removeAttribute('controls');
        video.playsInline = true;
        void video.play().catch(() => {});
      });
      page.prepend(originalBackground);
    }
    page.classList.toggle('full_width_background', backgroundIsAnimated || backgroundSize === 'full');
  }, [background, backgroundIsAnimated, backgroundSize, previewLoaded, profile]);

  async function loadProfileByIdentifier(rawIdentifier: string, snapshot: ProjectSnapshot | null = null) {
    const draft = snapshot?.draft ?? null;
    const nextIdentifier = rawIdentifier.trim();
    if (!nextIdentifier || loading) return;

    identifierRef.current = nextIdentifier;
    setIdentifier(nextIdentifier);
    setLoading(true);
    setError('');
    setProjectStatus(draft ? 'Restoring project' : 'Autosave ready');
    pendingDraft.current = null;
    setProfile(null);
    setPreviewLoaded(false);
    setShowcaseDocument(null);
    setRemovedShowcases([]);
    setAvatarEdit(draft?.settings.avatarEdit || DEFAULT_AVATAR_EDIT);
    setAvatarFrame(draft?.settings.avatarFrame || null);
    setBackground(draft?.settings.background || null);
    setBackgroundSize(draft?.settings.backgroundSize === 'original' ? 'original' : 'full');
    setProfileTheme(draft?.settings.profileTheme || null);
    setPreviewLevel(draft?.settings.previewLevel ?? 0);
    setSourceBackgroundImage('');
    setSourceAvatarFrameImage('');
    sourceBackgroundStyle.current = null;
    sourceBackgroundVideo.current = null;
    sourceAvatarFrame.current = null;
    sourceBodyClass.current = '';
    sourceThemeVariables.current = {};

    try {
      // The draft's artwork files are read from storage while the profile downloads.
      const hydrating = snapshot ? hydrateProjectDraft(snapshot) : null;
      hydrating?.catch(() => undefined);
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: nextIdentifier }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load this profile.');
      if (hydrating) {
        const restored = await hydrating;
        pendingDraft.current = restored;
        setRemovedShowcases(restored.removedShowcases || []);
      }
      const loadedProfile = result as ProfilePreview;
      setProfile(loadedProfile);
      if (!draft) setPreviewLevel(loadedProfile.level ?? 0);
    } catch (caught) {
      pendingDraft.current = null;
      if (draft) setProjectStatus('Project restore failed');
      setError(caught instanceof Error ? caught.message : 'Something went wrong while loading the profile.');
    } finally {
      setLoading(false);
    }
  }

  async function loadProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadProfileByIdentifier(identifier);
  }

  /** Reads the saved draft again rather than the copy cached at startup: another tab may have replaced it. */
  async function resumeSavedDraft() {
    if (loading) return;
    setError('');
    setProjectStatus('Restoring project');
    try {
      const snapshot = await readProjectSnapshot();
      setSavedDraft(snapshot?.draft ?? null);
      if (!snapshot) {
        setProjectStatus('No saved draft');
        return;
      }
      await loadProfileByIdentifier(snapshot.draft.profileIdentifier, snapshot);
    } catch (caught) {
      setProjectStatus('Project restore failed');
      setError(caught instanceof Error ? caught.message : 'Could not read the saved project.');
    }
  }

  /** The draft with asset tokens in place of blob URLs, and the files those tokens refer to. */
  function createProjectDraft(document: Document): { draft: ProjectDraft; files: Map<string, Blob> } {
    if (!profile) throw new Error('Load a profile before exporting a project.');
    const files = new Map<string, Blob>();
    const dehydrate = (html: string) => {
      const result = dehydrateArtworkUrls(html);
      for (const [id, blob] of result.assets) files.set(id, blob);
      return result.html;
    };
    return {
      draft: {
        format: 'steamcanvas-project',
        version: 1,
        profileIdentifier: profile.url,
        // Placed artwork is kept as blob URLs; the draft stores asset tokens and the files separately.
        showcaseAreaHtml: dehydrate(serializeShowcaseArea(document)),
        // Removed originals can be restored from the trash after a reload, so their artwork is kept too.
        removedShowcases: removedShowcases.map((showcase) => ({ ...showcase, html: dehydrate(showcase.html) })),
        settings: { avatarEdit, avatarFrame, background, backgroundSize, profileTheme, previewLevel },
      },
      files,
    };
  }

  async function exportProject() {
    try {
      if (!exportAssetsRef.current) throw new Error('Load a profile before exporting showcase artwork.');
      setProjectStatus('Preparing profile preview ZIP');
      await exportAssetsRef.current();
      setProjectStatus('Profile preview and artwork ZIP exported');
    } catch (caught) {
      setProjectStatus(caught instanceof Error ? caught.message : 'Profile preview ZIP export failed');
    }
  }

  function resetProfilePreview() {
    if (!profile || !previewLoaded || loading) return;
    const confirmed = globalThis.confirm('Reset this preview to the loaded Steam profile? All showcase edits and appearance changes will be discarded.');
    if (!confirmed) return;

    pendingDraft.current = null;
    setPreviewLoaded(false);
    setShowcaseDocument(null);
    setAvatarEdit(DEFAULT_AVATAR_EDIT);
    setAvatarFrame(null);
    setBackground(null);
    setBackgroundSize('full');
    setProfileTheme(null);
    setPreviewLevel(profile.level ?? 0);
    setRemovedShowcases([]);
    setSourceBackgroundImage('');
    setSourceAvatarFrameImage('');
    setProjectStatus('Resetting profile preview');
    sourceBackgroundStyle.current = null;
    sourceBackgroundVideo.current = null;
    sourceAvatarFrame.current = null;
    sourceBodyClass.current = '';
    sourceThemeVariables.current = {};
    setPreviewRevision((revision) => revision + 1);
  }

  useEffect(() => {
    let active = true;
    onProjectStorageBlocked = () => {
      if (!active) return;
      setStorageBlocked(true);
      setProjectStatus('Close other SteamCanvas tabs to use local autosave');
    };
    void readProjectDraft().then((draft) => {
      if (active) setStorageBlocked(false);
      if (!active || identifierRef.current) return;
      if (draft && isProjectDraft(draft)) {
        setSavedDraft(draft);
        setProjectStatus('Saved draft available');
      } else {
        setProjectStatus('Autosave ready');
      }
    }).catch(() => {
      if (active) setProjectStatus('Local autosave unavailable');
    });
    return () => {
      active = false;
      onProjectStorageBlocked = null;
    };
  }, []);

  // Placed artwork that neither the preview nor the trash refers to any more is released from memory.
  useEffect(() => {
    setArtworkRoots(() => {
      const { document, removed } = artworkRoots.current;
      return [document?.body?.innerHTML || '', ...removed.map((showcase) => showcase.html)];
    });
    const interval = globalThis.setInterval(sweepArtwork, 15_000);
    return () => {
      globalThis.clearInterval(interval);
      setArtworkRoots(null);
    };
  }, []);

  useEffect(() => {
    if (!profile || !previewLoaded || !showcaseDocument) return;
    let timer: ReturnType<typeof globalThis.setTimeout>;
    const saveDraft = () => {
      globalThis.clearTimeout(timer);
      timer = globalThis.setTimeout(() => {
        // A save now would wait on the blocked database and hide why; this effect saves again once it opens.
        if (storageBlocked) {
          setProjectStatus('Close other SteamCanvas tabs to use local autosave');
          return;
        }
        try {
          const { draft, files } = createProjectDraft(showcaseDocument);
          setProjectStatus('Saving draft');
          void writeProjectDraft(draft, files).then(() => {
            setSavedDraft(draft);
            setProjectStatus('Draft saved locally');
            scheduleArtworkSweep();
          }).catch((caught) => setProjectStatus(caught instanceof Error && caught.message.startsWith('Autosave') ? caught.message : 'Autosave failed'));
        } catch {
          setProjectStatus('Autosave failed');
        }
      }, 700);
    };
    let observedArea = showcaseDocument.querySelector<HTMLElement>('.profile_leftcol > .profile_customization_area');
    let observer: MutationObserver;
    observer = new MutationObserver(() => {
      if (!observedArea) {
        observedArea = showcaseDocument.querySelector<HTMLElement>('.profile_leftcol > .profile_customization_area');
        if (observedArea) {
          observer.disconnect();
          observer.observe(observedArea, { subtree: true, childList: true, attributes: true, characterData: true });
        }
      }
      saveDraft();
    });
    if (observedArea) {
      observer.observe(observedArea, { subtree: true, childList: true, attributes: true, characterData: true });
    } else {
      observer.observe(showcaseDocument.documentElement, { subtree: true, childList: true });
    }
    saveDraft();
    return () => {
      globalThis.clearTimeout(timer);
      observer.disconnect();
    };
  }, [profile, previewLoaded, showcaseDocument, avatarEdit, avatarFrame, background, backgroundSize, profileTheme, previewLevel, removedShowcases, storageBlocked]);

  return (
    <main className={`app-shell${profile ? ' has-profile' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <a className="brand-home" href="/" aria-label="SteamCanvas home">
            <span className="brand-mark"><PanelsTopLeft size={18} strokeWidth={2.1} /></span>
            <span>steam<span className="brand-light">canvas</span></span>
          </a>
          <a className="author-credit" href="https://github.com/dumbapplee" target="_blank" rel="noreferrer">by dumbapplee</a>
        </div>
        <nav className="topbar-actions" aria-label="Site navigation">
          <button className="topbar-link guide-trigger" type="button" aria-haspopup="dialog" onClick={() => setGuideSlug('featured-artwork')}>Guides</button>
          <button className="topbar-link changelog-trigger" type="button" aria-label="Open changelog" aria-haspopup="dialog" onClick={() => {
            changelogDialog.current?.showModal();
            if (changelogSeen) return;
            try {
              localStorage.setItem(changelogSeenKey, changelogEntries[0].date);
            } catch {
              // Storage can be unavailable; the dot will simply show again next visit.
            }
            setChangelogSeen(true);
          }}><History size={15} /><span>Changelog</span>{!changelogSeen && <i className="changelog-new-dot" aria-hidden="true" />}</button>
          <a className="topbar-link" href="https://github.com/dumbapplee/steamcanvas" target="_blank" rel="noreferrer"><Github size={15} /> GitHub <ExternalLink size={12} /></a>
          <a className="topbar-link" href="https://buymeacoffee.com/migueelss" target="_blank" rel="noreferrer"><Coffee size={15} /> Support me <ExternalLink size={12} /></a>
        </nav>
      </header>

      {!profile ? (
        <section className={`entry-screen${loading ? ' is-loading' : ''}`} aria-label="Load a Steam profile">
          <div className="entry-copy">
            <div className="entry-overline"><span className="entry-overline-dot" /> A LITTLE STUDIO FOR YOUR STEAM PROFILE</div>
            <h1>Your profile.<br /><em>Your style.</em></h1>
            <p className="entry-description">Switch up the avatar, art, colours and showcases. See what feels right on your real profile before you change a thing.</p>
            <form className="entry-form" onSubmit={loadProfile}>
              <label htmlFor="steam-identifier">Start with a public profile</label>
              <div className={`entry-input${error ? ' has-error' : ''}`}>
                <Search size={19} aria-hidden="true" />
                <input
                  id="steam-identifier"
                  value={identifier}
                  onChange={(event) => { identifierRef.current = event.target.value; setIdentifier(event.target.value); }}
                  placeholder="Profile URL, custom name or SteamID64"
                  autoComplete="url"
                  spellCheck={false}
                  autoFocus
                />
                <button className="entry-submit" type="submit" disabled={loading || !identifier.trim()} aria-label="Load profile">
                  {loading ? <LoaderCircle className="spin" size={20} /> : <ArrowUpRight size={21} />}
                </button>
              </div>
              {error ? <p className="entry-error" role="alert">{error}</p> : <p className="entry-hint"><ShieldCheck size={14} /> Public profiles only <span /> SteamID64, custom name, or profile URL</p>}
            </form>
            <div className="entry-actions">
              {savedDraft && <button className="entry-resume" type="button" onClick={() => void resumeSavedDraft()} disabled={loading}><PanelsTopLeft size={15} /> Resume saved draft</button>}
              {loading && <span className="entry-loading"><LoaderCircle className="spin" size={13} /> Fetching profile</span>}
              {storageBlocked && !loading && <span className="entry-loading" role="status">Close other SteamCanvas tabs to load your saved draft</span>}
            </div>
            <SiteDisclaimer />
          </div>

          <aside className="entry-tools" aria-label="Profile editor features">
            <div className="entry-tools-heading">
              <span>The toolkit</span>
              <button
                className="entry-motion-toggle"
                type="button"
                aria-label={motionEnabled ? 'Pause shape animation' : 'Play shape animation'}
                aria-pressed={motionEnabled}
                onClick={() => setMotionEnabled((enabled) => !enabled)}
              >
                {motionEnabled ? <Pause size={12} /> : <Play size={12} />}
                {motionEnabled ? 'Pause motion' : 'Play motion'}
              </button>
            </div>
            <div className="entry-tools-intro">
              <strong>One small tweak.<br />A whole new vibe.</strong>
              <span>Play with the details until they feel right.</span>
            </div>
            <div className={`entry-motion${motionEnabled ? ' is-playing' : ''}`} aria-hidden="true">
              <div
                className="motion-stage"
                style={{ gridTemplateColumns: mosaicLayouts[motionLayout].columns }}
              >
                {mosaicLayouts[motionLayout].order.map((piece) => (
                  <span
                    className={`mosaic-piece piece-${piece}`}
                    data-piece={piece}
                    key={piece}
                  />
                ))}
              </div>
            </div>
            <div className="entry-tools-list">
              <div className="entry-tool">
                <span className="entry-tool-index">01</span>
                <span className="entry-tool-copy"><strong>Avatar &amp; frame</strong><small>Get the crop and frame in sync</small></span>
                <span className="entry-tool-mark entry-tool-avatar" aria-hidden="true" />
              </div>
              <div className="entry-tool">
                <span className="entry-tool-index">02</span>
                <span className="entry-tool-copy"><strong>Profile theme</strong><small>Pick a colour mood for your page</small></span>
                <span className="entry-tool-swatches" aria-hidden="true"><i /><i /><i /></span>
              </div>
              <div className="entry-tool">
                <span className="entry-tool-index">03</span>
                <span className="entry-tool-copy"><strong>Background</strong><small>Find art that pulls it all together</small></span>
                <span className="entry-tool-mark entry-tool-background" aria-hidden="true" />
              </div>
              <div className="entry-tool">
                <span className="entry-tool-index">04</span>
                <span className="entry-tool-copy"><strong>Showcases</strong><small>Split one image across showcase panels</small></span>
                <span className="entry-tool-mark entry-tool-showcases" aria-hidden="true"><i /><i /><i /></span>
              </div>
            </div>
          </aside>
        </section>
      ) : (
      <section className="workspace workspace-arrive">
        <aside className="control-panel">
          <form className="profile-form" onSubmit={loadProfile}>
            <label htmlFor="steam-identifier">Steam profile</label>
            <div className={`input-wrap ${error ? 'has-error' : ''}`}>
              <Search size={17} aria-hidden="true" />
              <input
                id="steam-identifier"
                value={identifier}
                onChange={(event) => { identifierRef.current = event.target.value; setIdentifier(event.target.value); }}
                placeholder="ID, custom name or profile URL"
                autoComplete="url"
                spellCheck={false}
              />
              <button className="submit-button" type="submit" disabled={loading || !identifier.trim()} aria-label="Load profile">
                {loading ? <LoaderCircle className="spin" size={17} /> : <ArrowUpRight size={18} />}
              </button>
            </div>
            {error ? <p className="form-error" role="alert">{error}</p> : <p className="input-hint"><CircleHelp size={13} /> Accepts SteamID64, custom name, or full URL</p>}
          </form>

          <div className="source-block">
            <span className="source-label">Current source</span>
            {profile ? (
              <>
                <div className="source-identity">
                  {profile.avatar && <img src={profile.avatar} alt="" />}
                  <span>{profile.name}</span>
                  {profile.level !== undefined && <span className="source-level">LVL {profile.level}</span>}
                </div>
                <a className="source-url" href={profile.url} target="_blank" rel="noreferrer">
                  {profile.url.replace(/^https:\/\//, '')}<ExternalLink size={12} />
                </a>
              </>
            ) : <p className="source-empty">Waiting for a profile</p>}
          </div>

          {profile && (
            <>
              <AvatarEditor sourceAvatar={profile.avatar} value={avatarEdit} onChange={setAvatarEdit} />
              <AvatarFramePicker sourceAvatar={avatarEdit.imageUrl || profile.avatar} sourceFrameImage={sourceAvatarFrameImage} value={avatarFrame} onChange={setAvatarFrame} />
              <ProfileThemePicker value={profileTheme} onApply={setProfileTheme} />
              <BackgroundPicker sourceBackgroundImage={sourceBackgroundImage} value={background} onChange={setBackground} backgroundSize={backgroundSize} onBackgroundSizeChange={setBackgroundSize} isAnimated={backgroundIsAnimated} />
              <section className="showcase-add-section" aria-label="Showcases">
                <span className="source-label">Showcases</span>
                <div className="showcase-add-slot" ref={setShowcaseAddTarget} />
              </section>
              <SiteDisclaimer />
            </>
          )}

        </aside>

        <section className="preview-area" aria-label="Steam profile preview">
          <div className="preview-toolbar">
            <div className="preview-toolbar-actions" role="group" aria-label="Preview actions">
              <span className="draft-status" role="status" aria-live="polite">{projectStatus === 'Draft saved locally' && <Check size={13} />}{projectStatus}</span>
              {profile && <button className="project-action project-reset-action" type="button" onClick={resetProfilePreview} disabled={!previewLoaded || loading} title="Discard all preview changes and restore the loaded profile"><RotateCcw size={14} />Reset</button>}
              <button className="project-action" type="button" onClick={() => void exportProject()} disabled={!profile || !previewLoaded} title="Download the profile preview HTML and uploaded showcase artwork as ZIP"><Download size={14} />Export</button>
              {profile && <a className="open-source" href={profile.url} target="_blank" rel="noreferrer">Open on Steam <ExternalLink size={13} /></a>}
            </div>
          </div>
          <div className={`preview-stage ${profile ? 'has-profile' : ''}`}>
            {profile ? (
              <iframe
                key={previewRevision}
                ref={previewFrame}
                className="steam-frame"
                title={`Steam profile preview for ${profile.name}`}
                sandbox="allow-same-origin"
                srcDoc={profile.html}
                onLoad={() => {
                  const document = previewFrame.current?.contentDocument;
                  const restoredDraft = pendingDraft.current;
                  if (document && restoredDraft) {
                    restoreShowcaseArea(document, restoredDraft.showcaseAreaHtml);
                    pendingDraft.current = null;
                  }
                  if (document && !document.querySelector('#steamcanvas-hide-video-controls')) {
                    const style = document.createElement('style');
                    style.id = 'steamcanvas-hide-video-controls';
                    style.textContent = 'video::-webkit-media-controls,video::-webkit-media-controls-enclosure{display:none!important}';
                    document.head.append(style);
                  }
                  const page = previewFrame.current?.contentDocument?.querySelector<HTMLElement>('.no_header.profile_page');
                  const animatedBackground = page?.querySelector<HTMLElement>('.profile_animated_background');
                  const avatarFrameElement = previewFrame.current?.contentDocument?.querySelector<HTMLElement>('.playerAvatarAutoSizeInner .profile_avatar_frame');
                  const avatarFrameImage = avatarFrameElement?.querySelector<HTMLImageElement>('img');
                  const body = document?.body;
                  sourceBodyClass.current = body?.className || '';
                  sourceThemeVariables.current = Object.fromEntries(themeVariableNames.map((property) => [property, {
                    value: body?.style.getPropertyValue(property) || '',
                    priority: body?.style.getPropertyPriority(property) || '',
                  }]));
                  sourceBackgroundStyle.current = page?.getAttribute('style') ?? null;
                  sourceBackgroundVideo.current = animatedBackground ? animatedBackground.cloneNode(true) as HTMLElement : null;
                  sourceAvatarFrame.current = avatarFrameElement ? avatarFrameElement.cloneNode(true) as HTMLElement : null;
                  const poster = animatedBackground?.querySelector<HTMLVideoElement>('video')?.poster;
                  setSourceBackgroundImage(poster ? `url("${poster}")` : page ? getComputedStyle(page).backgroundImage : '');
                  setSourceBackgroundAnimated(Boolean(animatedBackground));
                  setSourceAvatarFrameImage(avatarFrameImage?.currentSrc || avatarFrameImage?.src || '');
                  setShowcaseDocument(document || null);
                  setPreviewLoaded(true);
                }}
              />
            ) : (
              <div className="empty-canvas">
                <h2>No profile loaded</h2>
                <p>Enter a public Steam profile on the left to see its layout here.</p>
              </div>
            )}
            {loading && <div className="loading-cover"><LoaderCircle className="spin" size={24} /><span>Fetching profile?</span></div>}
                <ShowcaseEditor
                  previewDocument={showcaseDocument}
                  profileUrl={profile?.url || ''}
                  profileName={profile?.name || 'steamcanvas'}
                  backgroundImageUrl={background?.imageUrl || sourceBackgroundImage}
                  backgroundIsAnimated={backgroundIsAnimated}
                  backgroundSize={backgroundSize}
                  addControlTarget={showcaseAddTarget}
                  trashControlTarget={showcaseTrashTarget}
                  removedShowcases={removedShowcases}
                  onRemovedShowcasesChange={setRemovedShowcases}
                  exportAssetsRef={exportAssetsRef}
                />
                {profile && <div className="showcase-trash-slot" ref={setShowcaseTrashTarget} />}
          </div>
        </section>
      </section>
      )}
      <SupportPopup />
      <dialog
        ref={changelogDialog}
        className="changelog-dialog"
        aria-labelledby="changelog-title"
        onClick={(event) => { if (event.target === event.currentTarget) changelogDialog.current?.close(); }}
      >
        <section className="changelog-content">
          <header className="changelog-header">
            <div>
              <span className="changelog-kicker">STEAMCANVAS · CHANGELOG</span>
              <h2 id="changelog-title">What’s been happening</h2>
              <p>A short history of what’s been added to the profile studio.</p>
            </div>
            <button className="icon-button changelog-close" type="button" aria-label="Close changelog" onClick={() => changelogDialog.current?.close()}><X size={17} /></button>
          </header>
          <div className="changelog-list">
            {changelogEntries.map((entry) => <article className="changelog-entry" key={entry.date}>
              <div className="changelog-entry-meta"><time dateTime={entry.date}>{entry.displayDate}</time><span>{entry.category}</span></div>
              <h3>{entry.title}</h3>
              <ul>{entry.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
            </article>)}
          </div>
          <footer className="changelog-footer">A retrospective of SteamCanvas updates, based on the project history.</footer>
        </section>
      </dialog>
      <GuideDialog slug={guideSlug} onSlugChange={setGuideSlug} onClose={() => setGuideSlug(null)} />
    </main>
  );
}