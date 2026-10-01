import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, CircleHelp, ExternalLink, LoaderCircle, PanelsTopLeft, Search, ShieldCheck } from 'lucide-react';
import AvatarEditor, { DEFAULT_AVATAR_EDIT, type AvatarEditState } from './components/AvatarEditor';
import AvatarFramePicker, { type SteamAvatarFrame } from './components/AvatarFramePicker';
import BackgroundPicker, { type SteamBackground } from './components/BackgroundPicker';
import ProfileThemePicker, { type AppliedProfileTheme } from './components/ProfileThemePicker';
import ShowcaseEditor from './components/ShowcaseEditor';

type ProfilePreview = {
  name: string;
  url: string;
  html: string;
  avatar?: string;
  level?: number;
};

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
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const previewFrame = useRef<HTMLIFrameElement>(null);
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

  async function loadProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!identifier.trim() || loading) return;

    setLoading(true);
    setError('');
    setProfile(null);
    setPreviewLoaded(false);
    setShowcaseDocument(null);
    setAvatarEdit(DEFAULT_AVATAR_EDIT);
    setAvatarFrame(null);
    setBackground(null);
    setProfileTheme(null);
    setPreviewLevel(0);
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
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load this profile.');
      const loadedProfile = result as ProfilePreview;
      setProfile(loadedProfile);
      setPreviewLevel(loadedProfile.level ?? 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong while loading the profile.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="SteamCanvas home">
          <span className="brand-mark"><PanelsTopLeft size={18} strokeWidth={2.1} /></span>
          <span>steam<span className="brand-light">canvas</span></span>
        </a>
        <div className="topbar-note"><ShieldCheck size={15} /> Preview only <span className="note-divider">/</span> No Steam changes</div>
      </header>

      <section className="workspace">
        <aside className="control-panel">
          <div className="panel-heading">
            <div className="eyebrow">PROFILE VIEWER <span>01</span></div>
            <h1>See the<br /><em>whole picture.</em></h1>
            <p className="panel-copy">Load a public Steam profile as it appears on Steam.</p>
          </div>

          <form className="profile-form" onSubmit={loadProfile}>
            <label htmlFor="steam-identifier">Steam profile</label>
            <div className={`input-wrap ${error ? 'has-error' : ''}`}>
              <Search size={17} aria-hidden="true" />
              <input
                id="steam-identifier"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
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
              <AvatarFramePicker
                sourceAvatar={avatarEdit.imageUrl || profile.avatar}
                sourceFrameImage={sourceAvatarFrameImage}
                value={avatarFrame}
                onChange={setAvatarFrame}
              />
              <ProfileThemePicker
                value={profileTheme}
                onApply={setProfileTheme}
              />
              <BackgroundPicker sourceBackgroundImage={sourceBackgroundImage} value={background} onChange={setBackground} />
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
            {profile && <a className="open-source" href={profile.url} target="_blank" rel="noreferrer">Open on Steam <ExternalLink size={13} /></a>}
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
                  const page = previewFrame.current?.contentDocument?.querySelector<HTMLElement>('.no_header.profile_page');
                  const document = previewFrame.current?.contentDocument;
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
                <ShowcaseEditor previewDocument={showcaseDocument} />
          </div>
          <div className="stage-footer"><span>STEAM COMMUNITY <i>·</i> PUBLIC HTML</span><span>SIMULATED VIEW <b>01</b></span></div>
        </section>
      </section>
    </main>
  );
}