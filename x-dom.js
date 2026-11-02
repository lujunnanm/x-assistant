// Site markup lives here, not in scheduling or retry policy.
(() => {
  const normalize = value => String(value || '').replace(/(?:(?:https?:\/\/)?pic\.x\.com\/[A-Za-z0-9]+\s*)+$/,'').replace(/\s+/g,' ').trim();
  const account = () => document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.toLowerCase();
  const dialogs = () => [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(d => !d.querySelector('[role="dialog"],[role="alertdialog"]'));
  function post(article, owner = account()) {
    const time = article.querySelector('time');
    const link = time?.closest('a');
    const match = link?.getAttribute('href')?.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/);
    if (!match) return null;
    const author=match[1], id=match[2], text=article.querySelector('[data-testid="tweetText"]')?.textContent || '';
    const addressed = [...article.querySelectorAll('div[dir]')].some(e =>
      /^(回复\s|Replying to\s)/i.test(e.textContent) && e.textContent.length < 250 && !e.querySelector('[data-testid="tweetText"]') &&
      [...e.querySelectorAll('a[href]')].some(a => a.getAttribute('href')?.toLowerCase() === owner));
    const quoteHandles = [...article.querySelectorAll('[role="link"]:not(a)')].flatMap(q => [...(q.textContent||'').matchAll(/@([A-Za-z0-9_]{1,15})/g)].map(m=>m[1].toLowerCase()));
    return {article, id, author, text, time:time.dateTime, at:Date.parse(time.dateTime), addressed, quoteHandles, url:`https://x.com/${author}/status/${id}`};
  }
  const rows = owner => [...document.querySelectorAll('article[data-testid="tweet"]')].filter(a=>!a.closest('[role="dialog"]')).map(a=>post(a,owner)).filter(Boolean);
  function relocate(row, owner, requireAddressed=false) {
    const matches=rows(owner).filter(r=>r.article.isConnected && r.id===row.id && r.author.toLowerCase()===row.author.toLowerCase() && r.time===row.time && normalize(r.text)===normalize(row.text) && (!requireAddressed || r.addressed));
    return matches.length===1 ? matches[0] : null;
  }
  function matches(dialog, row) {
    const sameText = text => {
      const actual=normalize(text), expected=normalize(row.text);
      return actual===expected || (row.quoteHandles||[]).some(h=>actual===expected+' x.com/'+h+'/st…');
    };
    const cards=[...dialog.querySelectorAll('article[data-testid="tweet"]')];
    const contexts=cards.length ? cards : [dialog];
    return contexts.filter(card=> {
      const time=card.querySelector('time'), identity=post(card);
      if(identity && (identity.id!==row.id||identity.author.toLowerCase()!==row.author.toLowerCase())) return false;
      return time?.getAttribute('datetime')===row.time && sameText(card.querySelector('[data-testid="tweetText"]')?.textContent) &&
        [...card.querySelectorAll('a[href]')].some(a=>{try{return new URL(a.href).pathname.toLowerCase()==='/'+row.author.toLowerCase();}catch{return false;}});
    }).length===1;
  }
  globalThis.XAssistantDOM = {normalize,account,dialogs,post,rows,relocate,matches};
})();
