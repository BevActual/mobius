import { useId, type MouseEvent, type ReactNode } from 'react';

/**
 * A row in a content list (Instrument, "List row"). One line: what leads it (a checkbox, an avatar, an icon), the title
 * in full ink, grey details, and the date or size at the trailing end in tabular figures. With `detail` it is the
 * two-line row for a list beside a reading pane (Mail, Notes): the title with the date trailing, then one grey line.
 *
 * One height per density in a view: --row-list for one line, --row-list-2 for two. A hairline sits between rows and
 * the chosen one has the grey fill. Put rows in a `<ul role="list" className="ui-list">`.
 */
export function ListRow({ title, detail, meta, lead, trail, unread, current, proposed, onSelect, onContextMenu, className }: {
  title: ReactNode;
  /** The second line: grey, one line, cut with an ellipsis (a message's first words, a note's folder). */
  detail?: ReactNode;
  /** At the trailing end of the first line: a date, a time, a size. Shown in tabular figures. */
  meta?: ReactNode;
  /** What leads the row: a Checkbox, an Avatar, a line icon. */
  lead?: ReactNode;
  /** Controls after the row's button, inside the row and its fill (a hover Archive, a Pin). */
  trail?: ReactNode;
  /** New to the person: a semibold title. No coloured dot. */
  unread?: boolean;
  current?: boolean;
  /** Mobius added or changed it and it is not kept yet: dashed until the person decides. */
  proposed?: boolean;
  onSelect: () => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}) {
  const detailId = useId();
  return (
    <li className={className ? `ui-row ${className}` : 'ui-row'} data-lines={detail === undefined ? 1 : 2} data-current={current || undefined} data-proposed={proposed || undefined}>
      {lead && <span className="ui-row-lead">{lead}</span>}
      <button
        type="button"
        className="ui-row-main"
        aria-current={current ? 'true' : undefined}
        aria-describedby={detail === undefined ? undefined : detailId}
        onClick={onSelect}
        onContextMenu={onContextMenu}
      >
        <span className="ui-row-line">
          <span className="ui-row-title" data-unread={unread || undefined}>{title}</span>
          {meta !== undefined && <span className="ui-row-meta">{meta}</span>}
        </span>
        {detail !== undefined && <span className="ui-row-detail" id={detailId}>{detail}</span>}
      </button>
      {trail && <span className="ui-row-trail">{trail}</span>}
    </li>
  );
}
