# Proposal: Complete Video/TTS Pipeline

## Problem

Video generation (`generateVideo`) and TTS (`synthesizeSpeech`) in `app/src/services/ai.ts` are hardcoded to single providers (Runway / Volcengine). They ignore the `UserAIConfig` system that LLM and Image generation already use. Users who configure their own API keys in Settings get no benefit for video/TTS.

This is the **only remaining blocker** to running the full 7-step pipeline end-to-end with user-configured providers.

## Solution

Apply the same pattern already proven in `chatCompletion()` and `generateImage()`:

1. **API routes** (`/api/generate/video`, `/api/generate/tts`) call `getUserVideoConfig()` / `getUserTTSConfig()` and pass config to the service functions
2. **Service functions** accept optional `config?: AIServiceConfig`, dispatch by protocol/baseUrl, fallback to env vars when no config

## Scope

### In Scope
- `generateVideo()` multi-provider dispatch (Runway, Fal.ai, fallback env)
- `synthesizeSpeech()` multi-provider dispatch (Volcengine, ElevenLabs, fallback env)
- API route wiring for both
- Error messages guiding misconfiguration (same quality as existing image/LLM errors)

### Out of Scope
- Multi-version generation (the `console.log` TODOs in editor — separate change)
- Payment system hardening
- Production queue (BullMQ)
- New provider additions beyond what's already in schema

## Files Changed

| File | Change |
|------|--------|
| `app/src/services/ai.ts` | Refactor `generateVideo()` and `synthesizeSpeech()` to accept config, add `generateVideoWithConfig()` and `synthesizeSpeechWithConfig()` with protocol dispatch |
| `app/src/app/api/generate/video/route.ts` | Import and call `getUserVideoConfig()`, pass to `generateVideo()` |
| `app/src/app/api/generate/tts/route.ts` | Import and call `getUserTTSConfig()`, pass to `synthesizeSpeech()` |

## Risk

- **Low**: Pattern is proven (copy from image/LLM), no schema changes, no new dependencies
- **Backwards compatible**: No config → falls back to env vars (existing behavior)

## Estimated Size

~200-300 lines changed across 3 files. Small, focused change.
