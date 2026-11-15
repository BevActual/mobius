// Writes the agent's built-in tools, in registration order, to crates/mobius-host/tests/agent-tools.txt.
// Run after adding or removing a tool (npm run snapshot:tools), then commit the file. The bridge tests and the e2e
// suite check against it, so a new tool is one change here instead of a count and two lists by hand.
import { spawnSync } from 'node:child_process';

const run = spawnSync('cargo', ['test', '-q', '-p', 'mobius-host', '--test', 'bridge', 'becoming_ready_registers_the_browser_tools_with_the_core'], {
  stdio: 'inherit',
  env: { ...process.env, MOBIUS_SNAPSHOT_TOOLS: '1' },
  shell: process.platform === 'win32',
});
process.exit(run.status ?? 1);
