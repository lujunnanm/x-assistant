import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../cleanup-core.js',import.meta.url),'utf8');
const context={};context.globalThis=context;vm.runInNewContext(source,context);
const core=context.XAssistantCleanupCore,now=Date.parse('2026-10-30T12:00:00Z');

test('view labels parse exact, localized and abbreviated values',()=>{
 assert.equal(core.parseViews('49 views. View post analytics'),49);
 assert.equal(core.parseViews('1.2K views. View post analytics'),1200);
 assert.equal(core.parseViews('3.4万 次查看'),34000);
 assert.equal(core.parseViews('no metric'),null);
});

test('cleanup requires own original post older than one day and below 50 views',()=>{
 const base={author:'me',postedAt:'2026-10-29T11:59:59Z',views:49,isPinned:false,isReply:false,isRepost:false,isArticle:false,isPromoted:false};
 assert.equal(core.eligible(base,{self:'me',now}),true);
 for(const patch of [{views:50},{postedAt:'2026-10-29T12:00:01Z'},{author:'other'},{isPinned:true},{isReply:true},{isRepost:true},{isArticle:true},{isPromoted:true},{views:null}])assert.equal(core.eligible({...base,...patch},{self:'me',now}),false);
});

test('deletion confirmation supports alertdialog and dialog, rejects unrelated or ambiguous prompts',()=>{
 const modal=title=>({querySelector:selector=>selector.includes('heading')?{textContent:title}:{}});
 const doc=dialogs=>({querySelectorAll:selector=>{assert.equal(selector,'[role="dialog"],[role="alertdialog"]');return dialogs;}});
 const chinese=modal('删除帖子？'),english=modal('Delete post?');
 assert.equal(core.deleteDialog(doc([chinese])),chinese);
 assert.equal(core.deleteDialog(doc([english])),english);
 assert.equal(core.deleteDialog(doc([modal('取消关注？')])),null);
 assert.equal(core.deleteDialog(doc([chinese,english])),null);
});
