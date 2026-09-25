"""Local dev server for Salad Escape (no caching, so edits show up on reload).

Usage:  python3 serve.py   then open http://localhost:8123
"""
import http.server
import os
import socketserver

PORT = 8123
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
    print(f"Salad Escape running at http://localhost:{PORT}")
    httpd.serve_forever()
