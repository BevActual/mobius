import type { ActivityEntry } from '@mobius/shared';

export interface ActivityLine { text: string; tone: 'normal' | 'warning'; who: string }

const WHO: Record<string, string> = { agent: 'Agent', person: 'You', mcp_server: 'Connected app', plugin: 'Plugin' };

export function describeActivity(entry: ActivityEntry): ActivityLine {
  const what = entry.capability ?? 'a tool';
  const on = entry.resource ? ` on ${entry.resource}` : '';
  const tool = entry.tool ?? entry.capability ?? 'a tool';
  const who = entry.who ? (WHO[entry.who] ?? '') : '';
  const line = (text: string, tone: ActivityLine['tone'] = 'normal'): ActivityLine => ({ text, tone, who });
  switch (entry.kind) {
    case 'permission.asked': return line(`Asked you about ${what}${on}`);
    case 'permission.approved': return line(`You allowed ${what}${on}`);
    case 'permission.rejected': return line(`You declined ${what}${on}`, 'warning');
    case 'permission.allowed': return line(`Allowed ${what}${on} (already approved)`);
    case 'permission.denied': return line(`Blocked ${what}${on}`, 'warning');
    case 'permission.revoked': return line(`Approval for ${what}${on} removed`);
    case 'permission.withdrawn': return line(`Question about ${what}${on} withdrawn`);
    case 'tool.started': return line(`Started ${tool}`);
    case 'tool.completed': return line(`Finished ${tool}`);
    case 'tool.failed': return line(`${tool} failed`, 'warning');
    default: return line(entry.kind);
  }
}
