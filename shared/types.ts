export interface ShareComment {
  id: string;
  name: string;
  text: string;
  /** Exact text the reader selected, if the comment is anchored. */
  quote: string | null;
  /** Up to 32 chars of context on either side of the quote, used to disambiguate repeated phrases. */
  prefix: string | null;
  suffix: string | null;
  createdAt: string;
  resolved: boolean;
  /** True when the comment was posted by the share's author (verified by token). */
  byAuthor: boolean;
}

export interface SharePublic {
  id: string;
  title: string;
  author: string | null;
  html: string;
  createdAt: string;
  updatedAt: string;
  comments: ShareComment[];
}

export const LIMITS = {
  title: 300,
  author: 80,
  commentName: 60,
  commentText: 4000,
  quote: 600,
  context: 32,
  commentsPerShare: 500,
  imageBytes: 8 * 1024 * 1024,
  contentBytes: 4 * 1024 * 1024,
} as const;
