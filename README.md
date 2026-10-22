# dsh-capability-nudge

A DSH (DeepSeek Harness) plugin that nudges the agent toward the right tool.

## What it does

Every step, the latest user message is matched against a small capability ledger
(`abili_core.json`). When a trigger hits, a short reminder is injected into the
turn suggesting the matching tool. When nothing matches, the turn is returned
untouched, so the prompt prefix (and the cache hit rate) is preserved.

Design goals:

- Zero model calls (pure string matching).
- Inject only on a hit; never rewrite the prefix on a miss.
- Remind at most once per session/turn.
- Silently disable itself if the ledger is missing (no errors).

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `DSH_ABILITY_CORE` | `abil_core.json` | Path to the capability ledger |

The ledger format:

```json
{
  "caps": [
    {
      "name": "Video understanding",
      "tool": "tools/video.py",
      "triggers": ["watch video", "what happens in this video"],
      "note": "Native video understanding, do not extract frames"
    }
  ]
}
```

## Installation

Place the plugin directory in your DSH plugins folder and enable it in
`cordis.patch.yml`:

```yaml
- id: capability-nudge
  disabled: false
```

## Notes

- Requires DSH with the `agent/pre-step` hook.
- No network access, no files written.
