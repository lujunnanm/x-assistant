import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const scripts = ['task-utils.js', 'action-client.js', 'reply-engine.js'].map(name => readFileSync(new URL('../' + name, import.meta.url), 'utf8'));

// VM-only transaction: no browser, network or actual X submission.
function fixture(options = {}) {
  const state = {now:1000, account:'/owner', dialogs:[], opens:0, sends:0, cancels:0,
    patches:[], receipts:0, closes:0, polls:0, confirmations:[], matching:true,
    editorText:options.draft || '', buttonCount:1, events:[], ...options.state};
  class Clock extends Date { static now() { return state.now; } }
  class Transfer {
    constructor() { this.values = new Map(); }
    setData(type, text) { this.values.set(type, text); }
    getData(type) { return this.values.get(type) || ''; }
  }
  class Clipboard { constructor(type, properties) { this.type = type; Object.assign(this, properties); } }
  const editor = {
    get innerText() { return state.editorText; },
    focus() {context.document.activeElement=editor;},
    dispatchEvent(event) { state.editorText = event.clipboardData.getData('text/plain'); state.filledAt=state.now; },
  };
  const sendButton = {disabled:false, getAttribute:()=>null,
    click() { state.sends++; state.events.push('click'); options.onClick?.(state); }};
  const dialog = {
    isConnected:true,
    querySelector: selector => selector.includes('tweetTextarea_0') ? editor : null,
    querySelectorAll: selector => selector.includes('tweetButton') ? Array(state.buttonCount).fill(sendButton) : [],
  };
  const ack={textContent:'知道了',getAttribute:()=>null,click(){state.acknowledged=(state.acknowledged||0)+1;blockedDialog.isConnected=false;state.dialogs=[];}};
  const blockedDialog={isConnected:true,textContent:'你为什么无法回复它？这个作者屏蔽了你，因此你无法执行此操作',querySelector:()=>null,querySelectorAll:selector=>selector.includes('button')?[ack]:[]};
  const openButton = {disabled:false, click() { state.opens++; options.onOpen?.(state); state.now+=options.openDelay||0; state.dialogs=options.standalone?[]:[options.authorBlocked?blockedDialog:dialog]; }};
  const current = {id:'123', author:'Writer', time:'2026-11-02T12:00:00.000Z', text:'original',
    article:{isConnected:true, querySelectorAll:()=>[openButton]}};
  const row = {...current, article:{isConnected:false, querySelectorAll(){throw Error('Detached row accessed');}}};
  if (options.popup) state.dialogs = [dialog];
  const context = vm.createContext({Date:Clock, Error, DOMException, DataTransfer:Transfer,
    XAssistantWorkspace:options.workspace,
    ClipboardEvent:Clipboard, setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver:class {},
    document:{hidden:!!options.hidden,execCommand(_command, _show, text) { state.editorText=text; }},
    XAssistantRuntime:{check:signal=>{if(signal?.aborted)throw new DOMException('stopped','AbortError');options.workspace?.check?.(signal);},call:async message=>{if(message.kind==='ACTION_ACQUIRE')return options.actionAcquire?.(state)??{granted:true,leaseId:'lease',expiresAt:state.now+10000};if(message.kind==='ACTION_SETTLE'){state.actionSettles??=[];state.actionSettles.push(message);if(options.ackFailure&&message.outcome==='attempted')throw Error('ACK lost');return {};}state.claimCalls??=[];state.claimCalls.push(message);return message.kind==='REPLY_CLAIM'?{claimed:options.claimed!==false,claimId:'claim'}:{};},sleep:async ms => { state.now+=ms; options.onSleep?.(state); }},
    XAssistantCore:{editorText:element => String(element.innerText || '').trim()},
    XAssistantDOM:{
      account:()=>state.account,
      dialogs:()=>state.dialogs,
      replyEditor:scope=>scope?.querySelector('[data-testid="tweetTextarea_0"]')||null,
      detailReply:(_row,diag)=>diag?{reason:state.matching?'ready':'not_adjacent'}:state.matching?{dialog,editor,button:sendButton,article:current.article,editedDetail:!!options.editedDetail}:null,
      standaloneReply:()=>options.standalone&&state.matching?{dialog,editor,standalone:true}:null,
      relocate(received, account, required) {
        state.relocateArgs={row:received,account,required};
        return options.missingTarget ? null : current;
      },
      matches:()=>state.matching,
    },
    XAssistantPopup:{cancel:async()=>{
      state.cancels++;
      if (options.cleanupFails) return false;
      state.dialogs=[];
      state.editorText='';
      return true;
    }},
    XAssistantPostingReceipt:{create(args) {
      state.receipts++;
      state.receiptArgs=args;
      state.events.push('observe');
      options.onReceipt?.(state);
      return {
        poll() { state.polls++; return options.receipt === undefined ? {kind:'confirmed',postId:'456'} : options.receipt; },
        close() { state.closes++; },
      };
    }},
  });
  scripts.forEach(script => vm.runInContext(script, context));
  const send = (overrides={}) => context.XAssistantReplyEngine.send({
    row, text:'A reply', account:'/OWNER',module:'interaction',runId:'run',
    patch:async value => { state.patches.push(value); options.onPatch?.(value,state); },
    onBeforeSubmit:async()=>options.beforeSubmit?.(state),
    onConfirmed:async result=>state.confirmations.push(result),
    ...overrides,
  });
  return {state, row, current, send};
}

