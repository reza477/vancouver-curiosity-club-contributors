import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const code = ts.transpileModule(await readFile(new URL("../../lib/public-poster-navigation.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve; let reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
const tick = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
test('late and failed artwork remains fail-open, and navigation listeners clean up without cancelling a destination remount',async()=>{
  const motion=await readFile(new URL('../../app/_components/PublicArtworkMotion.tsx',import.meta.url),'utf8');
  const navigation=await readFile(new URL('../../app/_components/PublicPosterNavigation.tsx',import.meta.url),'utf8');
  const css=await readFile(new URL('../../app/styles/components/responsive-overrides.css',import.meta.url),'utf8');
  assert.match(motion,/if \(!ready\) \{ element.dataset.artworkRevealState = "static"; return; \}/u);
  assert.match(motion,/stage.addEventListener\("load", retryLoadedPoster, true\)/u);
  assert.match(motion,/stage.removeEventListener\("load", retryLoadedPoster, true\)/u);
  assert.match(motion,/if \(index === latestRequestedIndex\) activate\(index\)/u);
  assert.match(motion,/if \(!image && incoming.querySelector\("\.home-artwork-fallback"\)\) \{[\s\S]*?setStageState\(articles, activeIndex, null\)/u);
  assert.match(motion,/fallbackObserver\.disconnect\(\)/u);
  assert.match(navigation,/let navigationStyles: Promise<unknown> \| undefined/u);
  assert.match(navigation,/navigationStyles \?\?= import\("\.\.\/styles\/connected-navigation\.css"\)/u);
  for(const event of ['popstate','pagehide']){
    assert.ok(navigation.includes(`addEventListener("${event}", cancelPosterNavigationMotion)`));
    assert.ok(navigation.includes(`removeEventListener("${event}", cancelPosterNavigationMotion)`));
  }
  assert.doesNotMatch(navigation.slice(navigation.indexOf('return () =>')),/cancelPosterNavigationMotion\(\)/u);
  assert.match(css,/\.site-header:not\(\[data-menu-ready="true"\]\) > \.primary-nav \{ grid-column: 1 \/ -1; \}/u);
});
function setup(options={}) {
  const style=()=>({removeProperty(){delete this.viewTransitionName;}});
  const source={style:style(),complete:true,naturalWidth:960};
  const destination={style:style(),complete:true,naturalWidth:960,isConnected:true,decode:options.decode ?? (()=>Promise.resolve())};
  const information={style:style()};
  const detail={dataset:{eventDetailSlug:'example'},querySelector:s=>s.includes('img')?destination:information};
  const location={origin:'https://example.com',pathname:'/'};
  const timers=new Map(); let nextTimer=0;
  const window={__VINEXT_RSC_NAVIGATE__:()=>{},scrollTo:()=>{},setTimeout:(fn,ms)=>{timers.set(++nextTimer,{fn,ms});return nextTimer;},clearTimeout:id=>timers.delete(id)};
  const transitions=[];const calls=[];
  const document={documentElement:{dataset:{navigationMotionReady:'true'}},querySelector:()=>detail,startViewTransition:update=>{
    if(options.throwStart)throw Error('Unavailable');
    const ready=deferred(),finished=deferred();
    const transition={ready:ready.promise,finished:finished.promise,skipTransition(){this.skipped=true;ready.reject(Error('skipped'));},finish(){finished.resolve();}};
    transitions.push(transition);
    Promise.resolve().then(update).then(()=>ready.resolve(),error=>{ready.reject(error);finished.reject(error);});return transition;
  }};
  const link={href:'https://example.com/events/example',target:'',hasAttribute:name=>name==='download'&&!!options.download,querySelector:()=>source};
  const exports={};
  let observer;
  class MutationObserver { constructor(callback){this.state={callback,disconnected:false};observer=this.state;} observe(){} disconnect(){this.state.disconnected=true;} }
  vm.runInNewContext(code,{exports,URL,document,location,window,MutationObserver,matchMedia:()=>({matches:!!options.reduce}),require:name=>name.includes('vinext')?{navigateClientSide:async(...args)=>{calls.push(args);await options.navigation?.();location.pathname='/events/example';if(!observer.disconnected)observer.callback();if(options.paintPending)await options.paintPending;}}:{PUBLIC_ARTWORK_MOTION_ENABLED:true}});
  return {api:exports,link,document,window,source,destination,information,timers,transitions,calls,location};
}
test('only internal event-detail URLs qualify',()=>{
  const {api}=setup();
  assert.equal(api.eventPosterPath('/events/example?source=home','https://example.com'),'/events/example');
  for(const path of ['/events','/events/','/calendar','/contact','/events/example#rsvp','https://meetup.com/events/123','/events/a/nested','javascript:alert(1)']) assert.equal(api.eventPosterPath(path,'https://example.com'),null,path);
});
test('unsupported, reduced, download, new-tab, unloaded and absent-router cases preserve ordinary links',()=>{
  for(const change of [h=>delete h.document.startViewTransition,h=>delete h.document.documentElement.dataset.navigationMotionReady,h=>delete h.window.__VINEXT_RSC_NAVIGATE__,h=>h.link.target='_blank',h=>h.source.complete=false,h=>h.source.naturalWidth=0]){
    const h=setup();change(h);assert.equal(h.api.openConnectedPoster(h.link),false);assert.equal(h.calls.length,0);
  }
  for(const options of [{reduce:true},{download:true},{throwStart:true}]){
    const h=setup(options);assert.equal(h.api.openConnectedPoster(h.link),false);assert.equal(h.document.documentElement.dataset.posterNavigation,undefined);
  }
});
test('one navigation commits and decodes before connecting destination; completion cleans up',async()=>{
  const navigation=deferred(),decode=deferred();const h=setup({navigation:()=>navigation.promise,decode:()=>decode.promise,paintPending:new Promise(()=>{})});
  assert.equal(h.api.openConnectedPoster(h.link),true);assert.equal(h.source.style.viewTransitionName,'event-poster');
  await tick();assert.equal(h.calls.length,1);assert.equal(h.destination.style.viewTransitionName,undefined);
  navigation.resolve();await tick();assert.equal(h.destination.style.viewTransitionName,undefined);
  decode.resolve();await tick();assert.equal(h.destination.style.viewTransitionName,'event-poster');assert.equal(h.information.style.viewTransitionName,'event-information');
  assert.equal([...h.timers.values()].some(t=>t.ms===1200),false,'navigation deadline is cleared once snapshots are ready');
  h.transitions[0].finish();await tick();assert.equal(h.destination.style.viewTransitionName,undefined);assert.deepEqual(h.document.documentElement.dataset,{navigationMotionReady:'true'});
});
test('slow or failed artwork skips motion but keeps the single destination navigation',async()=>{
  for(const decode of [()=>Promise.reject(Error('broken image')),()=>new Promise(()=>{})]){
    const h=setup({decode});h.api.openConnectedPoster(h.link);await tick();
    for(const timer of h.timers.values())if(timer.ms===180)timer.fn();await tick();
    assert.equal(h.transitions[0].skipped,true);assert.equal(h.calls.length,1);assert.equal(h.location.pathname,'/events/example');
    h.transitions[0].finish();await tick();assert.deepEqual(h.document.documentElement.dataset,{navigationMotionReady:'true'});
  }
});
test('slow routes release the snapshot without a second history push',async()=>{
  const navigation=deferred();const h=setup({navigation:()=>navigation.promise});h.api.openConnectedPoster(h.link);await tick();
  for(const timer of h.timers.values())if(timer.ms===1200)timer.fn();
  assert.equal(h.transitions[0].skipped,true);assert.deepEqual(h.document.documentElement.dataset,{navigationMotionReady:'true'});
  navigation.resolve();await tick();assert.equal(h.calls.length,1);assert.equal(h.destination.style.viewTransitionName,undefined);h.transitions[0].finish();
  assert.equal(h.calls[0][2],true,'the router must restore destination scroll even when the visual deadline expires');
});
test('Back/new navigation cancellation and an old completion cannot clear a newer transition',async()=>{
  const h=setup();h.api.openConnectedPoster(h.link);await tick();h.api.cancelPosterNavigationMotion();assert.equal(h.transitions[0].skipped,true);
  h.api.openConnectedPoster(h.link);await tick();h.transitions[0].finish();await tick();
  assert.equal(h.document.documentElement.dataset.posterNavigation,'active');assert.equal(h.destination.style.viewTransitionName,'event-poster');
  h.api.cancelPosterNavigationMotion();h.transitions[1].finish();await tick();assert.deepEqual(h.document.documentElement.dataset,{navigationMotionReady:'true'});
});
