"""OpenAI 兼容 mock 上游，用于本地测试 AI 代理（SSE 流式 + models）。"""
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not self.path.endswith('/chat/completions'):
            self.send_error(404)
            return
        # 读请求体，判断 stream 模式
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length) or b'{}')
        stream = body.get('stream', True)
        self.send_response(200)
        if stream:
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            for i in range(6):
                chunk = json.dumps({"choices": [{"delta": {"content": f"token{i}"}}]})
                self.wfile.write(f"data: {chunk}\n\n".encode())
                self.wfile.flush()
                time.sleep(0.15)
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        else:
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            resp = {"choices": [{"message": {"content": "非流式完整回复"}}]}
            self.wfile.write(json.dumps(resp).encode())
        self.wfile.flush()

    def do_GET(self):
        if not self.path.endswith('/models'):
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        data = {"data": [{"id": "mock-model"}, {"id": "gpt-4o"}, {"id": "mock-model"}]}
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    HTTPServer(('127.0.0.1', 9900), Handler).serve_forever()
