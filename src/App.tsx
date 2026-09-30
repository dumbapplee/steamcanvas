import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, CircleHelp, ExternalLink, LoaderCircle, PanelsTopLeft, Search, ShieldCheck } from 'lucide-react';
import AvatarEditor, { DEFAULT_AVATAR_EDIT, type AvatarEditState } from './components/AvatarEditor';
import BackgroundPicker, { type SteamBackground } from './components/BackgroundPicker';

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
  const [background, setBackground] = useState<SteamBackground | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const sourceBackgroundStyle = useRef<string | null>(null);

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

    const page = previewFrame.current?.contentDocument?.querySelector<HTMLElement>('.no_header.profile_page');
    if (!page) return;
    if (background) {
      page.style.setProperty('background-image', `url("${background.imageUrl}")`, 'important');
    } else if (sourceBackgroundStyle.current !== null) {
      page.setAttribute('style', sourceBackgroundStyle.current);
    } else {
      page.removeAttribute('style');
    }
  }, [background, previewLoaded, profile]);

  async function loadProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!identifier.trim() || loading) return;

    setLoading(true);
    setError('');
    setProfile(null);
    setPreviewLoaded(false);
    setAvatarEdit(DEFAULT_AVATAR_EDIT);
    setBackground(null);
    sourceBackgroundStyle.current = null;

    try {
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load this profile.');
      setProfile(result as ProfilePreview);
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
              <BackgroundPicker value={background} onChange={setBackground} />
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
                  sourceBackgroundStyle.current = page?.getAttribute('style') ?? null;
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
          </div>
          <div className="stage-footer"><span>STEAM COMMUNITY <i>·</i> PUBLIC HTML</span><span>SIMULATED VIEW <b>01</b></span></div>
        </section>
      </section>
    </main>
  );
}