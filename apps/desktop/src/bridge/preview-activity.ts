/** The Activity app in the preview: a day and a half of what Mobius did on the Kestrel P2 build, newest last. */
const now = Date.now();
const min = 60_000;
const hour = 60 * min;
let seq = 0;
const entry = (ago: number, kind: string, capability: string | null, resource: string | null, who = 'agent', tool: string | null = null) => ({ seq: ++seq, tsMs: now - ago, kind, capability, resource, tool, who });

const LOG = [
  entry(27 * hour, 'tool.completed', 'mail.read', null),
  entry(26 * hour + 50 * min, 'tool.completed', 'calendar.add', 'Motor call with Axion'),
  entry(26 * hour + 40 * min, 'permission.approved', 'mail.send', 'sam@northway.example', 'person'),
  entry(26 * hour + 39 * min, 'tool.completed', 'mail.send', 'Sam Okafor'),
  entry(25 * hour, 'permission.rejected', 'payments.pay', 'Veltro Cells deposit', 'person'),
  entry(3 * hour, 'tool.completed', 'browser.navigate', 'axion.example'),
  entry(3 * hour - 2 * min, 'tool.completed', 'browser.read', 'Axion 150 kW traction motor'),
  entry(2 * hour, 'tool.completed', 'files.write', 'notes/P2 build/Supplier notes.md'),
  entry(2 * hour - min, 'tool.completed', 'files.write', 'sheets/P2 budget/Sheet 1.csv'),
  entry(90 * min, 'tool.failed', 'net.http_get', 'veltro.example'),
  entry(40 * min, 'tool.completed', 'mail.draft', 'Priya Nair'),
  entry(12 * min, 'permission.denied', 'files.delete', 'Old quotes'),
  entry(5 * min, 'tool.completed', 'memory.remember', null),
];

export const PREVIEW_ACTIVITY: Record<string, (...args: never[]) => unknown> = {
  'agent.activity': () => LOG.slice().reverse(),
};
