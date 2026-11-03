// Only the search-parameter hook is adapted; both production components are real.
export const useSearchParams = () => new URLSearchParams(window.location.search);
