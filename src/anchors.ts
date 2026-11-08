/**
 * Text anchoring for reader comments, in the spirit of the W3C TextQuoteSelector:
 * we store the exact quote plus a little context on each side, then find it
 * again in the rendered article even if the same phrase appears twice.
 */

const CONTEXT = 32;

export interface Quote {
  quote: string;
  prefix: string;
  suffix: string;
}

interface TextIndex {
  nodes: Text[];
  starts: number[];
  full: string;
}

function indexText(root: HTMLElement): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("script,style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  const starts: number[] = [];
  let full = "";
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    nodes.push(t);
    starts.push(full.length);
    full += t.data;
  }
  return { nodes, starts, full };
}

/** Describe the current selection as a quote, or null if it isn't inside `root`. */
export function quoteFromSelection(root: HTMLElement, sel: Selection | null): Quote | null {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const idx = indexText(root);
  let start = -1;
  let end = -1;
  idx.nodes.forEach((t, i) => {
    if (!range.intersectsNode(t)) return;
    const localStart = t === range.startContainer ? range.startOffset : 0;
    const localEnd = t === range.endContainer ? range.endOffset : t.data.length;
    if (start < 0) start = idx.starts[i] + localStart;
    end = idx.starts[i] + localEnd;
  });
  if (start < 0 || end <= start) return null;
  const quote = idx.full.slice(start, end);
  if (!quote.trim()) return null;
  return {
    quote,
    prefix: idx.full.slice(Math.max(0, start - CONTEXT), start),
    suffix: idx.full.slice(end, end + CONTEXT),
  };
}

function locate(idx: TextIndex, q: { quote: string; prefix?: string | null; suffix?: string | null }): [number, number] | null {
  const { full } = idx;
  const candidates: number[] = [];
  let from = 0;
  while (candidates.length < 50) {
    const i = full.indexOf(q.quote, from);
    if (i < 0) break;
    candidates.push(i);
    from = i + 1;
  }
  if (!candidates.length) return null;
  if (candidates.length === 1) return [candidates[0], candidates[0] + q.quote.length];
  // Several matches: prefer the one whose surroundings agree with the stored context.
  let best = candidates[0];
  let bestScore = -1;
  for (const c of candidates) {
    const before = full.slice(Math.max(0, c - CONTEXT), c);
    const after = full.slice(c + q.quote.length, c + q.quote.length + CONTEXT);
    const score = overlap(before, q.prefix ?? "", true) + overlap(after, q.suffix ?? "", false);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return [best, best + q.quote.length];
}

function overlap(a: string, b: string, fromEnd: boolean): number {
  let n = 0;
  const max = Math.min(a.length, b.length);
  for (let i = 1; i <= max; i++) {
    const ca = fromEnd ? a[a.length - i] : a[i - 1];
    const cb = fromEnd ? b[b.length - i] : b[i - 1];
    if (ca !== cb) break;
    n++;
  }
  return n;
}

export interface Anchored {
  id: string;
  quote: string;
  prefix?: string | null;
  suffix?: string | null;
  resolved?: boolean;
}

/** Remove every highlight we added and merge the text back together. */
export function clearHighlights(root: HTMLElement) {
  root.querySelectorAll("mark[data-comment-id]").forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  root.normalize();
}

/** Wrap each anchored comment's quote in a <mark>. Returns the ids that were found. */
export function applyHighlights(root: HTMLElement, comments: Anchored[]): Set<string> {
  clearHighlights(root);
  const found = new Set<string>();
  for (const c of comments) {
    if (!c.quote) continue;
    const idx = indexText(root);
    const range = locate(idx, c);
    if (!range) continue;
    const [s, e] = range;
    for (let i = 0; i < idx.nodes.length; i++) {
      const nodeStart = idx.starts[i];
      const node = idx.nodes[i];
      const nodeEnd = nodeStart + node.data.length;
      if (nodeEnd <= s || nodeStart >= e) continue;
      const a = Math.max(0, s - nodeStart);
      const b = Math.min(node.data.length, e - nodeStart);
      if (b <= a) continue;
      let target = node;
      if (a > 0) target = target.splitText(a);
      if (b - a < target.data.length) target.splitText(b - a);
      const mark = document.createElement("mark");
      mark.dataset.commentId = c.id;
      mark.className = "reader-mark" + (c.resolved ? " resolved" : "");
      target.parentNode?.insertBefore(mark, target);
      mark.appendChild(target);
    }
    found.add(c.id);
  }
  return found;
}
