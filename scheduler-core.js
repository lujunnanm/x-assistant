// Pure scheduling policy. All times are absolute wall-clock milliseconds.
(() => {
  const time = globalThis.XAssistantTime;
  const interval = () => time?.ms('notifications') ?? 600000;
  const guard = () => time?.ms('guard') ?? 30000;

  function fresh(now) {
    return {mode: 'interaction', nextReplyAt: now + interval(), lastTick: now};
  }

  function tick(state, now) {
    const nextReplyAt = Number.isFinite(state.nextReplyAt) ? state.nextReplyAt : now + interval();
    return {...state, nextReplyAt, lastTick: now,
      mode: now >= nextReplyAt ? 'replies' : 'interaction'};
  }

  function replyDeadline(state, post) {
    // Missing posting schedule is not permission to consume the page indefinitely.
    return Number.isFinite(post.nextAt) ? post.nextAt - guard() : -Infinity;
  }

  function choose(state, now, post) {
    if (post.busy || now >= replyDeadline(state, post)) return 'posting';
    return now >= state.nextReplyAt ? 'notifications' : 'interaction';
  }

  function finishReplies(state, now) {
    return {...state, mode: 'interaction', nextReplyAt: now + interval()};
  }

  function setFollowMode(state, enabled, now) {
    return {...state, autoFollow: enabled,
      nextReplyAt: state.nextReplyAt};
  }

  globalThis.XAssistantSchedulerCore = {
    get REPLY_WINDOW() { return time?.ms('replyWindow') ?? 300000; },
    get GUARD() { return guard(); },
    get AUTO_RESTART_DELAY() { return time?.ms('restart') ?? 30000; },
    fresh, tick, choose, finishReplies, setFollowMode, replyDeadline
  };
})();
