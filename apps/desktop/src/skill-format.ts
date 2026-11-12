/**
 * A skill as agentskills.io writes it: front matter with `name` and `description`, then the steps as a numbered
 * list, and anything else as notes. Read into a form the window edits, and written back the same way.
 */
export interface Skill { name: string; description: string; steps: string[]; notes: string; /** Other front-matter lines, kept as they were. */ extra: string[] }

export function parseSkill(text: string): Skill {
  let body = text.replace(/\r\n?/g, '\n');
  let name = '', description = '';
  const extra: string[] = [];
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (front) {
    for (const line of front[1]!.split('\n')) {
      const m = /^(\w[\w-]*):\s*(.*)$/.exec(line);
      if (m?.[1] === 'name') name = m[2]!.trim();
      else if (m?.[1] === 'description') description = m[2]!.trim().replace(/^"(.*)"$/, '$1');
      else if (line.trim()) extra.push(line);
    }
    body = body.slice(front[0].length);
  }
  const steps: string[] = [];
  const notes: string[] = [];
  for (const line of body.split('\n')) {
    const step = /^\s*\d+[.)]\s?(.*)$/.exec(line);
    if (step) steps.push(step[1]!.trim());
    else notes.push(line);
  }
  return { name, description, steps, notes: notes.join('\n').trim(), extra };
}

export function writeSkill(skill: Skill): string {
  const front = ['---', `name: ${skill.name}`, `description: ${skill.description.replace(/\n/g, ' ').trim()}`, ...skill.extra, '---'];
  const steps = skill.steps.map((s, i) => `${i + 1}. ${s.replace(/\n/g, ' ').trim()}`);
  return `${front.join('\n')}\n\n${steps.join('\n')}${skill.notes ? `\n\n${skill.notes}` : ''}\n`;
}

/** What a message starting `/name` asks: that skill, for the rest of the message. */
export function expandSlash(text: string, names: readonly string[]): string {
  const m = /^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m || !names.includes(m[1]!)) return text;
  return `Use the skill "${m[1]}" (read it with skills.read and follow its steps)${m[2] ? ` for: ${m[2]}` : '.'}`;
}
