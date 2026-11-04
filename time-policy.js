// Shared by the service worker, settings and content scripts. Values are seconds.
(() => {
  const KEY = 'xAssistantTimingV1';
  const fields = {
    posting: {label: '发帖冷却', min: 1200, max: 1800, floor: 1, ceiling: 86400, range: true},
    interaction: {label: '互动冷却', min: 20, max: 30, floor: 1, ceiling: 3600, range: true},
    replyGap: {label: '逐条回帖冷却', min: 10, max: 20, floor: 1, ceiling: 3600, range: true},
    notifications: {label: '通知检查间隔', min: 600, max: 600, floor: 10, ceiling: 86400},
    replyWindow: {label: '单次通知处理时长', min: 300, max: 300, floor: 5, ceiling: 3600},
    startup: {label: '首次启动等待', min: 30, max: 30, floor: 1, ceiling: 3600},
    restart: {label: '异常重试等待', min: 30, max: 30, floor: 5, ceiling: 3600},
    guard: {label: '发帖提前交接', min: 30, max: 30, floor: 1, ceiling: 300}
  };
  function normalize(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('时间配置无效');
    const result = {};
    for (const [name, field] of Object.entries(fields)) {
      const item = value[name] ?? field;
      const {min, max} = item;
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < field.floor || max > field.ceiling || min > max || (!field.range && min !== max))
        throw Error(`${field.label}：请输入 ${field.floor}–${field.ceiling} 秒，最小值不得大于最大值`);
      result[name] = {min, max};
    }
    if (Object.keys(value).some(name => !fields[name])) throw Error('存在未知时间配置');
    return result;
  }
  function milliseconds(config, name, random = Math.random) {
    if (!fields[name]) throw Error('未知时间项');
    const {min, max} = normalize(config)[name];
    const r = random();
    if (!Number.isFinite(r) || r < 0 || r >= 1) throw Error('随机值无效');
    return Math.round((min + r * (max - min)) * 1000);
  }
  globalThis.XAssistantTimePolicy = {KEY, fields, normalize, milliseconds};
})();
