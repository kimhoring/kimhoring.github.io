"""SOC-MAP 화면을 headless Chrome(CDP)으로 자동 촬영해 홈페이지 스크린샷을 만듭니다.

사용:
    python main.py --port 8765                                   # SOC-MAP 서버 (다른 터미널)
    python scripts/capture-screenshots.py assets/img --base http://localhost:8765

- 샘플 현장을 열고 서버 프로젝트를 하나 만든 뒤 가상 인원과 시연 모드 휴대폰으로 화면을 찍습니다.
- 촬영이 끝나면 서버의 backend/projects/ 에 「(시연)」 프로젝트가 남으니 지우세요.
- 필요: Chrome 또는 Edge, `pip install websockets`
"""
import argparse, asyncio, base64, json, os, shutil, subprocess, time, urllib.request
import websockets

ap = argparse.ArgumentParser()
ap.add_argument("out", help="스크린샷을 저장할 폴더")
ap.add_argument("--base", default="http://localhost:8765", help="SOC-MAP 서버 주소")
ap.add_argument("--chrome", default=None, help="Chrome/Edge 실행 파일 경로")
args = ap.parse_args()

BASE = args.base.rstrip("/")
OUT = args.out
PROFILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chrome-profile")
CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    shutil.which("google-chrome") or "", shutil.which("chromium") or "",
]
CHROME = args.chrome or next((c for c in CANDIDATES if c and os.path.exists(c)), None)
if not CHROME:
    raise SystemExit("Chrome/Edge 를 찾지 못했습니다. --chrome 으로 경로를 지정하세요.")
PORT = 9333
os.makedirs(OUT, exist_ok=True)


class Page:
    def __init__(self, ws):
        self.ws, self.n, self.pending = ws, 0, {}
        self.reader = asyncio.create_task(self._read())

    async def _read(self):
        async for raw in self.ws:
            msg = json.loads(raw)
            if "id" in msg and msg["id"] in self.pending:
                self.pending.pop(msg["id"]).set_result(msg)

    async def send(self, method, params=None):
        self.n += 1
        fut = asyncio.get_event_loop().create_future()
        self.pending[self.n] = fut
        await self.ws.send(json.dumps({"id": self.n, "method": method, "params": params or {}}))
        msg = await asyncio.wait_for(fut, 60)
        if "error" in msg:
            raise RuntimeError(f"{method}: {msg['error']}")
        return msg.get("result", {})

    async def js(self, expr):
        r = await self.send("Runtime.evaluate", {"expression": expr, "awaitPromise": True, "returnByValue": True})
        if "exceptionDetails" in r:
            raise RuntimeError(f"JS error: {r['exceptionDetails'].get('exception', {}).get('description', r['exceptionDetails'])}")
        return r.get("result", {}).get("value")

    async def shot(self, name, quality=86):
        r = await self.send("Page.captureScreenshot", {"format": "jpeg", "quality": quality})
        path = os.path.join(OUT, name)
        with open(path, "wb") as f:
            f.write(base64.b64decode(r["data"]))
        print("saved", name, os.path.getsize(path) // 1024, "KB")


def new_target():
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/json/new?about:blank", method="PUT")
    return json.loads(urllib.request.urlopen(req).read())["webSocketDebuggerUrl"]


async def open_page(width, height, dsf, mobile):
    ws = await websockets.connect(new_target(), max_size=64 * 2**20)
    p = Page(ws)
    await p.send("Page.enable")
    await p.send("Network.enable")
    await p.send("Network.setCacheDisabled", {"cacheDisabled": True})
    await p.send("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": dsf, "mobile": mobile})
    if mobile:
        await p.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    return p


async def nav(p, url, wait=3):
    await p.send("Page.navigate", {"url": url})
    await asyncio.sleep(wait)


CLEAN = "document.getElementById('toasts').innerHTML='';"