test('shared reply transaction relocates exact row, observes before click and confirms once', async () => {
  const f=fixture();
  const result=await f.send({requireAddressed:true});
  assert.equal(result.kind,'confirmed');
  assert.equal(f.state.relocateArgs.row,f.row);
  assert.equal(f.state.relocateArgs.account,'/owner');
  assert.equal(f.state.relocateArgs.required,true);
  assert.equal(f.state.opens,1);
  assert.equal(f.state.sends,1);
  assert.deepEqual(f.state.events,['observe','click']);
  assert.deepEqual(f.state.patches.map(p=>p.phase),['submitting','confirmed']);
  assert.equal(f.state.confirmations.length,1);
  assert.equal(f.state.receiptArgs.text,'A reply');
  assert.equal(f.state.closes,1);
  assert.equal(f.state.cancels,0);
  assert.ok(f.state.now>=2000);
});

test('reply composer stays open at least one second before the send click',async()=>{
 let clickedAt=0;const f=fixture({onClick:state=>{clickedAt=state.now;}});
 await f.send();assert.ok(clickedAt>=2000);assert.equal(f.state.sends,1);
});

test('preexisting popup is preserved and no reply opens', async () => {
  const f=fixture({popup:true});
  await assert.rejects(f.send(), e=>e.code==='RESIDUAL_POPUP' && !e.submitted);
  assert.equal(f.state.opens,0);
  assert.equal(f.state.sends,0);
  assert.equal(f.state.cancels,0);
  assert.equal(f.state.dialogs.length,1);
  assert.deepEqual(f.state.patches.map(p=>p.phase),['waiting']);
});

test('a restored draft is preserved without retry, overwrite or send',async()=>{
 const f=fixture({draft:'old draft'});
 await assert.rejects(f.send(),e=>e.code==='RESIDUAL_DRAFT'&&e.preserveDrafts&&!e.submitted);
 assert.equal(f.state.opens,1);assert.equal(f.state.sends,0);assert.equal(f.state.cancels,0);assert.equal(f.state.editorText,'old draft');
});
test('a new user edit after filling is preserved on final validation failure',async()=>{
 const f=fixture({beforeSubmit:s=>s.editorText='new user edit'});
 await assert.rejects(f.send(),e=>e.code==='EDITOR_READBACK'&&e.preserveDrafts&&!e.submitted);
 assert.equal(f.state.sends,0);assert.equal(f.state.cancels,0);assert.equal(f.state.editorText,'new user edit');
});

test('author-blocked reply notice is acknowledged and the post is skipped without stopping',async()=>{
 const f=fixture({authorBlocked:true});
 await assert.rejects(f.send(),e=>e.code==='AUTHOR_BLOCKED'&&!e.submitted);
 assert.equal(f.state.acknowledged,1);assert.equal(f.state.sends,0);assert.equal(f.state.cancels,0);
 assert.deepEqual(f.state.patches.map(p=>p.phase),['waiting']);
});

