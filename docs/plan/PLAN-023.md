# PLAN-023 Keep pending messages separate and editable

- **task**: BUG-012
- **status**: completed
- **owner**: local
- **created**: 2026-03-13

## Context

- The previous implementation enforced a single pending row per issue.
- `upsertPendingMessage()` reused the existing row and merged message content, display prompt text, and attachments into one record.
- The UI already rendered pending items at the bottom, but recall/edit behavior still targeted a single issue-level pending row.
- `turn-completion`, `flushPendingAsFollowUp()`, `execute`, and `restart` still had paths that pre-merged queued user intent before sending it back to the engine.

## Proposal

1. Store every queued pending message as its own row.
2. Recall and edit pending messages by `messageId` instead of by issue.
3. Keep pending rows visible in order and expose an edit action on each row.
4. Consume queued messages one at a time in flush, execute, and restart paths.
5. Preserve SSE and rollback behavior at per-message precision.

## Scope

- Update pending DB helpers for insert, query, delete, and relocation behavior.
- Update follow-up, execute, restart, and turn-completion flows to stop pre-merging pending prompts.
- Update frontend pending edit behavior to target a specific message row.
- Add regression coverage for separate pending storage, per-message recall, and per-message relocation/flush.

## Risks

- Sequential flush means a single turn completion only advances one queued row, so idle-state recovery had to be verified carefully.
- Existing execute/restart behavior previously assumed a combined prompt; changing that behavior could expose ordering bugs.
- The frontend still restores recalled content into one composer, so the edit entrypoint had to stay aligned with the selected `messageId`.

## Alternatives

1. Full per-message handling.
This keeps UI semantics and engine semantics aligned.

2. Split only the UI while keeping backend batching.
This would still misrepresent what the engine actually receives, so it was rejected.

## Result

- Pending rows are now stored, recalled, and relocated individually.
- Follow-up recall requires `messageId`.
- Working issues with existing queued rows append a new row, then flush in order.
- Execute and restart stop merging queued prompts ahead of time.
- The pending section in the chat UI supports per-row edit actions.
