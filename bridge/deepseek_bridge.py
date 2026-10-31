"""Loopback-only DeepSeek bridge. Key is memory-only; never logs requests."""
import json, secrets, threading, urllib.request, urllib.error
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs
HOST='127.0.0.1'; PORT=18765
ORIGIN=f'http://{HOST}:{PORT}'
EXT='chrome-extension://ahnjeeapggambpncggoffklhemmgceha'
TOKEN=secrets.token_urlsafe(32)
KEY=''
BUSY=threading.Lock()
PROMPT=Path(__file__).with_name('reply-rules.txt').read_text()
def generate(post,mode="reply"):
    is_post=mode=="post"
    prompt=Path(__file__).with_name("post-rules.txt").read_text() if is_post else PROMPT
    if not KEY: raise ValueError('请先在本地设置页保存 DeepSeek 密钥')
    text=post.get('text','')
    if not isinstance(text,str) or not text.strip() or len(text)>16000: raise ValueError('帖子文本为空或过长')
    payload={'model':'deepseek-flash','messages':[{'role':'system','content':prompt},{'role':'user','content':json.dumps({('reference_text' if is_post else 'post_text'):text},ensure_ascii=False)}],'stream':False,'thinking':{'type':'disabled'},'max_tokens':512,'response_format':{'type':'json_object'}}
    req=urllib.request.Request('https://api.deepseek.com/chat/completions',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+KEY})
    try:
        with urllib.request.urlopen(req,timeout=22) as r: data=json.load(r)
    except urllib.error.HTTPError as e: raise ValueError('DeepSeek 请求失败（HTTP %s），请检查密钥、余额和模型权限'%e.code)
    except Exception: raise ValueError('DeepSeek 连接失败或超时，未生成回复')
    try:
        choice=data['choices'][0]
        if choice.get('finish_reason')!='stop': raise ValueError()
        result=json.loads(choice['message']['content'])
        if result.get('action')=='skip': return {'action':'skip','text':''}
        reply=result.get('text','').strip()
        if result.get('action')!=('send_post' if is_post else 'send_reply') or not reply or len(reply)>140 or 'http' in reply.lower() or any(x in reply for x in ['我','本人','亲测','不是','不等于','与其','你以为']): raise ValueError()
        if is_post:
            if '#' in reply or '@' in reply: raise ValueError()
            return {'action':'send_post','text':reply}
        suffix='交个朋友呀\n请回关我'
        if not reply.endswith(suffix): reply+='\n'+suffix
        return {'action':'send_reply','text':reply}
    except Exception: raise ValueError('AI 回复格式不合格，已阻止发送')
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def valid(self): return self.headers.get('Host')==f'{HOST}:{PORT}'
    def respond(self,status,body,html=False):
        data=body.encode() if html else json.dumps(body,ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type','text/html; charset=utf-8' if html else 'application/json');self.send_header('Cache-Control','no-store');self.send_header('X-Frame-Options','DENY')
        if self.headers.get('Origin')==EXT: self.send_header('Access-Control-Allow-Origin',EXT)
        self.end_headers();self.wfile.write(data)
    def do_OPTIONS(self):
        if not self.valid() or self.headers.get('Origin')!=EXT:return self.respond(403,{'error':'禁止访问'})
        self.send_response(204);self.send_header('Access-Control-Allow-Origin',EXT);self.send_header('Access-Control-Allow-Methods','GET, POST');self.send_header('Access-Control-Allow-Headers','Content-Type');self.end_headers()
    def do_GET(self):
        if not self.valid():return self.respond(403,{'error':'禁止访问'})
        if self.path=='/health':return self.respond(200,{'ready':bool(KEY),'model':'deepseek-flash'})
        if self.path!='/':return self.respond(404,{'error':'不存在'})
        self.respond(200,'''<!doctype html><meta charset="utf-8"><title>DeepSeek 本地设置</title><h1>DeepSeek 密钥设置</h1><p>密钥只保存在本地服务内存，重启需重新输入。不会写入插件、日志或聊天。</p><form method="post" action="/configure"><input type="hidden" name="csrf" value="'''+TOKEN+'''"><label>API Key <input type="password" name="key" required autocomplete="off" size="55"></label><button>保存到内存</button></form><p>保存后请回到聊天告诉我“已保存”。下一步仅测试生成，不发布回复。</p>''',True)
    def do_POST(self):
        global KEY
        if not self.valid():return self.respond(403,{'error':'禁止访问'})
        origin=self.headers.get('Origin')
        if (self.path=='/configure' and origin!=ORIGIN) or (self.path in ['/reply','/post'] and origin not in [EXT,ORIGIN]):return self.respond(403,{'error':'来源未授权'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=70000:raise ValueError('请求大小无效')
            raw=self.rfile.read(size)
            if self.path=='/configure':
                form=parse_qs(raw.decode())
                if not secrets.compare_digest(form.get('csrf',[''])[0],TOKEN):return self.respond(403,{'error':'校验失败'})
                key=form.get('key',[''])[0].strip()
                if len(key)<16 or len(key)>256 or any(c.isspace() for c in key):raise ValueError('密钥格式无效')
                KEY=key
                return self.respond(200,'<meta charset="utf-8"><h2>密钥已保存在本地内存</h2><p>尚未调用 API。请回聊天回复“已保存”，进行生成测试。</p>',True)
            if self.path not in ['/reply','/post']:return self.respond(404,{'error':'不存在'})
            if origin!=EXT:return self.respond(403,{'error':'只允许插件请求生成'})
            if not BUSY.acquire(False):return self.respond(409,{'error':'正在生成，请稍后'})
            try:return self.respond(200,generate(json.loads(raw),"post" if self.path=="/post" else "reply"))
            finally:BUSY.release()
        except ValueError as e:return self.respond(400,{'error':str(e) if len(str(e))<150 else '请求无效'})
        except Exception:return self.respond(500,{'error':'本地服务处理失败'})
if __name__=='__main__':
    print('DeepSeek local setup: '+ORIGIN,flush=True)
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
