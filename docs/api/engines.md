# Engines

## GET /api/engines/available

List detected engines and their models. Uses 3-tier cache (memory -> DB -> live probe).

**Response:**

```json
{
  "success": true,
  "data": {
    "engines": [
      {
        "engineType": "claude-code",
        "installed": true,
        "executable": true,
        "version": "1.0.0",
        "binaryPath": "/usr/local/bin/claude",
        "authStatus": "authenticated"
      }
    ],
    "models": {
      "claude-code": [
        { "id": "opus", "name": "Opus", "isDefault": true },
        { "id": "sonnet", "name": "Sonnet" }
      ],
      "codex": [
        { "id": "o3", "name": "o3", "isDefault": true }
      ]
    }
  }
}
```

`engines` items follow `EngineAvailability` (`engineType`, `installed`, `executable`, `version`, `binaryPath`, `authStatus`, `error`). `models` is a per-engine map (`Record<string, EngineModel[]>`), not a flat array.

## GET /api/engines/profiles

List engine profiles.

## GET /api/engines/settings

Get engine default settings.

**Response:** `{ defaultEngine, engines: { [engineType]: { defaultModel } } }`

## PATCH /api/engines/default-engine

Set the global default engine.

**Request Body:** `{ defaultEngine: "claude-code" | "codex" | "acp" | "echo" }`

## GET /api/engines/:engineType/models

List models for a specific engine.

**Response:** `{ engineType, defaultModel, models }`

## PATCH /api/engines/:engineType/settings

Set an engine's default model.

**Request Body:** `{ defaultModel: string }`

## POST /api/engines/probe

Force live re-probe of all engines.
