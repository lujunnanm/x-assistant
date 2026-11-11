// One storage subscription and one timing source for all page modules.
(() => {
  const policy = globalThis.XAssistantTimePolicy;
  let config = policy.normalize();
  const local=()=>globalThis.XAssistantRuntime?.storage||chrome.storage.local;
  const ready = Promise.resolve().then(()=>local().get(policy.KEY)).then(data => {config = policy.normalize(data[policy.KEY]);});
  ready.catch(()=>{}); // Drivers still receive the original initialization error when awaited.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[policy.KEY]) config = policy.normalize(changes[policy.KEY].newValue);
  });
  globalThis.XAssistantTime = {
    ready,
    ms: name => policy.milliseconds(config, name),
    seconds: name => config[name],
    arm: (name, runId, account) => globalThis.XAssistantRuntime.call({kind: 'TIME_ARM', name, runId, account}),
    pending: async account => {
      const data = await local().get('xAssistantCooldownsV1');
      return data.xAssistantCooldownsV1?.[account.toLowerCase()]?.interaction || 0;
    }
  };
})();