test('failed popup cancellation is explicit and retains original failure', async () => {
  const f=fixture({cleanupFails:true,state:{buttonCount:0}});
  await assert.rejects(f.send(), e=>e.code==='CLEANUP_FAILED' && e.cause.code==='SEND_BUTTON' && !e.submitted);
  assert.equal(f.state.sends,0);
  assert.equal(f.state.patches.length,0);
});

test('updated target is skipped without touching its detached original article', async () => {
  const f=fixture({missingTarget:true});
  await assert.rejects(f.send(), e=>e.code==='TARGET_UPDATED' && !e.submitted);
  assert.equal(f.state.opens,0);
  assert.equal(f.state.sends,0);
});

test('wrong reply context is never sent or discarded', async () => {
  const f=fixture({state:{matching:false}});
  await assert.rejects(f.send(), e=>e.code==='TARGET_MISMATCH' && !e.submitted);
  assert.equal(f.state.sends,0);
  assert.equal(f.state.cancels,0);
});

test('unknown receipt after a single click is never retried or cleaned up', async () => {
  for (const receipt of [null,{kind:'unknown',message:'No receipt'}]) {
    const f=fixture({receipt});
    await assert.rejects(f.send(), e=>e.code==='SEND_UNKNOWN' && e.submitted && !e.confirmed);
    assert.equal(f.state.sends,1);
    assert.equal(f.state.receipts,1);
    assert.equal(f.state.closes,1);
    assert.equal(f.state.cancels,0);
    assert.equal(f.state.dialogs.length,1);
    assert.deepEqual(f.state.patches.map(p=>p.phase),['submitting']);
  }
});

test('stop after click still confirms the submitted reply without another action', async () => {
  const controller=new AbortController();
  const f=fixture({onClick:()=>controller.abort()});
  assert.equal((await f.send({signal:controller.signal})).kind,'confirmed');
  assert.equal(f.state.sends,1);assert.equal(f.state.cancels,0);assert.equal(f.state.closes,1);
  assert.equal(f.state.confirmations.length,1);assert.equal(f.state.claimCalls.at(-1).outcome,'confirmed');
});
test('stop after click with no receipt preserves uncertainty after a bounded readback',async()=>{
 const controller=new AbortController();const f=fixture({receipt:null,onClick:()=>controller.abort()});
 await assert.rejects(f.send({signal:controller.signal}),e=>e.code==='SEND_UNKNOWN'&&e.submitted&&!e.confirmed);
 assert.equal(f.state.sends,1);assert.equal(f.state.cancels,0);assert.equal(f.state.claimCalls.at(-1).outcome,'unknown');
 assert.ok(f.state.now<20000,'receipt readback is bounded to fifteen seconds');
});

test('expired work deadline blocks opening a reply', async () => {
  const f=fixture();
  await assert.rejects(f.send({deadline:1000}), e=>e.code==='YIELD' && !e.submitted);
  assert.equal(f.state.opens,0);
  assert.equal(f.state.sends,0);
});

test('deadline or account changing during pre-submit persistence blocks click', async () => {
  for (const [code,mutate] of [
    ['YIELD',state=>state.now=5000],
    ['ACCOUNT_CHANGED',state=>state.account='/someone_else'],
  ]) {
    const f=fixture({beforeSubmit:mutate});
    await assert.rejects(f.send({deadline:5000}), e=>e.code===code && !e.submitted);
    assert.equal(f.state.sends,0);
    assert.equal(f.state.cancels,1);
    assert.deepEqual(f.state.patches.map(p=>p.phase),['submitting','waiting']);
  }
});

test('receipt confirmation is allowed to finish after work-window deadline', async () => {
  const f=fixture({onClick:state=>state.now=6000});
  assert.equal((await f.send({deadline:5000})).kind,'confirmed');
  assert.equal(f.state.sends,1);
});

