"""
Renders the app's real UI (app/src/main/assets/index.html + rd-api.js) in headless Chromium with a fake
Android bridge and DEMO data, and saves the pictures used in README.md.
Run:  pip install playwright && playwright install chromium && python tools/make_screenshots.py
"""
import pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = (ROOT / "app/src/main/assets/index.html").as_uri()
OUT = ROOT / "docs/screenshots"
OUT.mkdir(parents=True, exist_ok=True)

INIT = r"""
(() => {
  const now = Date.now(), iso = d => new Date(now - d * 3600e3).toISOString();
  const T = [
    { id:'T1', filename:'Big.Buck.Bunny.2008.2160p.BluRay.x265', hash:'a'.repeat(40), bytes:9800000000, progress:100, status:'downloaded', added:iso(5), files:[], links:['l1'] },
    { id:'T2', filename:'Ubuntu.24.04.Desktop.amd64.iso', hash:'b'.repeat(40), bytes:6200000000, progress:63, status:'downloading', speed:48200000, seeders:187, added:iso(1), files:[], links:[] },
    { id:'T3', filename:'Sintel.2010.1080p.WEB-DL.DDP5.1', hash:'c'.repeat(40), bytes:2400000000, progress:100, status:'downloaded', added:iso(30), files:[], links:['l1'] },
    { id:'T4', filename:'Documentary.Collection.S01.720p', hash:'d'.repeat(40), bytes:0, progress:0, status:'waiting_files_selection', added:iso(.2), files:[], links:[] },
    { id:'T5', filename:'Old.Release.Dead.Torrent', hash:'e'.repeat(40), bytes:1500000000, progress:0, status:'dead', added:iso(70), files:[], links:[] },
  ];
  const HOSTS = {}; ['1fichier.com','rapidgator.net','nitroflare.com','uptobox.com','mega.nz','mediafire.com','turbobit.net','katfile.com','ddownload.com','filefactory.com','uploaded.net','hitfile.net','4shared.com','drive.google.com','dailymotion.com','vimeo.com','youtube.com','pixeldrain.com','send.cm','krakenfiles.com'].forEach((h,i)=>HOSTS[h]={name:h.split('.')[0].replace(/^./,c=>c.toUpperCase()),supported:1,status:i===7?'down':'up'});
  const DL = ['Movie.Night.2025.1080p.mkv|4300000000','Season.1.Episode.04.mkv|1400000000','Album.Flac.zip|610000000','Setup.Pro.v12.rar|880000000'].map((x,i)=>({id:'D'+i,filename:x.split('|')[0],filesize:+x.split('|')[1],host:['1fichier.com','rapidgator.net','mega.nz','nitroflare.com'][i],generated:iso(i*9+1),link:'https://example.com/f'+i,download:'https://dl/'+i}));
  const J = (s,o) => ({status:s, body:o===undefined?'':JSON.stringify(o)});
  function api(m,u,h,b){
    const url=new URL(u), p=url.pathname.replace('/rest/1.0',''), f=Object.fromEntries(new URLSearchParams(b||''));
    if (p==='/user') return J(200,{id:1,username:'demo_user',email:'demo@example.com',points:1240,type:'premium',premium:12400000,expiration:new Date(now+143*864e5).toISOString()});
    if (p==='/torrents') return +url.searchParams.get('page')===1?J(200,T):J(204);
    let r; if ((r=p.match(/^\/torrents\/info\/(.+)/))) { const t=T.find(x=>x.id===r[1]); return t?J(200,t):J(404,{error:'unknown_ressource',error_code:7}); }
    if (p==='/downloads') return +url.searchParams.get('page')===1?J(200,DL):J(204);
    if (p==='/hosts/status') return J(200,HOSTS);
    if (p==='/traffic') return J(200,{'rapidgator.net':{left:82,limit:100,type:'links'},'nitroflare.com':{left:6,limit:20,type:'gigabytes'},'uploaded.net':{left:1,limit:10,type:'links'}});
    if (p==='/unrestrict/link') { const n=decodeURIComponent((f.link||'').split('/').pop()||'file.bin'); return J(200,{id:'U'+Math.random().toString(36).slice(2,8),filename:n,filesize:(n.length*91234567)%3000000000+300000000,link:f.link,host:'x.com',download:'https://dl.real-debrid.com/d/'+n,streamable:1}); }
    if (p==='/oauth/v2/device/code') return J(200,{device_code:'DEV',user_code:'A7K9-2QXF',interval:5,expires_in:600,verification_url:'https://real-debrid.com/device',direct_verification_url:'https://real-debrid.com/device?user_code=A7K9-2QXF'});
    if (p==='/oauth/v2/device/credentials') return J(403,{error:'authorization_pending',error_code:7});
    return J(404,{error:'unknown_method',error_code:3});
  }
  window.__TV = false;
  window.Android = {
    request(id,m,u,h,b){ setTimeout(()=>window.__cb(id,JSON.stringify(api(m,u,JSON.parse(h||'{}'),b))), 30); },
    isTv:()=>!!window.__TV, isSystemDark:()=>true, setTheme(){}, paste:()=> 'https://1fichier.com/?demo123', copy(){}, share(){}, openUrl(){}, setSecure(){},
    appInfo:()=>JSON.stringify({versionCode:105,versionName:'1.0.5',repo:''}), dlStatus:()=>'[]', dlSetParallel(){}, dlAdd:()=>1, dlPause(){}, dlResume(){}, dlStop(){}, dlRemove(){},
    isDeviceSecure:()=>false, authenticate(){}, play(){}
  };
  localStorage.setItem('ad_keys', JSON.stringify({active:'main', keys:{main:'DEMO'}}));
  localStorage.setItem('ad_cfg', JSON.stringify(Object.assign({parallel:3,folderPerTorrent:true,autoDeleteMagnet:false,theme:'dark',autoUpdate:false,clip:false,clipboard:false}, window.__CFG||{})));
  const d=iso(2); localStorage.setItem('ad_hist', JSON.stringify([
    {date:iso(3),type:'link',host:'1fichier.com',filename:'Movie.Night.2025.1080p.mkv',size:4300000000,source:'https://1fichier.com/?a1',link:'https://dl/1'},
    {date:iso(30),type:'link',host:'rapidgator.net',filename:'Season.1.Episode.04.mkv',size:1400000000,source:'https://rapidgator.net/file/b2',link:'https://dl/2'},
    {date:iso(55),type:'link',host:'mega.nz',filename:'Album.Flac.zip',size:610000000,source:'https://mega.nz/file/c3',link:'https://dl/3'}]));
})();
"""

