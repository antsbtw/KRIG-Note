import { useState, useCallback, useRef } from 'react';
import type { SearchResult } from '../components/SearchBar';
import type { IBookRenderer } from '../types';
import { isFixedPage, isReflowable } from '../types';

interface UseSearchOptions {
  rendererRef: React.RefObject<IBookRenderer | null>;
  onGotoPage: (page: number) => void;
  onGotoCFI: (cfi: string) => void;
}

export function useSearch({ rendererRef, onGotoPage, onGotoCFI }: UseSearchOptions) {
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigateToResult = useCallback((result: SearchResult) => {
    const r = rendererRef.current;
    if (!r) return;
    if (isFixedPage(r)) {
      onGotoPage(result.pageNum);
    } else if (isReflowable(r) && result.cfi) {
      onGotoCFI(result.cfi);
    }
  }, [rendererRef, onGotoPage, onGotoCFI]);

  const handleSearch = useCallback((query: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      const r = rendererRef.current;
      if (!r || !query.trim()) {
        setSearchResults([]);
        setSearchIndex(0);
        if (r && isReflowable(r)) r.clearSearch?.();
        return;
      }
      const results = isFixedPage(r)
        ? await r.searchText(query.trim())
        : isReflowable(r) && r.searchText
          ? await r.searchText(query.trim())
          : [];
      setSearchResults(results);
      setSearchIndex(0);
      if (results.length > 0) {
        navigateToResult(results[0]);
      }
    }, 300);
  }, [rendererRef, navigateToResult]);

  const handleSearchNext = useCallback(() => {
    if (searchResults.length === 0) return;
    const next = (searchIndex + 1) % searchResults.length;
    setSearchIndex(next);
    navigateToResult(searchResults[next]);
  }, [searchResults, searchIndex, navigateToResult]);

  const handleSearchPrev = useCallback(() => {
    if (searchResults.length === 0) return;
    const prev = (searchIndex - 1 + searchResults.length) % searchResults.length;
    setSearchIndex(prev);
    navigateToResult(searchResults[prev]);
  }, [searchResults, searchIndex, navigateToResult]);

  const handleSearchClose = useCallback(() => {
    setSearchVisible(false);
    setSearchResults([]);
    setSearchIndex(0);
    const r = rendererRef.current;
    if (r && isReflowable(r)) r.clearSearch?.();
  }, [rendererRef]);

  const openSearch = useCallback(() => {
    setSearchVisible(true);
  }, []);

  return {
    searchVisible,
    searchResults,
    searchIndex,
    openSearch,
    handleSearch,
    handleSearchNext,
    handleSearchPrev,
    handleSearchClose,
  };
}