test('confirmed send stays confirmed if its persistence callback subsequently fails', async () => {
  const f=fixture();
  await assert.rejects(f.send({onConfirmed:async()=>{throw Error('storage unavailable');}}),
    e=>e.message==='storage unavailable' && e.submitted && e.confirmed);
  assert.equal(f.state.sends,1);
  assert.equal(f.state.cancels,0);
  assert.equal(f.state.closes,1);
});

test('target update during asynchronous pre-submit hook must block final click', async () => {
  const f=fixture({beforeSubmit:state=>state.matching=false});
  await assert.rejects(f.send(), e=>e.code==='TARGET_MISMATCH' && !e.submitted);
  assert.equal(f.state.sends,0);
  assert.equal(f.state.cancels,0);
});

test('editor mutation during asynchronous pre-submit hook must block final click', async () => {
  const f=fixture({beforeSubmit:state=>state.editorText='unexpected text'});
  await assert.rejects(f.send(), e=>e.code==='EDITOR_READBACK' && !e.submitted);
  assert.equal(f.state.sends,0);
  assert.equal(f.state.cancels,0);
});

test('missing or duplicate send buttons after asynchronous persistence never click', async () => {
  for (const buttonCount of [0,2]) {
    const f=fixture({beforeSubmit:state=>state.buttonCount=buttonCount});
    await assert.rejects(f.send(), e=>e.code==='SEND_BUTTON' && !e.submitted);
    assert.equal(f.state.sends,0);
    assert.equal(f.state.cancels,1);
  }
});


test('slow composer opening cannot consume the one-second filled-text delay',async()=>{
 const f=fixture({openDelay:1800,onClick:s=>{s.clickedAt=s.now;}});
 await f.send();
 assert.ok(f.state.clickedAt-f.state.filledAt>=1000);
 assert.equal(f.state.sends,1);
});

test('stop during the filled-text delay prevents sending',async()=>{
 const controller=new AbortController();
 const f=fixture({onSleep:s=>{if(s.now>=2200)controller.abort();}});
 await assert.rejects(f.send({signal:controller.signal}),e=>e.name==='AbortError'&&!e.submitted);
 assert.equal(f.state.sends,0);
});


test('transient previous-composer text can clear naturally before insertion',async()=>{
 const f=fixture({draft:'previous composer',onSleep:s=>{if(!s.filledAt)s.editorText='';}});
 await f.send();assert.equal(f.state.sends,1);assert.equal(f.state.cancels,0);
});

test('shared claim conflict opens no composer and never replaces another module record',async()=>{
 const f=fixture({claimed:false});await assert.rejects(f.send(),e=>e.code==='REPLY_ALREADY_CLAIMED');
 assert.equal(f.state.opens,0);assert.equal(f.state.sends,0);assert.equal(f.state.claimCalls.length,1);
});
test('shared claim settlement mirrors confirmed and unknown platform outcomes',async()=>{
 const confirmed=fixture();await confirmed.send();assert.equal(confirmed.state.claimCalls.at(-1).outcome,'confirmed');assert.equal(confirmed.state.claimCalls.at(-1).receipt.kind,'confirmed');
 const uncertain=fixture({receipt:null});await assert.rejects(uncertain.send());assert.equal(uncertain.state.claimCalls.at(-1).outcome,'unknown');
 const unsent=fixture({missingTarget:true});await assert.rejects(unsent.send());assert.equal(unsent.state.claimCalls.at(-1).outcome,'released');
});
test('manual navigation after reservation never cancels a draft on the new page',async()=>{
 let samePage=true;
 const f=fixture({workspace:{check:()=>{if(!samePage)throw Object.assign(Error('navigated'),{code:'PAGE_CHANGED'});},canCleanComposer:()=>samePage,beginComposer:()=>()=>{}},beforeSubmit:()=>{samePage=false;}});
 await assert.rejects(f.send(),e=>e.code==='PAGE_CHANGED'&&!e.submitted);
 assert.equal(f.state.sends,0);assert.equal(f.state.cancels,0);assert.equal(f.state.claimCalls.at(-1).outcome,'released');
});

