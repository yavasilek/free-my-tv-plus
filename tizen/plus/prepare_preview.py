"""Prepare a browser preview from synthetic search records, without network or account data."""
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[2]
out = root / 'out' / 'plus-tests'
out.mkdir(parents=True, exist_ok=True)
fixtures = {}
for query, pages in [('Матрица', 1), ('Интерстеллар', 1), ('Человек', 2)]:
    for page in range(1, pages + 1):
        channels = [{'details': {'id': format(page * 100 + i, '024x'), 'type': 'movie',
                     'name': query + ' ' + str(i), 'released': '2024',
                     'poster': 'https://image.tmdb.org/t/p/w185/fixture.jpg',
                     'bg_poster': {'backdrop': 'https://image.tmdb.org/t/p/w780/fixture.jpg'}}}
                    for i in range(12)]
        next_page = 'https://api.vokino.pro/v2/search?name=' + query + '&page=2' if page < pages else None
        fixtures[query + ':' + str(page)] = {'type': 'list', 'channels': channels, 'page': {'next': next_page}}
(out / 'public-search-fixtures.json').write_text(json.dumps(fixtures, ensure_ascii=False), encoding='utf-8')
with zipfile.ZipFile(root / 'FreeMyTV-Plus-tizen.wgt') as z:
    (out / 'home.css').write_bytes(z.read('home.css'))
    (out / 'fonts').mkdir(exist_ok=True)
    (out / 'fonts' / 'InterVariable.ttf').write_bytes(z.read('fonts/InterVariable.ttf'))
(out / 'preview.html').write_text('''<!doctype html><html class="lite"><head><meta charset="utf-8">
<title>Free My TV - VoKino search preview</title><link rel="stylesheet" href="home.css"><link rel="stylesheet" href="../../tizen/plus/vokino-search.css">
<style>body{background:#000}#title{color:#fff}#stage{background:#000}</style></head><body><div id="stage"><h1 id="title">Free My TV</h1></div>
<script>
var nativeFetch=fetch.bind(window),fixtures=nativeFetch('public-search-fixtures.json').then(function(r){return r.json();});
window.__searchCalls=0;window.__homeKeys=0;window.__launches=[];
window.fetch=function(url,options){return fixtures.then(function(data){
  var u=new URL(url),q=u.searchParams.get('name')||'',p=u.searchParams.get('page')||'1';
  if(u.pathname.indexOf('/search')>=0){window.__searchCalls++;if(q==='ошибка')throw new Error('Offline test');}
  var r=JSON.parse(JSON.stringify(data[q+':'+p]||{type:'list',channels:[],page:{}}));
  if(r.page&&r.page.next){var n=new URL(r.page.next);n.protocol=u.protocol;n.host=u.host;r.page.next=n.href;}
  return {ok:true,json:function(){return Promise.resolve(r);}};
});};
window.Prefs={cards:function(){return 16;},shelf:function(){return ['UMHvZ0dWqo.AnalogWatch'];},set:function(){}};
window.Data={picks:function(){return [];},hasKey:function(){return false;},image:function(p){return p;},appFor:function(){return null;},showcase:function(){return [];},settingsChanged:function(){}};
window.TV={launch:function(id,p,done){window.__launches.push({id:id});if(done)done(true);}};
window.tizen={application:{getAppInfo:function(){throw new Error('No native service in browser preview');},launchAppControl:function(control,id,yes){window.__launches.push({id:id});yes();}},
 ApplicationControlData:function(key,value){this.key=key;this.value=value;},ApplicationControl:function(op,uri,mime,cat,data){this.data=data;}};
window.FreeMyTV={state:{zone:'top',top:6,tab:0,card:0,shelf:0},hideSaver:function(){},poke:function(){},move:function(){}};
function fit(){var s=window.VoKinoSearch&&VoKinoSearch.isOpen()?innerWidth/1920:Math.min(innerWidth/1920,innerHeight/1080);document.getElementById('stage').style.transform=s===1?'':'scale('+s+')';}
window.addEventListener('resize',fit);
</script><script src="../../tizen/plus/vokino-sections.js"></script><script src="../../tizen/plus/compact-adapter.js"></script><script src="../../tizen/plus/vokino-search.js"></script>
<script>document.addEventListener('keydown',function(){window.__homeKeys++;});
window.__readyPromise=fixtures.then(function(){return new Promise(function(resolve){VoKinoBridge.search('Матрица',1,function(){VoKinoSearch.restore({cursor:0});resolve(true);});});});
</script></body></html>''', encoding='utf-8')
print('Prepared preview with synthetic movie metadata only.')
