// One storage subscription and one timing source for all page modules.
(() => {
  const policy = globalThis.XAssistantTimePolicy;
  let config = policy.normalize();
  const ready = chrome.storage.local.get(policy.KEY).then(data => {config = policy.normalize(data[policy.KEY]);});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[policy.KEY]) config = policy.normalize(changes[policy.KEY].newValue);
  });
  globalThis.XAssistantTime = {
    ready,
    ms: name => policy.milliseconds(config, name),
    seconds: name => config[name],
    arm: (name, runId, account) => globalThis.XAssistantRuntime.call({kind: 'TIME_ARM', name, runId, account}),
    pending: async account => {
      const data = await chrome.storage.local.get('xAssistantCooldownsV1');
      return data.xAssistantCooldownsV1?.[account.toLowerCase()]?.interaction || 0;
    }
  };
})();
