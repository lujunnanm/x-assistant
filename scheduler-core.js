// Pure scheduling policy. All times are absolute wall-clock milliseconds.
(() => {
  const INTERVAL = 10 * 60 * 1000;
  const GUARD = 30 * 1000;
  const COOLDOWN_REPLY_BUDGET = 40 * 1000;

  function fresh(now) {
    return {mode: 'interaction', nextReplyAt: now + INTERVAL, lastTick: now};
  }

  function tick(state, now) {
    const nextReplyAt = Number.isFinite(state.nextReplyAt) ? state.nextReplyAt : now + INTERVAL;
    return {...state, nextReplyAt, lastTick: now,
      mode: !state.autoFollow && now >= nextReplyAt ? 'replies' : 'interaction'};
  }

  function replyDeadline(state, post) {
    // Missing posting schedule is not permission to consume the page indefinitely.
    return Number.isFinite(post.nextAt) ? post.nextAt - GUARD : -Infinity;
  }

  function choose(state, now, post) {
    if (post.busy || now >= replyDeadline(state, post)) return 'posting';
    return !state.autoFollow && now >= state.nextReplyAt ? 'notifications' : 'interaction';
  }

  function finishReplies(state, now) {
    return {...state, mode: 'interaction', nextReplyAt: now + INTERVAL};
  }

  function setFollowMode(state, enabled, now) {
    return {...state, autoFollow: enabled,
      nextReplyAt: !enabled && state.autoFollow ? now + INTERVAL : state.nextReplyAt};
  }

  function cooldownDeadline(now, end, post) {
    if (!Number.isFinite(end)) return -Infinity;
    return Math.min(now + COOLDOWN_REPLY_BUDGET, end, replyDeadline(null, post));
  }

  globalThis.XAssistantSchedulerCore = {
    INTERVAL, GUARD, COOLDOWN_REPLY_BUDGET, fresh, tick, choose,
    finishReplies, setFollowMode, replyDeadline, cooldownDeadline
  };
})();
