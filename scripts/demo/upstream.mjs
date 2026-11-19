import { createServer } from 'node:http';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('pass a valid port number');
}

const server = createServer((request, response) => {
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ demo: 'weather-api', path: request.url }));
});

server.listen(port, '127.0.0.1');
