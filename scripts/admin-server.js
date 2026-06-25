// Simple static server for admin panel testing
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const root = 'C:/Users/maruf/Downloads/YARZ WEB SITE';
const types = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain'
};
http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(url.parse(req.url).pathname));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); res.end('404 ' + p); }
    else { res.writeHead(200, { 'Content-Type': types[path.extname(p).toLowerCase()] || 'application/octet-stream' }); res.end(d); }
  });
}).listen(8766, () => console.log('Server running on http://localhost:8766/'));
