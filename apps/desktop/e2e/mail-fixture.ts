import net from 'node:net';
import type { AddressInfo } from 'node:net';

/** A tiny IMAP server for the tests: one account, an INBOX of the messages given, and a Sent mailbox. */
export interface MailFixture { imapPort: number; smtpPort: number; sent: string[]; /** Every IMAP command the app sent, without its tag. */ commands: string[]; close: () => Promise<void> }
export interface FakeMessage { uid: number; flags: string; raw: string }

export async function startMailServers(password: string, messages: FakeMessage[]): Promise<MailFixture> {
  const sent: string[] = [];
  const commands: string[] = [];
  const imap = net.createServer((socket) => {
    socket.write('* OK fake IMAP ready\r\n');
    let box = 'INBOX';
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let at: number;
      while ((at = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const [tag, ...rest] = line.split(' ');
        const command = rest.join(' ');
        commands.push(command);
        const upper = command.toUpperCase();
        const list = box === 'INBOX' ? messages : [];
        if (upper.startsWith('LOGIN')) socket.write(command.includes(`"${password}"`) ? `${tag} OK logged in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
        else if (upper.startsWith('LIST')) socket.write(`* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\HasNoChildren \\Sent) "/" "Sent"\r\n${tag} OK done\r\n`);
        else if (upper.startsWith('EXAMINE') || upper.startsWith('SELECT')) { box = command.includes('"Sent"') ? 'Sent' : 'INBOX'; socket.write(`* ${list.length} EXISTS\r\n* OK [UIDVALIDITY 7] ok\r\n${tag} OK done\r\n`); }
        else if (upper.startsWith('UID SEARCH')) socket.write(`* SEARCH ${list.map((m) => m.uid).join(' ')}\r\n${tag} OK done\r\n`);
        else if (upper.startsWith('UID FETCH')) {
          const wanted = (command.split(' ')[2] ?? '').split(',').map(Number);
          const parts: Buffer[] = [];
          list.forEach((m, i) => {
            if (!wanted.includes(m.uid)) return;
            const body = Buffer.from(m.raw, 'utf8');
            parts.push(Buffer.from(`* ${i + 1} FETCH (UID ${m.uid} FLAGS (${m.flags}) INTERNALDATE "08-Nov-2026 09:02:00 +0000" BODY[] {${body.length}}\r\n`), body, Buffer.from(')\r\n'));
          });
          parts.push(Buffer.from(`${tag} OK done\r\n`));
          socket.write(Buffer.concat(parts));
        } else if (upper.startsWith('UID MOVE') || upper.startsWith('UID COPY') || upper.startsWith('CREATE') || upper.includes('EXPUNGE')) socket.write(`${tag} OK done\r\n`);
        else if (upper.startsWith('UID STORE')) socket.write(`${tag} OK stored\r\n`);
        else if (upper.startsWith('LOGOUT')) { socket.write(`* BYE\r\n${tag} OK bye\r\n`); socket.end(); }
        else socket.write(`${tag} BAD what\r\n`);
      }
    });
    socket.on('error', () => {});
  });
  const smtp = net.createServer((socket) => {
    socket.write('220 fake SMTP ready\r\n');
    let data = false;
    let message = '';
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let at: number;
      while ((at = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (data) {
          if (line === '.') { data = false; sent.push(message); message = ''; socket.write('250 queued\r\n'); } else message += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) socket.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (upper.startsWith('AUTH PLAIN')) socket.write(Buffer.from(line.split(' ')[2] ?? '', 'base64').toString('utf8').endsWith(`\u0000${password}`) ? '235 ok\r\n' : '535 no\r\n');
        else if (upper.startsWith('MAIL FROM') || upper.startsWith('RCPT TO') || upper.startsWith('RSET') || upper.startsWith('NOOP')) socket.write('250 ok\r\n');
        else if (upper === 'DATA') { data = true; socket.write('354 go\r\n'); }
        else if (upper === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('502 what\r\n');
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => imap.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  return {
    imapPort: (imap.address() as AddressInfo).port,
    smtpPort: (smtp.address() as AddressInfo).port,
    sent,
    commands,
    close: async () => { await new Promise((r) => imap.close(() => r(null))); await new Promise((r) => smtp.close(() => r(null))); },
  };
}
