import net from "node:net";
import { once } from "node:events";

// Loopback-only SMTP capture server for integration tests. It never relays mail.
export async function createSmtpInbox() {
  const messages = [];
  const rejected = new Set();
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    socket.write("220 guardrail-test ESMTP\r\n");
    let buffer = "";
    let data = null;
    let sender = "";
    let recipients = [];
    socket.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data !== null) {
          if (line === ".") {
            messages.push({ sender, recipients: [...recipients], raw: data.join("\r\n") });
            data = null;
            socket.write("250 queued locally\r\n");
          } else data.push(line.startsWith("..") ? line.slice(1) : line);
        } else if (/^(EHLO|HELO) /i.test(line)) socket.write("250-guardrail-test\r\n250 PIPELINING\r\n");
        else if (/^MAIL FROM:/i.test(line)) { sender = /<([^>]*)>/.exec(line)?.[1] ?? ""; recipients = []; socket.write("250 sender ok\r\n"); }
        else if (/^RCPT TO:/i.test(line)) {
          const recipient = /<([^>]*)>/.exec(line)?.[1] ?? "";
          if (rejected.has(recipient)) socket.write("550 recipient rejected for test\r\n");
          else { recipients.push(recipient); socket.write("250 recipient ok\r\n"); }
        } else if (/^DATA$/i.test(line)) { data = []; socket.write("354 end with dot\r\n"); }
        else if (/^QUIT$/i.test(line)) socket.end("221 goodbye\r\n");
        else if (/^(RSET|NOOP)$/i.test(line)) socket.write("250 ok\r\n");
        else socket.write("502 command not implemented\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: server.address().port, messages, rejected,
    async close() { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); },
  };
}

export function mailText(message) {
  const separator = message.raw.indexOf("\r\n\r\n");
  const headers = message.raw.slice(0, separator);
  const body = message.raw.slice(separator + 4);
  if (/Content-Transfer-Encoding: base64/i.test(headers)) return globalThis.Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
  if (/Content-Transfer-Encoding: quoted-printable/i.test(headers)) return body.replace(/=\r\n/g, "").replace(/=([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  return body;
}
