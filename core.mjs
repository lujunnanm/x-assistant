export function validateRows(input) {
  if (!Array.isArray(input)) throw Error('导入内容必须是 JSON 数组');
  if(input.length>5000)throw Error('文案库最多 5000 条');
  const ids = new Set();
  return input.map((r, i) => {
    if (!r || !['post','reply'].includes(r.type) || typeof r.text !== 'string' || !r.text.trim()) throw Error(`第 ${i+1} 条：需要 type(post/reply) 和非空 text`);
    if(r.text.length>10000)throw Error(`第 ${i+1} 条文案超过 10000 字符`);
    const id = r.id === undefined ? crypto.randomUUID() : r.id.trim?.();
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw Error(`第 ${i+1} 条 ID 无效或重复`);
    if (r.enabled !== undefined && typeof r.enabled !== 'boolean') throw Error(`第 ${i+1} 条 enabled 必须为布尔值`);
    ids.add(id);
    return {id, type:r.type, text:r.text.trim(), enabled:r.enabled !== false};
  });
}
export function interval(config, random = Math.random) {
  const min = Number(config.min), max = Number(config.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 30 || max < min || max > 86400) throw Error('间隔须为 30～86400 秒，且最大值不小于最小值');
  return Math.round((min + random() * (max-min))*1000);
}
export function pick(rows, type, bag = [], last = null, random = Math.random) {
  const pool = rows.filter(r=>r.enabled && r.type===type);
  if (!pool.length) return {row:null, bag:[]};
  const live = new Map(pool.map(r=>[r.id,r]));
  let rest = [...new Set(bag)].filter(id=>live.has(id));
  if (!rest.length) {
    rest = [...live.keys()];
    for(let i=rest.length-1;i>0;i--){const j=Math.floor(random()*(i+1)); [rest[i],rest[j]]=[rest[j],rest[i]];}
    if(rest.length>1 && rest[0]===last) [rest[0],rest[1]]=[rest[1],rest[0]];
  }
  return {row:live.get(rest.shift()), bag:rest};
}