def new_page(b, w, h, dsf, theme="dark", tv=False):
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=dsf,
                        color_scheme="dark" if theme == "dark" else "light", is_mobile=not tv, has_touch=not tv)
    pg = ctx.new_page()
    pg.add_init_script("window.__CFG={theme:'%s'};" % theme)
    pg.add_init_script(INIT)
    if tv: pg.add_init_script("window.__TV=true;")
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(PAGE); pg.wait_for_timeout(700)
    return pg, errs

def snap(pg, name): pg.screenshot(path=str(OUT / name)); print("saved", name)

with sync_playwright() as p:
    b = p.chromium.launch()
    allerrs = []

    # ---------- phone, dark ----------
    pg, errs = new_page(b, 390, 844, 2)
    pg.fill("#inp", "https://1fichier.com/Movie.Night.2025.1080p.mkv\nhttps://rapidgator.net/file/Season.1.Episode.04.mkv\nhttps://mega.nz/file/Album.Flac.zip\nmagnet:?xt=urn:btih:" + "a"*40)
    pg.dispatch_event("#inp", "input"); pg.wait_for_timeout(200)
    snap(pg, "01-generate.png")
    pg.click("#bGen"); pg.wait_for_selector(".overlay.show #rList .item", timeout=15000); pg.wait_for_timeout(500)
    pg.click(".overlay.show #rList .item >> nth=0"); pg.wait_for_timeout(300)
    snap(pg, "02-results.png")
    pg.click(".overlay.show [data-close]"); pg.wait_for_timeout(400)
    pg.evaluate("go('tor')"); pg.wait_for_selector("#tList .item", timeout=8000); pg.wait_for_timeout(400)
    pg.click("#tList .item >> nth=1"); pg.wait_for_timeout(300)
    snap(pg, "03-torrents.png")
    pg.evaluate("go('more')"); pg.wait_for_timeout(300)
    pg.click("[data-m=hosts]"); pg.wait_for_selector("#hsL .item", timeout=8000); pg.wait_for_timeout(300)
    snap(pg, "04-hosts.png")
    pg.click(".overlay.show [data-close]"); pg.wait_for_timeout(400)
    pg.click("[data-m=usage]"); pg.wait_for_selector(".qrow", timeout=8000); pg.wait_for_timeout(300)
    snap(pg, "05-usage.png")
    pg.click(".overlay.show [data-close]"); pg.wait_for_timeout(400)
    pg.click("[data-m=account]"); pg.wait_for_timeout(300); pg.click("#acPin"); pg.wait_for_selector("#pnNo", timeout=8000); pg.wait_for_timeout(300)
    snap(pg, "06-login-code.png")
    allerrs += errs; pg.context.close()

    # ---------- phone, light ----------
    pg, errs = new_page(b, 390, 844, 2, theme="light")
    pg.evaluate("go('tor')"); pg.wait_for_selector("#tList .item", timeout=8000); pg.wait_for_timeout(400)
    snap(pg, "07-torrents-light.png"); allerrs += errs; pg.context.close()

    # ---------- tablet ----------
    pg, errs = new_page(b, 1000, 700, 1.5)
    pg.evaluate("go('tor')"); pg.wait_for_selector("#tList .item", timeout=8000); pg.wait_for_timeout(400)
    snap(pg, "08-tablet.png"); allerrs += errs; pg.context.close()

    # ---------- TV (remote only: arrow keys + Enter) ----------
    pg, errs = new_page(b, 1280, 720, 1, tv=True)
    assert "tv" in pg.evaluate("document.documentElement.className"), "TV mode not detected"
    pg.wait_for_timeout(600)
    focus = lambda: pg.evaluate("(document.activeElement.textContent||'').trim().slice(0,24) + ' | ' + document.activeElement.tagName")
    print("TV start focus   :", focus())
    pg.keyboard.press("ArrowRight"); print("TV after Right   :", focus())
    pg.keyboard.press("Enter"); pg.wait_for_selector("#tList .item", timeout=8000); pg.wait_for_timeout(500)
    print("TV after Enter   :", pg.evaluate("curTab"))
    for _ in range(3): pg.keyboard.press("ArrowUp")
    print("TV moved up      :", focus())
    pg.keyboard.press("ArrowDown")
    print("TV in list       :", focus())
    pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    assert pg.evaluate("!!document.querySelector('#tList .item.open')"), "Enter did not open the item menu"
    pg.keyboard.press("ArrowDown"); print("TV menu focus    :", focus())
    assert pg.evaluate("document.activeElement.classList.contains('mbtn')"), "Down from an open item must reach its menu buttons"
    assert "Download all" in focus(), "first action button expected"
    pg.keyboard.press("ArrowRight"); print("TV menu right    :", focus())
    assert pg.evaluate("document.activeElement.classList.contains('mbtn')"), "Right must stay in the action row"
    pg.keyboard.press("ArrowUp"); print("TV back to item  :", focus())
    assert pg.evaluate("document.activeElement.classList.contains('item')"), "Up from the menu must return to the item"
    pg.keyboard.press("ArrowDown")
    snap(pg, "09-tv-remote.png"); allerrs += errs; pg.context.close()

    b.close()

real = [e for e in allerrs if e]
print("page errors:", real if real else "none")
sys.exit(1 if real else 0)
