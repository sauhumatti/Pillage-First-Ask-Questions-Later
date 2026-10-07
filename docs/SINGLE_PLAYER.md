# Compact single-player worlds

Create a **50×50 — 20 players** world to use this mode. One human and 19 AI players each start with one village, level-zero resource fields, a level-one Main Building and Rally Point, 750 of each resource, three basic troops, and a hero. Tribe bonuses still apply. Players can found or conquer further villages, so 20 is the starting player count, not a village limit.

The original resource costs, prerequisites, construction queues, troop travel, combat, hero adventures, research, and expansion rules apply. There are no alliances or Wonder victory conditions. Embassy and Treasury construction is unavailable in this mode. Play is open-ended. Existing larger worlds retain their previous rules.

The playback bar offers Pause, 1×, 2×, 5×, and 10×. Resource production and scheduled actions share a saved game clock. New and reopened worlds start paused; closed worlds do not catch up to wall time. Hosted worlds pause when the last game connection closes. Server-speed selection still multiplies the original game rates; playback speed additionally controls how quickly game time passes.

## AI decisions

Every five game minutes, each AI receives a list of affordable actions for its own villages. It can build, upgrade, research, train, expand, and attack or raid other villages. Opponent troop counts and resources are not supplied to the model. The model selects an offered action ID; the engine rechecks the action against current state, charges normal costs, and schedules normal events. Waiting for a model response does not advance the game clock.

Without a model service, a local priority policy handles economy, storage, army training, incoming attacks, expansion, and raids. Provider errors, unavailable models, request limits, and invalid responses also use this fallback. This is an initial AI policy, not a claim of campaign balance or optimal strategy.

## Optional OpenRouter configuration

Configure these variables on the **server**, or on the process running the web development server:

- `OPENROUTER_API_KEY`: secret API key; never use a `VITE_` prefix or put it in browser code.
- `OPENROUTER_MODEL`: an available OpenRouter model ID that supports JSON responses. The proposed `openai/gpt-6-luna-decisions` ID has not been verified.
- `OPENROUTER_REQUESTS_PER_HOUR`: optional real-time request cap, default `120`. Set `0` to disable paid decisions. The cap applies per provider process, including each hosted world worker, and resets on process restart.

Outbound access to `https://openrouter.ai` is required. The same-origin `/api/ai/decide` gateway exists in the game server and the Vite development server. A static web deployment needs a server gateway for model decisions; otherwise it uses the local policy. Model calls time out after eight seconds, and provider failures delay retries for one real minute. Fast-forward can consume the request allowance quickly because all 19 AI players take turns in game time.

Only the configured server holds credentials. The browser sends its own AI village summaries and offered actions to the gateway. Hosted gateway requests require the normal session authentication. Live provider availability must be checked with your configured account; mock tests do not verify model availability or pricing.
