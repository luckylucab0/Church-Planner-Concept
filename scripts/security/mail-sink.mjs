// Minimaler SMTP-Sink für das Security-Lab.
//
// Warum eigenes Skript statt Mailpit: Das Pentest-Lab läuft ohne Docker
// (siehe README). Token-basierte Flows (Einladung, Passwort-Reset, Zusage)
// verschicken ihre Tokens ausschließlich per Mail – in der DB liegt nur der
// SHA-256-Hash. Ohne Mail-Abgriff lassen sich diese Flows also gar nicht
// dynamisch testen. Der Sink nimmt Mails per SMTP an und gibt sie über eine
// kleine HTTP-API wieder aus.
//
// Start:  node scripts/security/mail-sink.mjs
//         SMTP auf :1025, HTTP auf :8025 (wie Mailpit im dev-Compose)
import net from 'node:net';
import http from 'node:http';

const SMTP_PORT = Number(process.env.SINK_SMTP_PORT ?? 1025);
const HTTP_PORT = Number(process.env.SINK_HTTP_PORT ?? 8025);

/** @type {{to: string[], body: string, at: string}[]} */
const messages = [];

// Nodemailer verschickt die Textmails quoted-printable-kodiert. Ohne
// Dekodierung stehen Tokens als "token=3DAbc..." in der Mail und ein
// naiver Regex liest das "3D" mit – die Token-Flows wären damit nicht
// testbar. Deshalb hier einmal sauber dekodieren.
function decodeQuotedPrintable(text) {
  return text
    .replace(/=\r?\n/g, '') // weiche Zeilenumbrüche
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Sehr kleiner SMTP-Dialog: nur so viel, wie nodemailer für einen
// erfolgreichen Versand braucht (kein AUTH, kein TLS – reiner Testsink).
net
  .createServer((socket) => {
    let buffer = '';
    let inData = false;
    let current = { to: [], lines: [] };

    const send = (line) => socket.write(`${line}\r\n`);
    send('220 serveflow-mail-sink');

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push({
              to: current.to,
              body: decodeQuotedPrintable(current.lines.join('\n')),
              at: new Date().toISOString(),
            });
            current = { to: [], lines: [] };
            send('250 OK');
          } else {
            // Punkt-Stuffing gemäß RFC 5321 rückgängig machen
            current.lines.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }

        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          send('250-serveflow-mail-sink');
          send('250 8BITMIME');
        } else if (upper.startsWith('MAIL FROM')) {
          send('250 OK');
        } else if (upper.startsWith('RCPT TO')) {
          const match = line.match(/<([^>]+)>/);
          if (match) current.to.push(match[1]);
          send('250 OK');
        } else if (upper === 'DATA') {
          inData = true;
          send('354 End data with <CR><LF>.<CR><LF>');
        } else if (upper === 'QUIT') {
          send('221 Bye');
          socket.end();
        } else if (upper === 'RSET') {
          current = { to: [], lines: [] };
          send('250 OK');
        } else {
          send('250 OK');
        }
      }
    });
    socket.on('error', () => socket.destroy());
  })
  .listen(SMTP_PORT, '127.0.0.1', () => console.log(`SMTP-Sink auf :${SMTP_PORT}`));

// HTTP-API: GET /messages liefert alles, DELETE /messages leert den Puffer.
http
  .createServer((req, res) => {
    if (req.method === 'DELETE') {
      messages.length = 0;
      res.writeHead(204).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(messages));
  })
  .listen(HTTP_PORT, '127.0.0.1', () => console.log(`HTTP-API auf :${HTTP_PORT}`));
