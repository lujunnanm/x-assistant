# Three-minute module restart · v2.0.3

`xAssistantManagedServiceV1.restartOnFailure=true` enables the requested policy for every selected module. The option is persisted per browser profile; legacy policy remains available when false. Downloading the source does not enable it.

On unexpected stopped/blocked/retrying/missing workers, persist the first failure timestamp and a 180000ms restart deadline. Worker polls and browser background suspension cannot postpone the deadline. A durable one-shot alarm plus the existing 30s watchdog checks it. Revoke the old token, archive up to 20 page text-draft snapshots, close only the owned tab, quarantine any in-flight claims, and create a fresh worker. Close failures retry after another three minutes, never create a second worker alongside the unclosed old one.

Manual module/master OFF cancels the countdown. Normal active cooldowns are not failures. Platform rate limits and unknown-send claims/runtime are preserved: restarting a page does not authorize a duplicate submission or bypass a platform deadline. Unknown global sends remain review-blocked until verification.

Tests: `node --test --test-concurrency=4 tests/*.test.mjs`; watchdog policy tests: `tests/watchdog-restart.test.mjs`. The legacy tests continue checking the old policy with the option absent, while the new tests explicitly enable the installed policy.
