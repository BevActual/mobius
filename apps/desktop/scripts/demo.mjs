#!/usr/bin/env node
/**
 * The launch demo, ready to record: Mobius opens on Priya's email about the Kestrel P2 brake kit, in a demo data folder
 * of its own, with a pretend mail server on this computer. Nothing reaches your real mail, files or settings, and a
 * reply you send goes only to the pretend server.
 *
 *   node apps/desktop/scripts/demo.mjs            open the demo (the data folder is kept, so the model you choose stays)
 *   node apps/desktop/scripts/demo.mjs --fresh    start the demo data again from nothing
 *
 * First time only: choose a model in Settings › Models in the window that opens. Then press "Take care of this".
 * The mail server stops when you close Mobius.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '../../..');
const exeName = process.platform === 'win32' ? 'mobius-shell.exe' : 'mobius-shell';
const exe = ['release', 'debug'].map((b) => path.join(repo, 'target', b, exeName)).find((p) => fs.existsSync(p));
const userData = path.join(os.tmpdir(), 'mobius-demo');
const PASSWORD = 'demo-pass';
const ADDRESS = 'andrew@northway.example';
// Fixed ports, so the mail account kept in the demo folder still connects next time.
const IMAP_PORT = 41430;
const SMTP_PORT = 41431;

if (!exe) {
  console.error('No Mobius build in this clone. Build it first: npm run build -w @mobius/desktop, then cargo build --release -p mobius-cored -p mobius-shell');
  process.exit(1);
}
if (process.argv.includes('--fresh')) fs.rmSync(userData, { recursive: true, force: true });

// The days in the story: the parts list is due the next working day, and the meeting is the working day after.
const pad = (n) => String(n).padStart(2, '0');
const workdayAfter = (from) => { const d = new Date(from); do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); return d; };
const due = workdayAfter(new Date());
const meet = workdayAfter(due);
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const weekday = (d) => d.toLocaleDateString('en-GB', { weekday: 'long' });
const sentAt = new Date(Date.now() - 50 * 60_000);

const PRIYA = [
  'From: Priya Shah <priya@northway.example>',
  `To: Andrew <${ADDRESS}>`,
  'Subject: Kestrel P2: brake kit review',
  'Message-ID: <p2-brakes@northway.example>',
  `Date: ${sentAt.toUTCString().replace('GMT', '+0000')}`,
  '',
  'Hi Andrew,',
  '',
  `Can we go through the P2 brake kit together on ${weekday(meet)} at 10? Half an hour should do.`,
  `Before then, could you send me the updated parts list for the P2 build, by ${weekday(due)} if possible?`,
  '',
  'Thanks,',
  'Priya',
  '',
].join('\r\n');
const SUPPLIER = `From: Orbis Parts <orders@orbis.example>\r\nTo: Andrew <${ADDRESS}>\r\nSubject: Order 4471 shipped\r\nDate: ${new Date(Date.now() - 20 * 3600_000).toUTCString().replace('GMT', '+0000')}\r\n\r\nYour order of caliper brackets has shipped.\r\n`;
const inbox = [{ uid: 6, flags: '\\Seen', raw: SUPPLIER }, { uid: 7, flags: '', raw: PRIYA }];

/** A pretend IMAP and SMTP server on this computer: an inbox of the two messages, and a reply that goes nowhere. */
function startMail() {
  const imap = net.createServer((socket) => {
    socket.write('* OK demo IMAP ready\r\n');
    let box = 'INBOX';
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let at;
      while ((at = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const [tag, ...rest] = line.split(' ');
        const command = rest.join(' ');
        const upper = command.toUpperCase();
        const list = box === 'INBOX' ? inbox : [];
        if (upper.startsWith('LOGIN')) socket.write(command.includes(`"${PASSWORD}"`) ? `${tag} OK logged in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
        else if (upper.startsWith('LIST')) socket.write(`* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\HasNoChildren \\Sent) "/" "Sent"\r\n${tag} OK done\r\n`);
        else if (upper.startsWith('EXAMINE') || upper.startsWith('SELECT')) { box = command.includes('"Sent"') ? 'Sent' : 'INBOX'; socket.write(`* ${list.length} EXISTS\r\n* OK [UIDVALIDITY 7] ok\r\n${tag} OK done\r\n`); }
        else if (upper.startsWith('UID SEARCH')) socket.write(`* SEARCH ${list.map((m) => m.uid).join(' ')}\r\n${tag} OK done\r\n`);
        else if (upper.startsWith('UID FETCH')) {
          const wanted = (command.split(' ')[2] ?? '').split(',').map(Number);
          const parts = [];
          list.forEach((m, i) => {
            if (!wanted.includes(m.uid)) return;
            const body = Buffer.from(m.raw, 'utf8');
            parts.push(Buffer.from(`* ${i + 1} FETCH (UID ${m.uid} FLAGS (${m.flags}) BODY[] {${body.length}}\r\n`), body, Buffer.from(')\r\n'));
          });
          parts.push(Buffer.from(`${tag} OK done\r\n`));
          socket.write(Buffer.concat(parts));
        } else if (upper.startsWith('LOGOUT')) { socket.write(`* BYE\r\n${tag} OK bye\r\n`); socket.end(); }
        else socket.write(`${tag} OK done\r\n`);
      }
    });
    socket.on('error', () => {});
  });
  const smtp = net.createServer((socket) => {
    socket.write('220 demo SMTP ready\r\n');
    let data = false;
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let at;
      while ((at = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (data) { if (line === '.') { data = false; socket.write('250 queued\r\n'); console.log('Reply "sent" (to the demo server only).'); } continue; }
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) socket.write('250-demo\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (upper.startsWith('AUTH PLAIN')) socket.write('235 ok\r\n');
        else if (upper === 'DATA') { data = true; socket.write('354 go\r\n'); }
        else if (upper === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('250 ok\r\n');
      }
    });
    socket.on('error', () => {});
  });
  const listen = (server, port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return Promise.all([listen(imap, IMAP_PORT), listen(smtp, SMTP_PORT)]).then(() => ({ close: () => { imap.close(); smtp.close(); } }));
}

/** What is already there before the email: a Kestrel P2 list, and a stand-up the morning of the meeting. */
function seed() {
  const write = (rel, content) => { const f = path.join(userData, 'workspace', rel); if (fs.existsSync(f)) return; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
  write('tasks/Kestrel P2.md', '# Kestrel P2\n\n- [ ] Confirm the wiring loom supplier\n- [ ] Book the rolling-road slot\n- [x] Sign off the chassis drawings\n');
  write('calendar/Calendar.ics', ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mobius//EN', 'BEGIN:VEVENT', 'UID:standup', `DTSTART:${ymd(meet)}T090000`, `DTEND:${ymd(meet)}T093000`, 'SUMMARY:P2 stand-up', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n'));
  const prefs = path.join(userData, 'preferences.json');
  if (!fs.existsSync(prefs)) fs.writeFileSync(prefs, JSON.stringify({ approvalMode: 'propose' }));
}

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(userData, { recursive: true });
seed();
const mail = await startMail().catch((e) => { console.error(`The demo mail server could not start (${e.message}). Is another demo still open?`); process.exit(1); });
const port = await freePort();
const env = { ...process.env, MOBIUS_TEST: '1', MOBIUS_USER_DATA: userData, WEBVIEW2_USER_DATA_FOLDER: path.join(userData, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` };
delete env.MOBIUS_HIDE_WINDOW;
const child = spawn(exe, [], { env, stdio: 'ignore' });
child.on('exit', () => { mail.close(); process.exit(0); });
console.log(`Opening Mobius (${path.relative(repo, exe)}) with the demo data in ${userData}…`);

// Set the stage the way a person would: the mail account, then Mail on Priya's email. Then let go of the window.
let browser = null;
for (const until = Date.now() + 60_000; !browser && Date.now() < until && child.exitCode === null;) {
  await wait(250);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
}
if (!browser) { console.error('Mobius did not open its window.'); child.kill(); process.exit(1); }
let page = null;
for (const until = Date.now() + 30_000; !page && Date.now() < until;) {
  page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('tauri.localhost')) ?? null;
  if (!page) await wait(150);
}
try {
  await page.waitForSelector('html[data-keys-ready]', { state: 'attached', timeout: 30_000 });
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Find apps, pages and commands' }).fill('Mail');
  await page.keyboard.press('Enter');
  const mailPage = page.locator('.mail-page');
  await mailPage.waitFor({ timeout: 10_000 });
  const addAccount = page.getByRole('button', { name: 'Add a mail account…' });
  const rows = mailPage.getByRole('listbox', { name: 'Messages' }).getByRole('option');
  await Promise.race([rows.first().waitFor({ timeout: 8000 }), addAccount.waitFor({ timeout: 8000 })]).catch(() => undefined);
  if (!(await rows.count())) {
    await addAccount.click();
    const dialog = page.getByRole('dialog', { name: 'Add a mail account' });
    await dialog.getByRole('combobox', { name: 'Provider' }).selectOption('other');
    await dialog.getByRole('textbox', { name: 'Email address' }).fill(ADDRESS);
    await dialog.getByRole('textbox', { name: 'Incoming server (IMAP)' }).fill(`127.0.0.1:${IMAP_PORT}`);
    await dialog.getByRole('textbox', { name: 'Outgoing server (SMTP)' }).fill(`127.0.0.1:${SMTP_PORT}`);
    await dialog.getByLabel('App password').fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Connect' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 15_000 });
  }
  await rows.filter({ hasText: 'brake kit' }).first().click({ timeout: 15_000 });
  console.log(`Ready. Priya's email is open.\n  First time only: choose a model in Settings › Models.\n  Then press "Take care of this" in the Mobius panel. Close Mobius to end the demo.`);
} catch (e) {
  console.error(`Mobius is open, but setting up the demo stopped: ${String(e.message ?? e).split('\n')[0]}\nOpen Mail and Priya's email by hand.`);
}
await browser.close().catch(() => undefined);
