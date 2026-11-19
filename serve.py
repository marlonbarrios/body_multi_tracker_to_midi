# Local server for Body MIDI (no caching, so a reload always runs the latest files).
#   python3 serve.py        → http://localhost:8765   (open it in Chrome: Web MIDI + camera)
import http.server, socketserver, sys, os

os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 8765))

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), NoCache) as httpd:
    print(f'Body MIDI on http://localhost:{PORT}', flush=True)
    httpd.serve_forever()
