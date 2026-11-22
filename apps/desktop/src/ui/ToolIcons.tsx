import type { ReactNode } from 'react';

/** One 16-unit outline icon, drawn in the text colour (the group's CSS sets the stroke). */
const Svg = ({ d }: { d: string }) => <svg viewBox="0 0 16 16" aria-hidden="true"><path d={d} /></svg>;

/**
 * The tool row's icons, for familiar actions (the panel look, docs/design/panel-look.md: icons for actions everyone
 * knows, words for modes and values). One set, so Reply or Export look the same in every app. Pass one as the `icon`
 * of an `IconButton`, with a label and keys so the tooltip names it ("Automation (A)").
 */
export const TOOL_ICONS = {
  reply: <Svg d="M7 4 3 8l4 4M3 8h6a4 4 0 0 1 4 4" />,
  replyAll: <Svg d="M8 4 4 8l4 4M11 4 7 8l4 4M7 8h3a4 4 0 0 1 4 4" />,
  forward: <Svg d="m9 4 4 4-4 4M13 8H7a4 4 0 0 0-4 4" />,
  done: <Svg d="M2 3h12v3H2zM3 6v7h10V6M6 9h4" />,
  later: <Svg d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5v3l2 2" />,
  flag: <Svg d="M4 14V2h8l-2 3 2 3H4" />,
  mixer: <Svg d="M4 2v4.5M4 9.5V14M8 2v1.5M8 6.5V14M12 2v5.5M12 10.5V14M2.5 6.5h3v3h-3zM6.5 3.5h3v3h-3zM10.5 7.5h3v3h-3z" />,
  automation: <Svg d="M2 12c2 0 2-7 4-7s2 4 4 4 2-5 4-5" />,
  export: <Svg d="M8 2v8M5 7l3 3 3-3M3 12v2h10v-2" />,
  tap: <Svg d="M6 8V3.5a1 1 0 0 1 2 0V8M8 7.5a1 1 0 0 1 2 0V9M10 8.5a1 1 0 0 1 2 0V11c0 2-1.5 3.5-3.5 3.5S5 13 4.5 11.5L3.5 9a1 1 0 0 1 1.7-1L6 9" />,
  reader: <Svg d="M2 3h5v10H2zM9 3h5v10H9z" />,
  save: <Svg d="m8 2 1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z" />,
  comments: <Svg d="M2 3h12v8H6l-3 3v-3H2z" />,
} satisfies Record<string, ReactNode>;

export type ToolIconName = keyof typeof TOOL_ICONS;

/**
 * A few related tools as one quiet group in the tool row (Reply, Reply all, Forward; or Done, Later, Flag): the
 * buttons sit on one faint fill, so the row reads as a few groups rather than a string of icons. Put `IconButton`s or
 * the `Transport` inside.
 */
export function ToolGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <span role="group" aria-label={label} className={className ? `ui-tool-group ${className}` : 'ui-tool-group'}>{children}</span>;
}