async def main():
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}", f"--user-data-dir={PROFILE}",
                               "--no-first-run", "--no-default-browser-check", "--window-size=1440,900",
                               "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", "about:blank"])
    try:
        for _ in range(40):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version"); break
            except Exception:
                time.sleep(0.25)

        # ── 관리자 화면 ──
        m = await open_page(1440, 900, 1, False)
        await nav(m, BASE + "/map", 4)
        await m.js("localStorage.clear(); true")
        await nav(m, BASE + "/map", 4)
        await m.js("loadSample()")
        await asyncio.sleep(6)
        await m.js(CLEAN)
        await m.shot("manager-layout.jpg")

        await m.js("setWorkspace('route'); " + CLEAN)
        await asyncio.sleep(1.5)
        await m.shot("manager-route.jpg")

        await m.js("toggleHeat(); setWorkspace('site'); " + CLEAN)
        await asyncio.sleep(2)
        await m.shot("manager-heatmap.jpg")
        await m.js("toggleHeat(); true")

        # 서버 프로젝트 생성 (현재 배치 유지)
        await m.js("""(async () => {
          openProjectModal('new');
          document.getElementById('prjNameInput').value = '광주 ○○ 신축공사 (시연)';
          document.getElementById('prjLocInput').value = '35.17600, 126.90650';
          document.getElementById('prjKeep').checked = true;
          document.getElementById('prjCreateBtn').click();
          return true; })()""")
        await asyncio.sleep(4)
        code = await m.js("PRJ.joinCode")
        print("join code", code)
        for _ in range(10):
            if await m.js("PRJ.connected"): break
            await asyncio.sleep(1)
        # 작업자만 먼저 투입 (장비가 움직이지 않는 상태에서 현장 앱 촬영)
        await m.js("PRJ.sims = ['가상 A', '가상 B', '가상 C'].map((n, i) => new SimClient(n, i, 'worker')); renderMonitor(); true")
        await asyncio.sleep(3)

        # ── 현장 앱 (휴대폰) ──
        f = await open_page(390, 844, 2, True)
        await nav(f, f"{BASE}/j/{code}", 4)
        await f.shot("field-join.jpg")
        await f.js("""(async () => {
          goStep(2);
          const n = document.getElementById('nameInput'); n.value = '김안전'; n.dispatchEvent(new Event('input'));
          goStep(3);
          document.getElementById('simMode').checked = true;
          const c = document.getElementById('consent'); c.checked = true; c.dispatchEvent(new Event('change'));
          await start(); return true; })()""")
        await asyncio.sleep(3)
        # 굴착기 위험 반경 바깥, 접근 경고 거리 안쪽에 위치
        print(await f.js("""(() => { const e = A.markers.find(x => x.type === 'excavator');
          setSimPos(e.x + 13, e.y - 2); return [e.x, e.y]; })()"""))
        await asyncio.sleep(3)
        print("level", await f.js("A.shown && A.shown.level || (A.tracker && A.tracker.level)"))
        await f.shot("field-warning.jpg")
        await f.js("setTab('near'); true")
        await asyncio.sleep(1)
        await f.shot("field-near.jpg")
        await f.js("""(() => { const e = A.markers.find(x => x.type === 'excavator'); setTab('map'); setSimPos(e.x + 2, e.y + 4); return true; })()""")
        await asyncio.sleep(3.5)
        print("level", await f.js("A.shown && A.shown.level || (A.tracker && A.tracker.level)"))
        await f.shot("field-danger.jpg")
        await f.js("setTab('alerts'); true")
        await asyncio.sleep(1)
        await f.shot("field-alerts.jpg")
        await f.js("setTab('map'); true")

        # ── 관제 화면 (작업자 진입 상태) + 굴착기 운전원 투입 ──
        await m.js("(() => { const mv = S.markers.find(x => x.type === 'excavator'); PRJ.sims.push(new SimClient(`가상 운전원 (${mv.label})`, 0, 'operator', mv.id)); renderMonitor(); return true; })()")
        await asyncio.sleep(5)
        await m.js("setWorkspace('monitor'); " + CLEAN)
        await asyncio.sleep(1.5)
        await m.shot("manager-monitor.jpg")

        await m.js("setMode('3d'); " + CLEAN)
        await asyncio.sleep(5)
        await m.js(CLEAN)
        await m.shot("manager-3d.jpg")
        await m.js("setMode('select'); setWorkspace('plan'); " + CLEAN)
        await asyncio.sleep(1.5)
        await m.shot("manager-plan.jpg")

        await m.js("stopSims(); true")
        pid = await m.js("S.project.id")
        print(f"촬영 완료. 서버에 남은 시연 프로젝트: backend/projects/{pid}")
        await asyncio.sleep(1)
    finally:
        chrome.terminate()


asyncio.run(main())