test('midnight before a reply click is rejected by the workspace guard',async()=>{
 let working=true;
 const f=fixture({workspace:{check:()=>{if(!working)throw Object.assign(Error('outside operating window'),{code:'OUTSIDE_WINDOW'});},canCleanComposer:()=>true,beginComposer:()=>()=>{}},beforeSubmit:()=>{working=false;}});
 await assert.rejects(f.send(),error=>error.code==='OUTSIDE_WINDOW'&&!error.submitted);
 assert.equal(f.state.sends,0);assert.equal(f.state.patches.at(-1).phase,'waiting');assert.equal(f.state.claimCalls.at(-1).outcome,'released');
});
test('midnight and signal cancellation after a reply click only stop new actions',async()=>{
 let working=true;const controller=new AbortController();
 const f=fixture({workspace:{check:()=>{if(!working)throw Object.assign(Error('outside operating window'),{code:'OUTSIDE_WINDOW'});},canCleanComposer:()=>true,beginComposer:()=>()=>{}},onClick:()=>{working=false;controller.abort();}});
 assert.equal((await f.send({signal:controller.signal})).kind,'confirmed');
 assert.equal(f.state.sends,1);assert.equal(f.state.cancels,0);assert.equal(f.state.claimCalls.at(-1).outcome,'confirmed');
});
test('reply observer setup crossing midnight cannot permit the final click',async()=>{
 let working=true;
 const f=fixture({workspace:{check:()=>{if(!working)throw Object.assign(Error('outside operating window'),{code:'OUTSIDE_WINDOW'});},canCleanComposer:()=>true,beginComposer:()=>()=>{}},onReceipt:()=>{working=false;}});
 await assert.rejects(f.send(),error=>error.code==='OUTSIDE_WINDOW'&&!error.submitted);
 assert.equal(f.state.sends,0);assert.equal(f.state.closes,1);assert.equal(f.state.claimCalls.at(-1).outcome,'released');
});

test('reply waits for pacing without premature submitting evidence or a stale receipt observer',async()=>{
 let calls=0;
 const f=fixture({actionAcquire:state=>{
  calls++;assert.equal(state.patches.some(p=>p.phase==='submitting'),false);assert.equal(state.receipts,0);
  return calls===1?{granted:false,retryAt:state.now+23000}:{granted:true,leaseId:'reply-lease',expiresAt:state.now+10000};
 }});
 await f.send();assert.equal(calls,2);assert.equal(f.state.sends,1);
});
test('lost action ACK does not erase a confirmed reply or lead to a second click',async()=>{
 const f=fixture({ackFailure:true});await f.send();assert.equal(f.state.sends,1);assert.equal(f.state.patches.at(-1).phase,'confirmed');
});
test('lost action ACK without receipt stays unknown and never retries the reply',async()=>{
 const f=fixture({ackFailure:true,receipt:null});await assert.rejects(f.send(),error=>error.code==='SEND_UNKNOWN'&&error.submitted===true);
 assert.equal(f.state.sends,1);assert.equal(f.state.claimCalls.at(-1).outcome,'unknown');
});

