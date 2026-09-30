import { useEffect, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, RotateCcw, Search } from 'lucide-react';

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
  value: SteamBackground | null;
  onChange: (background: SteamBackground | null) => void;
};

export default function BackgroundPicker({ value, onChange }: BackgroundPickerProps) {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<SteamBackground[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize, setPageSize] = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

      <form className="background-search" onSubmit={searchBackgrounds}>
        <Search size={14} aria-hidden="true" />
        <input
          aria-label="Search Steam profile backgrounds"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search backgrounds"
          maxLength={80}
        />
        <button type="submit" aria-label="Search backgrounds"><Search size={15} /></button>
      </form>

      {value && <p className="background-selection" title={value.name}>{value.name}</p>}
      {error && <p className="background-error" role="alert">{error}</p>}

      <div className="background-results" aria-busy={loading}>
        {items.map((item) => (
          <button
            className={`background-option ${value?.id === item.id ? 'is-selected' : ''}`}
            type="button"
            key={item.id}
            title={`${item.name}${item.price ? ` · ${item.price}` : ''}`}
            aria-label={`Preview ${item.name}${item.price ? `, ${item.price}` : ''}`}
            aria-pressed={value?.id === item.id}
            onClick={() => onChange(item)}
          >
            <img src={item.imageUrl} alt="" loading="lazy" />
            <span className="background-option-name">{item.name}</span>
            {item.price && <span className="background-option-price">{item.price}</span>}
          </button>
        ))}
        {loading && <div className="background-loading"><LoaderCircle className="spin" size={17} /></div>}
        {!loading && !error && items.length === 0 && <p className="background-empty">No matching backgrounds.</p>}
      </div>

      <div className="background-picker-footer">
        <span>{totalCount.toLocaleString()} items</span>
        <div className="background-pagination">
          <button type="button" aria-label="Previous backgrounds" disabled={page === 0 || loading} onClick={() => setPage((current) => current - 1)}>
            <ChevronLeft size={15} />
          </button>
          <span>{pageCount ? `${page + 1} / ${pageCount.toLocaleString()}` : '0 / 0'}</span>
          <button type="button" aria-label="Next backgrounds" disabled={loading || (page + 1) * pageSize >= totalCount} onClick={() => setPage((current) => current + 1)}>
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}