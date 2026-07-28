export type SearchErrorCode = "invalid_search_query" | "search_unavailable";

export class SearchError extends Error {
  constructor(
    message: string,
    readonly code: SearchErrorCode,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class InvalidSearchQueryError extends SearchError {
  constructor(message = "Search query must contain at least two characters") {
    super(message, "invalid_search_query", 400);
  }
}

export class SearchUnavailableError extends SearchError {
  constructor(cause?: unknown) {
    super("Medicine search is temporarily unavailable", "search_unavailable", 503, {
      cause,
    });
  }
}
