import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../posting.js',import.meta.url),'utf8');
const publishSource=source.slice(source.indexOf(' async function publish('),source.indexOf(' const renderRemote='));
const stopSource=source.slice(source.indexOf(' async function stopLoop('),source.indexOf(' async function countdown('));

function fixture({onReserve,receipt={kind:'confirmed'},image=false}={}) {
  const state={account:'/owner',text:'',attachment:null,buttonCount:1,editorCount:1,context:false,
    clicks:0,closed:0,phase:'waiting',phases:[],events:[],active:true};
  const controller=new AbortController();
  const editor={isConnected:true,get innerText(){return state.text;},scrollIntoView(){},focus(){},
    dispatchEvent(event){if(event.clipboardData)state.text=event.clipboardData.text;}};
  const button={isConnected:true,disabled:false,getAttribute:()=>null,click(){state.clicks++;state.events.push('click');}};
  const dialog={isConnected:true,contains:node=>node===editor||node===button,
    querySelector:selector=>selector.includes('tweetText')?(state.context?{}:null):selector.includes('attachments')?state.attachment:null,
    querySelectorAll:selector=>selector.includes('tweetTextarea_0')?Array(state.editorCount).fill(editor):selector.includes('tweetButton')?Array(state.buttonCount).fill(button):[]};
  class Transfer {setData(_type,text){this.text=text;}}
  const context=vm.createContext({Date,Error,DOMException,DataTransfer:Transfer,
    ClipboardEvent:class{constructor(_type,data){Object.assign(this,data);}},MutationObserver:class{},setInterval,clearInterval,
    document:{querySelectorAll:()=>[dialog],querySelector:()=>({getAttribute:()=>state.account})},
    core:{editorText:element=>element?.innerText||''},
    check:signal=>{if(signal.aborted)throw new DOMException('stopped','AbortError');},
    patch:async patch=>{
      if(!state.active)throw Error('inactive runtime');
      state.phase=patch.phase;state.phases.push(patch.phase);state.events.push('patch:'+patch.phase);
      if(patch.phase==='submitting')await onReserve?.({state,editor,button,dialog,controller});
    },
    wait:async(fn,_signal,label)=>{const value=fn();if(!value)throw Error(label+'超时');return value;},
    sleep:async()=>{},show:()=>{},progress:()=>{},visible:()=>true,
    hasAttachment:()=>!!state.attachment,attachmentSelector:'[data-testid="attachments"]',
    uploadImage:async()=>{state.attachment={isConnected:true};},
    read:async()=>({active:state.active,account:'/owner',runId:'run',completed:0}),clickNative:element=>element.click(),
    XAssistantPostingReceipt:{create:()=>({poll:()=>receipt,close(){state.closed++;}})},
    control:controller,preSubmitTask:null,timer:null,start:{},stop:{},runPromise:Promise.resolve(),
    api:{runtime:async(_module,action)=>{if(action==='stop'){state.events.push('stop');state.active=false;}}},
  });
  vm.runInContext(publishSource+stopSource+';globalThis.send=publish;globalThis.stopNow=stopLoop;',context);
  const send=()=>{
    const promise=context.send({id:'post_1',text:'expected',...(image?{image:'post-images/test.jpg'}:{})},controller.signal,'run');
    context.runPromise=promise.catch(()=>{});
    return promise;
  };
  return {state,send,stop:()=>context.stopNow()};
}

test('original post observes and confirms one submission with unchanged composer',async()=>{
  const f=fixture();await f.send();
  assert.equal(f.state.clicks,1);assert.equal(f.state.closed,1);
  assert.deepEqual(f.state.phases,['opening','filling','submitting','confirmed']);
});

test('account or text change during reservation cannot send and clears false submitting state',async()=>{
  for(const mutate of [({state})=>state.account='/other',({state})=>state.text='unexpected']) {
    const f=fixture({onReserve:mutate});
    await assert.rejects(f.send(),error=>/提交前/.test(error.message)&&error.submitted===false);
    assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
  }
});

test('detached or ambiguous editor and changed original-post context block final click',async()=>{
  for(const mutate of [({dialog})=>dialog.isConnected=false,({editor})=>editor.isConnected=false,
    ({state})=>state.editorCount=2,({state})=>state.context=true]) {
    const f=fixture({onReserve:mutate});
    await assert.rejects(f.send(),error=>error.submitted===false);
    assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
  }
});

test('unexpected attachment, removed image and replaced image are not submitted',async()=>{
  for(const [image,mutate] of [[false,({state})=>state.attachment={}],[true,({state})=>state.attachment=null],
    [true,({state})=>state.attachment={replacement:true}]]) {
    const f=fixture({image,onReserve:mutate});
    await assert.rejects(f.send(),/配图发生变化/);
    assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
  }
});

test('disabled, detached, missing or duplicate final submit button never clicks',async()=>{
  for(const mutate of [({button})=>button.disabled=true,({button})=>button.isConnected=false,
    ({state})=>state.buttonCount=0,({state})=>state.buttonCount=2]) {
    const f=fixture({onReserve:mutate});
    await assert.rejects(f.send(),/发帖按钮已变化/);
    assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
  }
});

test('aborting after reservation but before click restores waiting, not unknown',async()=>{
  const f=fixture({onReserve:({controller})=>controller.abort()});
  await assert.rejects(f.send(),error=>error.name==='AbortError'&&error.submitted===false);
  assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
});

test('reservation persistence error is safely reset before any public action',async()=>{
  const f=fixture({onReserve:()=>{throw Error('response lost after reservation');}});
  await assert.rejects(f.send(),/response lost/);
  assert.equal(f.state.clicks,0);assert.equal(f.state.phase,'waiting');
});

test('unknown receipt after click keeps submitting evidence and never retries',async()=>{
  const f=fixture({receipt:null});
  await assert.rejects(f.send(),error=>error.submitted===true);
  assert.equal(f.state.clicks,1);assert.equal(f.state.phase,'submitting');assert.equal(f.state.closed,1);
});

test('stop during reservation waits for proven-unsent reset before stopping runtime',async()=>{
  let release,entered;
  const reserved=new Promise(resolve=>entered=resolve);
  const f=fixture({onReserve:()=>{entered();return new Promise(resolve=>release=resolve);}});
  const sending=f.send();await reserved;
  const stopping=f.stop();
  assert.equal(f.state.active,true);
  release();
  await assert.rejects(sending,error=>error.name==='AbortError');await stopping;
  assert.equal(f.state.clicks,0);
  assert.equal(f.state.phase,'waiting');
  assert.deepEqual(f.state.events.slice(-2),['patch:waiting','stop']);
});
