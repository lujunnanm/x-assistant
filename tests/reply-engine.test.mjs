import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const scripts = ['task-utils.js', 'reply-engine.js'].map(name => readFileSync(new URL('../' + name, import.meta.url), 'utf8'));

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
    focus() {},
    dispatchEvent(event) { state.editorText = event.clipboardData.getData('text/plain'); },
  };
  const sendButton = {disabled:false, getAttribute:()=>null,
    click() { state.sends++; state.events.push('click'); options.onClick?.(state); }};
  const dialog = {
    querySelector: selector => selector.includes('tweetTextarea_0') ? editor : null,
    querySelectorAll: selector => selector.includes('tweetButton') ? Array(state.buttonCount).fill(sendButton) : [],
  };
  const openButton = {disabled:false, click() { state.opens++; state.dialogs=[dialog]; }};
  const current = {id:'123', author:'Writer', time:'2026-11-02T12:00:00.000Z', text:'original',
    article:{isConnected:true, querySelectorAll:()=>[openButton]}};
  const row = {...current, article:{isConnected:false, querySelectorAll(){throw Error('Detached row accessed');}}};
  if (options.popup) state.dialogs = [dialog];
  const context = vm.createContext({Date:Clock, Error, DOMException, DataTransfer:Transfer,
    ClipboardEvent:Clipboard, setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver:class {},
    document:{execCommand(_command, _show, text) { state.editorText=text; }},
    XAssistantRuntime:{sleep:async ms => { state.now+=ms; options.onSleep?.(state); }},
    XAssistantCore:{editorText:element => String(element.innerText || '').trim()},
    XAssistantDOM:{
      account:()=>state.account,
      dialogs:()=>state.dialogs,
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
      return {
        poll() { state.polls++; return options.receipt === undefined ? {kind:'confirmed',postId:'456'} : options.receipt; },
        close() { state.closes++; },
      };
    }},
  });
  scripts.forEach(script => vm.runInContext(script, context));
  const send = (overrides={}) => context.XAssistantReplyEngine.send({
    row, text:'A reply', account:'/OWNER',
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
});

test('existing popup is cancelled and task skipped without opening another reply', async () => {
  const f=fixture({popup:true});
  await assert.rejects(f.send(), e=>e.code==='RESIDUAL_POPUP' && !e.submitted);
  assert.equal(f.state.opens,0);
  assert.equal(f.state.sends,0);
  assert.equal(f.state.cancels,1);
  assert.equal(f.state.dialogs.length,0);
  assert.deepEqual(f.state.patches.map(p=>p.phase),['waiting']);
});

test('residual composer text is discarded without overwriting or sending it', async () => {
  const f=fixture({draft:'old draft'});
  await assert.rejects(f.send(), e=>e.code==='RESIDUAL_DRAFT' && !e.submitted);
  assert.equal(f.state.opens,1);
  assert.equal(f.state.sends,0);
  assert.equal(f.state.cancels,1);
  assert.equal(f.state.editorText,'');
});

test('failed popup cancellation is explicit and retains original failure', async () => {
  const f=fixture({popup:true,cleanupFails:true});
  await assert.rejects(f.send(), e=>e.code==='CLEANUP_FAILED' && e.cause.code==='RESIDUAL_POPUP' && !e.submitted);
  assert.equal(f.state.sends,0);
  assert.equal(f.state.patches.length,0);
});

test('updated target is skipped without touching its detached original article', async () => {
  const f=fixture({missingTarget:true});
  await assert.rejects(f.send(), e=>e.code==='TARGET_UPDATED' && !e.submitted);
  assert.equal(f.state.opens,0);
  assert.equal(f.state.sends,0);
});

test('wrong reply context never sends and cancels the opened composer', async () => {
  const f=fixture({state:{matching:false}});
  await assert.rejects(f.send(), e=>e.code==='TARGET_MISMATCH' && !e.submitted);
  assert.equal(f.state.sends,0);
  assert.equal(f.state.cancels,1);
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

test('aborting after click leaves submitted uncertainty intact without retry or discard', async () => {
  const controller=new AbortController();
  const f=fixture({onClick:()=>controller.abort()});
  await assert.rejects(f.send({signal:controller.signal}), e=>e.name==='AbortError' && e.submitted && !e.confirmed);
  assert.equal(f.state.sends,1);
  assert.equal(f.state.cancels,0);
  assert.equal(f.state.closes,1);
  assert.equal(f.state.confirmations.length,0);
});

test('expired work deadline blocks opening a reply', async () => {
  const f=fixture();
  await assert.rejects(f.send({deadline:1000}), e=>e.code==='YIELD' && !e.submitted);
  assert.equal(f.state.opens,0);
  assert.equal(f.state.sends,0);
});

test('deadline or account changing during pre-submit persistence blocks click', async () => {
  for (const [code,mutate] of [
    ['YIELD',state=>state.now=2000],
    ['ACCOUNT_CHANGED',state=>state.account='/someone_else'],
  ]) {
    const f=fixture({beforeSubmit:mutate});
    await assert.rejects(f.send({deadline:2000}), e=>e.code===code && !e.submitted);
    assert.equal(f.state.sends,0);
    assert.equal(f.state.cancels,1);
    assert.deepEqual(f.state.patches.map(p=>p.phase),['submitting','waiting']);
  }
});

test('receipt confirmation is allowed to finish after work-window deadline', async () => {
  const f=fixture({onClick:state=>state.now=5000});
  assert.equal((await f.send({deadline:2000})).kind,'confirmed');
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
  assert.equal(f.state.cancels,1);
});

test('editor mutation during asynchronous pre-submit hook must block final click', async () => {
  const f=fixture({beforeSubmit:state=>state.editorText='unexpected text'});
  await assert.rejects(f.send(), e=>e.code==='EDITOR_READBACK' && !e.submitted);
  assert.equal(f.state.sends,0);
  assert.equal(f.state.cancels,1);
});

test('missing or duplicate send buttons after asynchronous persistence never click', async () => {
  for (const buttonCount of [0,2]) {
    const f=fixture({beforeSubmit:state=>state.buttonCount=buttonCount});
    await assert.rejects(f.send(), e=>e.code==='SEND_BUTTON' && !e.submitted);
    assert.equal(f.state.sends,0);
    assert.equal(f.state.cancels,1);
  }
});
