import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowUpRight, Check, CircleHelp, Download, ExternalLink, Github, LoaderCircle, PanelsTopLeft, Search, ShieldCheck, Upload } from 'lucide-react';
import AvatarEditor, { DEFAULT_AVATAR_EDIT, type AvatarEditState } from './components/AvatarEditor';
import AvatarFramePicker, { type SteamAvatarFrame } from './components/AvatarFramePicker';
import BackgroundPicker, { type SteamBackground } from './components/BackgroundPicker';
import ProfileThemePicker, { type AppliedProfileTheme } from './components/ProfileThemePicker';
import ShowcaseEditor, { type RemovedShowcase } from './components/ShowcaseEditor';

type ProfilePreview = {
  name: string;
  url: string;
  html: string;
  avatar?: string;
  level?: number;
};

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
    profileTheme: AppliedProfileTheme | null;
    previewLevel: number;
  };
};

const projectDatabaseName = 'steamcanvas-projects';
const projectStoreName = 'drafts';
const autosaveKey = 'autosave';
let projectDatabase: Promise<IDBDatabase> | null = null;

function openProjectDatabase(): Promise<IDBDatabase> {
  if (!projectDatabase) {
    projectDatabase = new Promise((resolve, reject) => {
      const request = indexedDB.open(projectDatabaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(projectStoreName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local project storage.'));
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

async function writeProjectDraft(draft: ProjectDraft): Promise<void> {
  const database = await openProjectDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(projectStoreName, 'readwrite');
    transaction.objectStore(projectStoreName).put(draft, autosaveKey);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not save the project locally.'));
    transaction.onabort = () => reject(transaction.error || new Error('Could not save the project locally.'));
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
  const column = document.querySelector<HTMLElement>('.profile_leftcol');
  if (!column) return;
  let area = column.querySelector<HTMLElement>(':scope > .profile_customization_area');
  if (!area) {
    area = document.createElement('div');
    area.className = 'profile_customization_area';
    column.append(area);
  }
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
    && themeIsValid
    && Number.isFinite(state.previewLevel);
}

export default function App() {
  const [identifier, setIdentifier] = useState('');
  const [profile, setProfile] = useState<ProfilePreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [avatarEdit, setAvatarEdit] = useState<AvatarEditState>(DEFAULT_AVATAR_EDIT);
  const [avatarFrame, setAvatarFrame] = useState<SteamAvatarFrame | null>(null);
  const [background, setBackground] = useState<SteamBackground | null>(null);
  const [profileTheme, setProfileTheme] = useState<AppliedProfileTheme | null>(null);
  const [previewLevel, setPreviewLevel] = useState(0);
  const [sourceBackgroundImage, setSourceBackgroundImage] = useState('');
  const [sourceAvatarFrameImage, setSourceAvatarFrameImage] = useState('');
  const [showcaseDocument, setShowcaseDocument] = useState<Document | null>(null);
  const [showcaseAddTarget, setShowcaseAddTarget] = useState<HTMLDivElement | null>(null);
  const [showcaseTrashTarget, setShowcaseTrashTarget] = useState<HTMLDivElement | null>(null);
  const [removedShowcases, setRemovedShowcases] = useState<RemovedShowcase[]>([]);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [projectStatus, setProjectStatus] = useState('Autosave ready');
  const [savedDraft, setSavedDraft] = useState<ProjectDraft | null>(null);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const projectFileInput = useRef<HTMLInputElement>(null);
  const pendingDraft = useRef<ProjectDraft | null>(null);
  const identifierRef = useRef('');
  const sourceBackgroundStyle = useRef<string | null>(null);
  const sourceBackgroundVideo = useRef<HTMLElement | null>(null);
  const sourceAvatarFrame = useRef<HTMLElement | null>(null);
  const sourceBodyClass = useRef('');
  const sourceThemeVariables = useRef<Record<string, { value: string; priority: string }>>({});

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
    if (profileTheme?.themeClass) {
      for (const className of [...body.classList]) {
        if (className.endsWith('Theme')) body.classList.remove(className);
      }
      body.classList.add(profileTheme.themeClass);
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

    const page = previewFrame.current?.contentDocument?.querySelector<HTMLElement>('.no_header.profile_page');
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
      page.prepend(sourceBackgroundVideo.current.cloneNode(true));
    }
  }, [background, previewLoaded, profile]);

  async function loadProfileByIdentifier(rawIdentifier: string, draft: ProjectDraft | null = null) {
    const nextIdentifier = rawIdentifier.trim();
    if (!nextIdentifier || loading) return;

    identifierRef.current = nextIdentifier;
    setIdentifier(nextIdentifier);
    setLoading(true);
    setError('');
    setProjectStatus(draft ? 'Restoring project' : 'Autosave ready');
    pendingDraft.current = draft;
    setProfile(null);
    setPreviewLoaded(false);
    setShowcaseDocument(null);
    setRemovedShowcases(draft?.removedShowcases || []);
    setAvatarEdit(draft?.settings.avatarEdit || DEFAULT_AVATAR_EDIT);
    setAvatarFrame(draft?.settings.avatarFrame || null);
    setBackground(draft?.settings.background || null);
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
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: nextIdentifier }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load this profile.');
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

  function createProjectDraft(document: Document): ProjectDraft {
    if (!profile) throw new Error('Load a profile before exporting a project.');
    return {
      format: 'steamcanvas-project',
      version: 1,
      profileIdentifier: profile.url,
      showcaseAreaHtml: serializeShowcaseArea(document),
      removedShowcases,
      settings: { avatarEdit, avatarFrame, background, profileTheme, previewLevel },
    };
  }

  async function exportProject() {
    const document = previewFrame.current?.contentDocument;
    if (!document || !profile) return;
    try {
      const draft = createProjectDraft(document);
      setSavedDraft(draft);
      void writeProjectDraft(draft).catch(() => setProjectStatus('Exported; local autosave unavailable'));
      const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = globalThis.document.createElement('a');
      const fileName = profile.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'steamcanvas';
      link.href = url;
      link.download = `${fileName}-project.json`;
      globalThis.document.body.append(link);
      link.click();
      link.remove();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setProjectStatus('Project exported');
    } catch (caught) {
      setProjectStatus(caught instanceof Error ? caught.message : 'Project export failed');
    }
  }

  async function importProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imported: unknown = JSON.parse(await file.text());
      if (!isProjectDraft(imported)) throw new Error('This is not a supported SteamCanvas project file.');
      if (!imported.profileIdentifier.trim()) throw new Error('The project does not include a profile identifier.');
      setSavedDraft(imported);
      setProjectStatus('Restoring project');
      await loadProfileByIdentifier(imported.profileIdentifier, imported);
    } catch (caught) {
      setProjectStatus(caught instanceof Error ? caught.message : 'Project import failed');
    }
  }

  useEffect(() => {
    let active = true;
    void readProjectDraft().then((draft) => {
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
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!profile || !previewLoaded || !showcaseDocument) return;
    let timer: ReturnType<typeof globalThis.setTimeout>;
    const saveDraft = () => {
      globalThis.clearTimeout(timer);
      timer = globalThis.setTimeout(() => {
        try {
          const draft = createProjectDraft(showcaseDocument);
          setProjectStatus('Saving draft');
          void writeProjectDraft(draft).then(() => {
            setSavedDraft(draft);
            setProjectStatus('Draft saved locally');
          }).catch(() => setProjectStatus('Autosave failed'));
        } catch {
          setProjectStatus('Autosave failed');
        }
      }, 700);
    };
    const observer = new MutationObserver(saveDraft);
    observer.observe(showcaseDocument.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    saveDraft();
    return () => {
      globalThis.clearTimeout(timer);
      observer.disconnect();
    };
  }, [profile, previewLoaded, showcaseDocument, avatarEdit, avatarFrame, background, profileTheme, previewLevel, removedShowcases]);

  return (
    <main className={`app-shell${profile ? ' has-profile' : ''}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="SteamCanvas home">
          <span className="brand-mark"><PanelsTopLeft size={18} strokeWidth={2.1} /></span>
          <span>steam<span className="brand-light">canvas</span></span>
        </a>
        <nav className="topbar-actions" aria-label="Project links">
          <a className="topbar-link" href="https://github.com/dumbapplee/steamcanvas" target="_blank" rel="noreferrer"><Github size={15} /> GitHub <ExternalLink size={12} /></a>
          <span className="topbar-link support-placeholder" aria-disabled="true" title="Support link coming soon">Support me</span>
        </nav>
        <input ref={projectFileInput} className="visually-hidden" type="file" accept="application/json,.json" aria-hidden="true" tabIndex={-1} onChange={(event) => void importProject(event)} />
      </header>

      {!profile ? (
        <section className={`entry-screen${loading ? ' is-loading' : ''}`} aria-label="Load a Steam profile">
          <div className="entry-copy">
            <div className="entry-overline"><span className="entry-overline-dot" /> STEAMCANVAS <span>PROFILE STUDIO / 01</span></div>
            <h1>Bring your Steam<br />profile <em>into view.</em></h1>
            <p className="entry-description">A live profile preview, with room to try new looks and make every detail yours.</p>
            <form className="entry-form" onSubmit={loadProfile}>
              <label htmlFor="steam-identifier">Start with your Steam profile</label>
              <div className={`entry-input${error ? ' has-error' : ''}`}>
                <Search size={19} aria-hidden="true" />
                <input
                  id="steam-identifier"
                  value={identifier}
                  onChange={(event) => { identifierRef.current = event.target.value; setIdentifier(event.target.value); }}
                  placeholder="Paste a profile URL or SteamID"
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
              {savedDraft && <button className="entry-resume" type="button" onClick={() => void loadProfileByIdentifier(savedDraft.profileIdentifier, savedDraft)} disabled={loading}><PanelsTopLeft size={15} /> Resume saved draft</button>}
              <button className="entry-import" type="button" onClick={() => projectFileInput.current?.click()} disabled={loading}><Upload size={15} /> Import a project</button>
              {loading && <span className="entry-loading"><LoaderCircle className="spin" size={13} /> FETCHING PROFILE</span>}
            </div>
            <div className="entry-footnote"><span>YOUR WORKSPACE</span><span>BUILT AROUND YOUR PROFILE</span></div>
          </div>

          <div className="entry-visual" aria-hidden="true">
            <div className="entry-visual-caption"><span>STEAM COMMUNITY / PROFILE</span><span className="entry-caption-mark">PUBLIC VIEW</span></div>
            <div className="entry-floating-level"><span>LVL</span><b>42</b><i /></div>
            <div className="entry-profile-card">
              <div className="entry-community-nav"><span className="entry-steam-logo"><i /><b>STEAM</b></span><div><span>STORE</span><strong>COMMUNITY</strong><span>ABOUT</span><span>SUPPORT</span></div><small>INSTALL STEAM &nbsp; sign in</small></div>
              <div className="entry-profile-hero">
                <div className="entry-profile-avatar"><i /></div>
                <div className="entry-profile-name"><strong>Player Name</strong><span>online · playing something great</span></div>
                <div className="entry-profile-level"><span>Level</span><b>42</b></div>
                <div className="entry-profile-badge"><i>★</i><span><b>Community Leader</b><small>218 XP</small></span></div>
              </div>
              <div className="entry-profile-columns">
                <section className="entry-activity">
                  <div className="entry-section-heading"><span>Recent Activity</span><small>2.7 hours past 2 weeks</small></div>
                  <div className="entry-game-card">
                    <div className="entry-game-art entry-game-art-one"><i /><b>GAME<br />01</b></div>
                    <div className="entry-game-info"><strong>Counter-Strike 2</strong><small>849 hrs on record<br />last played recently</small></div>
                    <div className="entry-achievements"><span>Achievement Progress <small>1 of 1</small></span><i><b /></i></div>
                  </div>
                  <div className="entry-game-card">
                    <div className="entry-game-art entry-game-art-two"><i /><b>GAME<br />02</b></div>
                    <div className="entry-game-info"><strong>Adventure Awaits</strong><small>41 hrs on record<br />last played this week</small></div>
                    <div className="entry-achievements"><span>Achievement Progress <small>7 of 47</small></span><i><b /></i></div>
                  </div>
                  <div className="entry-game-card entry-game-card-third">
                    <div className="entry-game-art entry-game-art-three"><i /><b>GAME<br />03</b></div>
                    <div className="entry-game-info"><strong>Racing Legends</strong><small>17.9 hrs on record</small></div>
                  </div>
                </section>
                <aside className="entry-profile-sidebar">
                  <div className="entry-offline-status">Currently Offline</div>
                  <div className="entry-profile-stats"><span>Badges <b>5</b></span><div className="entry-badges"><i>✦</i><i>25</i><i>10</i><i>★</i></div></div>
                  <div className="entry-profile-stats"><span>Games <b>34</b></span></div>
                  <div className="entry-profile-stats"><span>Inventory</span></div>
                  <div className="entry-profile-stats"><span>Groups <b>74</b></span><div className="entry-group"><i>B</i><span><b>Bulls' Academy</b><small>2 Members</small></span></div></div>
                </aside>
              </div>
              <div className="entry-steam-footer"><span>＋ &nbsp; ADD A GAME...</span><span>VIEW FRIENDS LIST &nbsp; · &nbsp; 0 Online</span></div>
            </div>
          </div>
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
            <span className="source-label">CURRENT SOURCE</span>
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
              <BackgroundPicker sourceBackgroundImage={sourceBackgroundImage} value={background} onChange={setBackground} />
              <section className="showcase-add-section" aria-label="Showcases">
                <span className="source-label">SHOWCASES</span>
                <div className="showcase-add-slot" ref={setShowcaseAddTarget} />
              </section>
            </>
          )}

          <div className="privacy-note"><ShieldCheck size={15} /><span>Only public profile pages are fetched. Private content stays private.</span></div>
          <div className="panel-index">STEAMCANVAS <span>PROFILE PREVIEW</span></div>
        </aside>

        <section className="preview-area" aria-label="Steam profile preview">
          <div className="preview-toolbar">
            <div className="preview-title"><span className={`live-dot ${profile ? 'is-live' : ''}`} />
              <span>{profile ? 'PROFILE PREVIEW' : 'PREVIEW CANVAS'}</span>
            </div>
            <div className="preview-toolbar-actions">
              <span className="draft-status" role="status" aria-live="polite">{projectStatus === 'Draft saved locally' && <Check size={13} />}{projectStatus}</span>
              <button className="project-action" type="button" onClick={() => void exportProject()} disabled={!profile || !previewLoaded} title="Export project as JSON"><Download size={14} />Export</button>
              <button className="project-action" type="button" onClick={() => projectFileInput.current?.click()} disabled={loading} title="Import a SteamCanvas project"><Upload size={14} />Import</button>
              {profile && <a className="open-source" href={profile.url} target="_blank" rel="noreferrer">Open on Steam <ExternalLink size={13} /></a>}
            </div>
          </div>
          <div className={`preview-stage ${profile ? 'has-profile' : ''}`}>
            {profile ? (
              <iframe
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
                  setSourceAvatarFrameImage(avatarFrameImage?.currentSrc || avatarFrameImage?.src || '');
                  setShowcaseDocument(document || null);
                  setPreviewLoaded(true);
                }}
              />
            ) : (
              <div className="empty-canvas">
                <div className="empty-art" aria-hidden="true">
                  <div className="art-window"><div className="art-topline"><i /><i /><i /></div><div className="art-avatar" /><div className="art-lines"><i /><i /><i /></div></div>
                </div>
                <span className="empty-kicker">YOUR CANVAS IS READY</span>
                <h2>A profile, in its<br /><em>own element.</em></h2>
                <p>Enter a public Steam profile to bring its live layout into view.</p>
                <div className="empty-coordinate">45° 26′ 11.8″ N <span>/</span> 12° 20′ 05.4″ E</div>
              </div>
            )}
            {loading && <div className="loading-cover"><LoaderCircle className="spin" size={24} /><span>FETCHING PUBLIC PROFILE</span></div>}
                <ShowcaseEditor
                  previewDocument={showcaseDocument}
                  profileUrl={profile?.url || ''}
                  addControlTarget={showcaseAddTarget}
                  trashControlTarget={showcaseTrashTarget}
                  removedShowcases={removedShowcases}
                  onRemovedShowcasesChange={setRemovedShowcases}
                />
                {profile && <div className="showcase-trash-slot" ref={setShowcaseTrashTarget} />}
          </div>
        </section>
      </section>
      )}
    </main>
  );
}