test('owned standalone reply composer is used only when it remains bound to the target',async()=>{
 const ok=fixture({standalone:true});await ok.send();assert.equal(ok.state.sends,1);
 const swap=fixture({standalone:true,beforeSubmit:s=>s.matching=false});
 await assert.rejects(swap.send(),e=>e.code==='TARGET_MISMATCH'&&!e.submitted);assert.equal(swap.state.sends,0);
 const other=fixture({standalone:true,state:{matching:false}});
 await assert.rejects(other.send(),e=>e.code==='EDITOR_NOT_READY'&&!e.submitted);assert.equal(other.state.filledAt,undefined);assert.equal(other.state.sends,0);
});
test('released composer grants carry confirmed or unknown receipts, without authorizing retries',async()=>{
 for(const [receipt,submitted,confirmed] of [[null,true,false],[{kind:'confirmed'},true,true]]){
  let record;const f=fixture({receipt,workspace:{check(){},beginComposer:()=>outcome=>record=outcome}});
  if(confirmed)await f.send();else await assert.rejects(f.send(),{code:'SEND_UNKNOWN'});
  assert.equal(record.submitted,submitted);assert.equal(record.confirmed,confirmed);
 }
});
test('managed hidden status inline sends once without the modal, workspace activation or composer route lease',async()=>{
 const workspace={check(){},state:()=>({assignment:{module:'interaction'}}),beginComposer(){throw Error('must not grant modal route');}};
 const f=fixture({workspace,hidden:true});assert.equal((await f.send({detailInline:true})).kind,'confirmed');assert.equal(f.state.opens,0);assert.equal(f.state.sends,1);assert.equal(f.state.cancels,0);
 const legacy=fixture({workspace,hidden:true});await assert.rejects(legacy.send(),e=>e.code==='INLINE_ROUTE_REQUIRED');assert.equal(legacy.state.opens,0);
});
test('missing or changed detail binding fails without any modal fallback; a protected inline draft or unknown send stays untouched',async()=>{
 const bad=fixture({state:{matching:false}});await assert.rejects(bad.send({detailInline:true}),e=>e.code==='INLINE_EDITOR_NOT_READY'&&/not_adjacent/.test(e.message));assert.equal(bad.state.opens,0);assert.equal(bad.state.filledAt,undefined);
 const swap=fixture({beforeSubmit:s=>s.matching=false});await assert.rejects(swap.send({detailInline:true}),e=>e.code==='TARGET_MISMATCH'&&e.preserveDrafts);assert.equal(swap.state.sends,0);assert.equal(swap.state.cancels,0);
 const draft=fixture({draft:'unsent'});await assert.rejects(draft.send({detailInline:true}),e=>e.code==='RESIDUAL_DRAFT'&&e.preserveDrafts);assert.equal(draft.state.editorText,'unsent');assert.equal(draft.state.opens,0);assert.equal(draft.state.sends,0);
 const unknown=fixture({receipt:null});await assert.rejects(unknown.send({detailInline:true}),e=>e.code==='SEND_UNKNOWN'&&e.submitted&&e.preserveDrafts);assert.equal(unknown.state.sends,1);assert.equal(unknown.state.opens,0);assert.equal(unknown.state.cancels,0);assert.equal(unknown.state.claimCalls.at(-1).outcome,'unknown');
});

test('detail navigation occurs only after an acquired cross-module claim',async()=>{
 let visits=0;const f=fixture({claimed:false});
 await assert.rejects(f.send({detailInline:true,prepareTarget:async()=>{visits++;}}),{code:'REPLY_ALREADY_CLAIMED'});assert.equal(visits,0);
 const ok=fixture();await ok.send({detailInline:true,prepareTarget:async()=>{assert.equal(ok.state.claimCalls[0].kind,'REPLY_CLAIM');visits++;}});assert.equal(visits,1);
});

test('only an exact history-only detail can pass inline rebind without a list permalink',async()=>{
 const ok=fixture({missingTarget:true,editedDetail:true,state:{matching:false}});
 assert.equal((await ok.send({detailInline:true,prepareTarget:async()=>{
  assert.equal(ok.state.claimCalls[0].kind,'REPLY_CLAIM');ok.state.matching=true;
 }})).kind,'confirmed');assert.equal(ok.state.sends,1);assert.equal(ok.state.opens,0);
 const swapped=fixture({missingTarget:true,editedDetail:true});
 await assert.rejects(swapped.send({detailInline:true,prepareTarget:async()=>{swapped.state.account='/different';}}),{code:'ACCOUNT_CHANGED'});
 assert.equal(swapped.state.sends,0);assert.equal(swapped.state.filledAt,undefined);
 for(const [opts,mode] of [[{editedDetail:false},{detailInline:true}],[{editedDetail:true},{detailInline:true,requireAddressed:true}],[{editedDetail:true},{detailInline:false}],[{editedDetail:true,state:{matching:false}},{detailInline:true}]]){
  const f=fixture({...opts,missingTarget:true});await assert.rejects(f.send(mode),{code:'TARGET_UPDATED'});
  assert.equal(f.state.sends,0);assert.equal(f.state.opens,0);assert.equal(f.state.filledAt,undefined);
 }
});
