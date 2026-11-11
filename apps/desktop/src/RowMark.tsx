/**
 * The one mark a sidebar row shows, with what it means on hover. When more than one applies, the one that most needs
 * the person wins: a change by Mobius waiting to be kept, then unread, then a comment.
 */
export function RowMark({ changed = false, unread = false, comment = false, changedTitle = 'Changed by Mobius in its last turn' }: { changed?: boolean; unread?: boolean; comment?: boolean; changedTitle?: string }) {
  if (changed) return <span className="changed-mark row-mark" data-kind="changed" role="img" aria-label="Changed by the agent" title={changedTitle} />;
  if (unread) return <span className="row-mark" data-kind="unread" role="img" aria-label="Unread" title="Unread" />;
  if (comment) return <span className="row-mark" data-kind="comment" role="img" aria-label="Has a comment" title="Has a comment" />;
  return null;
}
