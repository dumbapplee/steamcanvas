import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, ImagePlus, LoaderCircle, RotateCcw, Search, X } from 'lucide-react';

export type SteamBackground = {
  id: string;
  name: string;
  game: string;
  price: string;
  imageUrl: string;
  marketUrl: string;
};

type BackgroundResponse = {
  items: SteamBackground[];
  totalCount: number;
  pageSize: number;
  error?: string;
};

type BackgroundPickerProps = {
  sourceBackgroundImage: string;
  value: SteamBackground | null;
  onChange: (background: SteamBackground | null) => void;
};

export default function BackgroundPicker({ sourceBackgroundImage, value, onChange }: BackgroundPickerProps) {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<SteamBackground[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize, setPageSize] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (expanded && !dialog.open) dialog.showModal();
    if (!expanded && dialog.open) dialog.close();
  }, [expanded]);

  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams({ query: submittedQuery, start: String(page * pageSize), count: String(pageSize) });
    setLoading(true);
    setError('');

    fetch(`/api/backgrounds?${parameters}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as BackgroundResponse;
        if (!response.ok) throw new Error(result.error || 'Could not load Steam backgrounds.');
        return result;
      })
      .then((result) => {
        setItems(result.items);
        setTotalCount(result.totalCount);
        setPageSize(result.pageSize);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : 'Could not load Steam backgrounds.');
        setItems([]);
        setTotalCount(0);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [page, pageSize, submittedQuery]);

  function searchBackgrounds(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(0);
    setSubmittedQuery(query.trim());
  }

  const pageCount = Math.ceil(totalCount / pageSize);
  const backgroundItems = (large = false) => items.map((item) => (
    <button
      className={`background-option ${large ? 'is-large' : ''} ${value?.id === item.id ? 'is-selected' : ''}`}
      type="button"
      key={item.id}
      title={`${item.name}${item.price ? ` · ${item.price}` : ''}`}
      aria-label={`Preview ${item.name}${item.price ? `, ${item.price}` : ''}`}
      aria-pressed={value?.id === item.id}
      onClick={() => {
        onChange(item);
        setExpanded(false);
      }}
    >
      <img src={item.imageUrl} alt="" loading="lazy" />
      <span className="background-option-name">{item.name}</span>
      {item.price && <span className="background-option-price">{item.price}</span>}
    </button>
  ));

  const searchForm = (large = false) => (
    <form className={`background-search ${large ? 'is-large' : ''}`} onSubmit={searchBackgrounds}>
      <Search size={large ? 17 : 14} aria-hidden="true" />
      <input
        aria-label="Search Steam profile backgrounds"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search backgrounds"
        maxLength={80}
        autoFocus={large && expanded}
      />
      <button type="submit" aria-label="Search backgrounds"><Search size={large ? 17 : 15} /></button>
    </form>
  );

  const pagination = (large = false) => (
    <div className={`background-picker-footer ${large ? 'is-large' : ''}`}>
      <span>{totalCount.toLocaleString()} items</span>
      <div className="background-pagination">
        <button type="button" aria-label="Previous backgrounds" disabled={page === 0 || loading} onClick={() => setPage((current) => current - 1)}>
          <ChevronLeft size={large ? 18 : 15} />
        </button>
        <span>{pageCount ? `${page + 1} / ${pageCount.toLocaleString()}` : '0 / 0'}</span>
        <button type="button" aria-label="Next backgrounds" disabled={loading || (page + 1) * pageSize >= totalCount} onClick={() => setPage((current) => current + 1)}>
          <ChevronRight size={large ? 18 : 15} />
        </button>
      </div>
    </div>
  );

  return (
    <section className="background-picker" aria-labelledby="background-picker-title">
      <div className="background-picker-heading">
        <span className="source-label" id="background-picker-title">PROFILE BACKGROUND</span>
        <button
          className="icon-button"
          type="button"
          title="Reset background"
          aria-label="Reset background"
          onClick={() => onChange(null)}
          disabled={!value}
        >
          <RotateCcw size={15} />
        </button>
      </div>

      <div className="background-current-row">
        <div
          className="background-current-preview"
          role="img"
          aria-label={value ? `Selected background: ${value.name}` : sourceBackgroundImage && sourceBackgroundImage !== 'none' ? 'Current profile background' : 'No profile background'}
          style={{ backgroundImage: value ? `url("${value.imageUrl}")` : sourceBackgroundImage }}
        />
        <div className="background-current-actions">
          <span className="background-current-name" title={value?.name || undefined}>
            {value?.name || (sourceBackgroundImage && sourceBackgroundImage !== 'none' ? 'Current profile background' : 'No background on profile')}
          </span>
          <button className="avatar-upload-button" type="button" onClick={() => setExpanded(true)}>
            <ImagePlus size={14} /> Replace background
          </button>
        </div>
      </div>
      {error && <p className="background-error" role="alert">{error}</p>}

      <dialog
        ref={dialogRef}
        className="background-dialog"
        aria-labelledby="background-dialog-title"
        onClose={() => setExpanded(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setExpanded(false);
        }}
      >
        <div className="background-dialog-content">
          <header className="background-dialog-header">
            <div>
              <span className="source-label">STEAM COMMUNITY MARKET</span>
              <h2 id="background-dialog-title">Profile backgrounds</h2>
              {value && <p className="background-selection" title={value.name}>Selected: {value.name}</p>}
            </div>
            <button className="icon-button" type="button" title="Close background search" aria-label="Close background search" onClick={() => setExpanded(false)}>
              <X size={18} />
            </button>
          </header>
          {searchForm(true)}
          {error && <p className="background-error" role="alert">{error}</p>}
          <div className="background-results is-expanded" aria-busy={loading}>
            {backgroundItems(true)}
            {loading && <div className="background-loading"><LoaderCircle className="spin" size={24} /></div>}
            {!loading && !error && items.length === 0 && <p className="background-empty">No matching backgrounds.</p>}
          </div>
          {pagination(true)}
        </div>
      </dialog>
    </section>
  );
}