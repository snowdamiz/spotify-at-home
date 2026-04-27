# YouTube Music Import Phased Plan

## Reader And Outcome

This plan is for the engineer building Tunely's next import source. After reading it, they should be able to implement a phased rollout where internal testers can paste or post YouTube links, import arbitrary YouTube tracks into private Tunely libraries for product validation, and then progressively tighten the feature for broader release. The copyright-safe and free-music specialization is intentionally deferred until the very end.

## Delivery Strategy

This rollout is intentionally split into two modes:

- Open test mode: local, dev, staging, or allowlisted internal accounts can import any valid YouTube URL so the team can validate UX, ingestion, storage, playback, metadata, quotas, and failure handling quickly.
- Launch mode: the same pipeline gains stricter policy, eligibility, attribution, and provider rules before any broader beta or public release.

The first half of the plan optimizes for learning. The second half optimizes for safety, operability, and packaging. The "free music" angle becomes a final-stage refinement, not the prerequisite for proving the core experience.

## Product Goal

Users in the testing cohort should be able to:

- Paste or post a YouTube URL directly.
- See the normalized YouTube source before importing it.
- Preview a track before importing it.
- Add the track to a private Tunely account library.
- Play imported tracks through the existing library, playlist, and player flows.

The team should be able to:

- Validate whether YouTube import is a feature worth pursuing at all.
- Measure conversion from pasted link to import to playback.
- Inspect metadata quality, duplicate handling, and import speed.
- Decide later whether the public product should stay broad, become allowlisted, or narrow down to copyright-safe/free sources.

## Policy Context

This plan assumes that broad YouTube downloading is a testing-only capability unless Tunely later makes an explicit launch decision around platform policy, rights handling, and user messaging. Early phases should therefore be limited to non-production environments or allowlisted tester accounts, with the stricter public posture added later as part of the rollout rather than blocking the initial prototype.

Implementation rule: if the app is running in open test mode, any valid YouTube URL may enter the import pipeline. If the app is not in open test mode, the request must pass whatever launch policy Tunely has enabled at that time.

## Feature Shape

Tunely should model three related concepts:

- Discovery result: a normalized YouTube URL shown to the user before import.
- Import candidate: a user-submitted YouTube URL or normalized discovery result that is about to enter the import flow.
- Library track: the stored Tunely song created after a successful import.

That split lets us start broad in testing without baking permanent public policy into the data model too early.

## Phase 0: Testing Mode Gate

Goal: make the "test anything" posture explicit so the broad behavior is easy to enable for testers and easy to disable elsewhere.

TDD slices:

1. RED: shared schema test defines an `ImportPolicyMode` value with `open_test`, `review_required`, and `licensed_only`.
   GREEN: add the shared type and validator.
   REFACTOR: centralize the mode-to-copy mapping used by API and UI.

2. RED: API contract test rejects `open_test` imports for non-allowlisted users or environments.
   GREEN: add environment and account gating around the import entry points.
   REFACTOR: move mode checks behind a shared policy helper.

3. RED: UI settings test exposes a visible testing badge or banner when open test mode is active.
   GREEN: surface the current mode in the app shell or import screen.
   REFACTOR: reuse the same mode display in admin/support views.

Acceptance:

- Internal builds can clearly run in open test mode.
- Production can never accidentally inherit open test behavior by default.
- The app can explain which mode is active.
- The codebase has a single place to change import policy behavior.

## Phase 1: External Import Data Model

Goal: add source and job metadata without disrupting the current private-song library.

Data to model:

- Source provider, source ID, canonical URL, original title, original uploader, and thumbnail.
- Import policy mode used when the job was created.
- Import job status, error code, retry count, and timestamps.
- Playback-ready audio storage location, checksum, duration, and normalized metadata.
- A provenance snapshot captured at import time, such as watch URL, title, channel, selected import path, and any policy metadata known at the time.

TDD slices:

1. RED: repository test can create and read an external-source record linked to a song.
   GREEN: add migration and repository methods.
   REFACTOR: map external-source fields through shared serializers.

2. RED: repository test prevents duplicate ready songs in one account for the same source unless the user explicitly reimports.
   GREEN: add a user/source uniqueness check.
   REFACTOR: expose "already in library" state to import results.

3. RED: migration test preserves existing imported-file songs.
   GREEN: migrate additively with nullable external-source fields.
   REFACTOR: keep local uploads and external imports behind the same song interface.

Acceptance:

- Existing uploads still work.
- External imports appear as normal private songs once ready.
- The app can tell how and when a song entered the system.
- Existing quotas still apply.

## Phase 2: YouTube Direct Link Discovery Provider

Goal: accept user-submitted YouTube links and normalize them into importable discovery results without requiring a YouTube API key.

Provider behavior:

- Do not require or configure a YouTube Data API key for Phase 2.
- Accept a posted or pasted YouTube URL as the discovery input.
- Parse common YouTube URL forms such as `youtube.com/watch?v=...`, `youtu.be/...`, `music.youtube.com/watch?v=...`, and `youtube.com/shorts/...`.
- Normalize every valid URL to a canonical watch URL and source ID.
- Enrich metadata through no-key public metadata where available, such as YouTube oEmbed, to show title, creator/channel, and thumbnail.
- Return a usable importable discovery result even when metadata enrichment fails, using the source ID, canonical URL, and deterministic thumbnail fallback.
- Tag each result with the current import policy mode so the UI knows whether it is broadly importable, review-only, or restricted.

TDD slices:

1. RED: parser test accepts common YouTube URL formats and normalizes each one to the same canonical result shape.
   GREEN: add direct URL parsing and canonicalization.
   REFACTOR: share source parsing across routes and workers.

2. RED: provider test normalizes a posted YouTube URL without any YouTube API key.
   GREEN: implement the no-key metadata lookup and result normalization.
   REFACTOR: keep metadata enrichment optional so import eligibility does not depend on it.

3. RED: provider test still returns an importable result when no-key metadata lookup fails.
   GREEN: add fallback title, thumbnail, and null optional metadata.
   REFACTOR: separate hard URL validation failures from soft metadata enrichment failures.

4. RED: API route test returns normalized discovery results when an authenticated user posts a YouTube link.
   GREEN: add a protected direct-link discovery endpoint for external discovery.
   REFACTOR: apply rate limits per user and per IP.

5. RED: route test rejects missing or invalid YouTube links cleanly.
   GREEN: return typed validation errors such as `youtube_url_required` and `invalid_youtube_url`.
   REFACTOR: reuse the same validation for future import-candidate routes.

Acceptance:

- Users can post or paste a YouTube URL directly.
- No YouTube Data API key is needed for Phase 2.
- Discovery results carry enough metadata to drive preview and import when no-key metadata is available.
- Metadata lookup failure does not block valid links from becoming import candidates.
- Invalid or unsupported links fail with clear typed errors.

## Phase 3: Generic YouTube Import Path For Testing

Goal: allow testers to import arbitrary YouTube tracks so the team can prove the core product loop before narrowing scope.

Behavior:

- Any valid YouTube video selected in open test mode can become an import candidate.
- The import path should be abstracted behind a provider adapter so the public-launch policy can later swap or disable behavior cleanly.
- The system should capture which path was used to obtain the audio and what policy mode allowed it.
- If the import path fails, the failure should be visible and typed rather than hidden behind a generic error.

TDD slices:

1. RED: route test accepts a normalized YouTube discovery result or watch URL as an import candidate in open test mode.
   GREEN: implement the import-candidate creation endpoint.
   REFACTOR: standardize input validation and source normalization.

2. RED: worker test resolves an audio import path for a valid YouTube candidate when open test mode is active.
   GREEN: implement the provider adapter interface and the first YouTube adapter.
   REFACTOR: separate source resolution from file-storage concerns.

3. RED: worker test rejects the same candidate when the app is not in open test mode and no stricter policy has approved it.
   GREEN: enforce mode gating inside the worker, not just at the API edge.
   REFACTOR: share policy enforcement between route and worker.

4. RED: worker test records the original watch URL, adapter used, and policy mode in provenance.
   GREEN: persist source provenance alongside the imported song and job.
   REFACTOR: expose provenance through shared song serializers.

Acceptance:

- Testers can import arbitrary YouTube tracks in allowed environments.
- The broad behavior is clearly confined to open test mode.
- Provenance survives the import and can be inspected later.
- The import path can be replaced or removed without rewriting the whole feature.

## Phase 4: External Import Job Worker

Goal: make the import flow reliable enough to evaluate with real users and realistic volume.

Flow:

1. User taps Add to Library on a normalized YouTube link result.
2. API creates an external import job linked to the user and source.
3. Worker re-checks the active import policy mode.
4. Worker fetches audio through the selected import adapter.
5. Worker computes checksum, stores the file in existing audio storage, creates or updates the song, and marks the job ready.
6. Failed jobs retain typed error codes for retry or support.

TDD slices:

1. RED: route test creates a pending external import job for an authenticated user.
   GREEN: implement the endpoint and repository method.
   REFACTOR: reuse existing auth and quota guards.

2. RED: worker test revalidates policy mode before fetching audio.
   GREEN: implement the worker-side policy check.
   REFACTOR: make provider calls injectable for tests.

3. RED: worker test stores imported audio and marks song ready with checksum and provenance.
   GREEN: wire the selected import adapter into existing audio storage.
   REFACTOR: share post-import finalization with local file imports.

4. RED: worker test fails cleanly on upstream denial, checksum mismatch, unsupported file shape, or storage failure.
   GREEN: add error handling and retry policy.
   REFACTOR: separate permanent failures from transient failures.

Acceptance:

- The API never trusts client-side state alone.
- Jobs are idempotent per user/source where that makes sense.
- Imported files stream through existing playback endpoints.
- Failures are visible and explainable.

## Phase 5: Link Import UI

Goal: make the testing flow fast enough that the team can learn from it immediately.

UI behavior:

- The import or search screen offers a YouTube link entry point.
- Users can paste a YouTube URL and submit it for normalization.
- Result cards show title, creator, source, duration, and current import posture.
- YouTube preview uses a visible player or opens the watch page.
- `Add to Library` appears for any result allowed by the current policy mode.
- Import progress appears immediately after the user starts an import.
- Ready tracks link into the existing player and playlist flows.

TDD slices:

1. RED: UI test shows YouTube link discovery results separately from private library results.
   GREEN: add direct-link entry and external result rendering.
   REFACTOR: extract result-card components.

2. RED: UI test supports pasting a YouTube URL and turns it into an importable result in open test mode.
   GREEN: add direct URL input and validation.
   REFACTOR: unify pasted-link and normalized-result rendering.

3. RED: UI test starts an import and displays pending, ready, and failed states.
   GREEN: call import endpoint and poll job status.
   REFACTOR: add optimistic "in your library" transition.

4. RED: UI test shows the active import policy mode in the flow so testers understand what behavior they are exercising.
   GREEN: surface policy state in the import UI.
   REFACTOR: centralize policy-mode copy.

Acceptance:

- Testers can paste, preview, and import without leaving the core flow.
- The difference between open test mode and stricter modes is visible.
- Imported tracks feel native in Tunely.
- The team can observe where the UX breaks down.

## Phase 6: Production Policy Layer

Goal: add the stricter launch posture after the basic import loop has been proven.

Policy behavior:

- Introduce eligibility states such as `importable`, `review_required`, `preview_only`, and `blocked`.
- Allow Tunely to disable the generic YouTube path outside internal testing.
- Support launch variants such as allowlisted domains only, approved-source-only, or human-review-required.
- Preserve the same link import UI while changing who can actually import what.

TDD slices:

1. RED: policy test maps a YouTube URL result to `review_required` when open test mode is off and no allowlist rule matches.
   GREEN: implement launch-mode policy evaluation.
   REFACTOR: standardize human-readable policy reasons.

2. RED: route test rejects an import request for a candidate that is no longer allowed under the active launch policy.
   GREEN: enforce stricter eligibility at the API edge.
   REFACTOR: share denial reasons across UI and worker.

3. RED: UI test hides or downgrades Add to Library based on the stricter policy state.
   GREEN: conditionally render launch-mode actions from eligibility.
   REFACTOR: keep external result cards reusable across modes.

Acceptance:

- The same feature can move from broad testing to restricted launch without a rewrite.
- Production policy can be tightened gradually.
- Users can see why a result is or is not importable.
- The broad YouTube path is no longer required for public operation.

## Phase 7: Admin Curation And Source Management

Goal: give operators control once the feature starts moving beyond a small internal cohort.

Capabilities:

- Admin can allowlist or block providers, domains, channels, or specific source patterns.
- Admin can mark tracks as approved, blocked, or needing review.
- Admin can inspect provenance, failures, and duplicate patterns.
- Admin can disable open test mode or specific import adapters quickly.

TDD slices:

1. RED: admin repository test can allowlist a provider or domain and read it during policy evaluation.
   GREEN: add source-policy storage.
   REFACTOR: cache policies safely.

2. RED: policy test blocks a previously approved source when the admin policy is disabled.
   GREEN: enforce admin source policies at import time.
   REFACTOR: add audit entries for policy changes.

3. RED: API test lists failed external import jobs for support review.
   GREEN: add admin diagnostics endpoint.
   REFACTOR: redact user-sensitive fields.

Acceptance:

- Provider eligibility can change without a deploy.
- High-risk import paths can be turned off quickly.
- Support can explain failed imports and weird edge cases.

## Phase 8: Abuse Prevention, Observability, And Operations

Goal: keep the system stable once real usage starts generating meaningful load.

Operational controls:

- Per-user and per-IP rate limits for URL parsing, metadata lookup, and import.
- Queue concurrency limits and provider-specific backoff.
- File-size, duration, checksum, and storage quota enforcement.
- Structured logs for provider, source ID, job ID, user ID, policy mode, eligibility result, and failure reason.
- Metrics for link submissions, import conversion, failure modes, duplicate attempts, and blocked imports.
- Feature flags that can disable discovery, import, or specific adapters independently.

TDD slices:

1. RED: rate-limit test rejects excessive external link submissions or imports.
   GREEN: add route-level rate limiting.
   REFACTOR: make limits configurable.

2. RED: worker test respects concurrency and retry configuration.
   GREEN: add a lightweight queue runner.
   REFACTOR: expose queue health.

3. RED: observability test emits structured events for import success and failure.
   GREEN: add logging around discovery, policy checks, and worker execution.
   REFACTOR: standardize event names.

Acceptance:

- Link discovery and import cannot overwhelm the server.
- Policy and provider failures are observable.
- Operators can disable the feature or parts of it quickly.

## Phase 9: Copyright-Safe And Free Music Layer

Goal: add the "free music" specialization only after the generic YouTube import flow has already been proven.

Behavior:

- Add an optional "Free Music" or "Copyright-Safe" discovery tab.
- If keyword search is introduced later, keep it isolated from the Phase 2 direct-link flow and require an explicit product decision before adding API-key-backed discovery.
- Add approved downloadable providers with license metadata and attribution support.
- Preserve proof fields such as license type, license URL, attribution text, and source snapshot.
- Let Tunely decide whether this becomes the default public mode, a parallel mode, or just an admin-curated catalog.

TDD slices:

1. RED: provider test accepts an approved copyright-safe source URL and preserves license metadata.
   GREEN: add the first copyright-safe source resolver.
   REFACTOR: keep licensed/free-source discovery separate from the generic YouTube link parser.

2. RED: resolver test accepts an approved downloadable source with valid license metadata and attribution.
   GREEN: implement the first licensed-source adapter.
   REFACTOR: create an adapter contract for future approved catalogs.

3. RED: UI test shows attribution and import proof for copyright-safe tracks.
   GREEN: surface license and attribution details before and after import.
   REFACTOR: centralize provenance and attribution display components.

Acceptance:

- The free-music path exists without having blocked earlier testing.
- Attribution and license data are preserved where needed.
- Tunely can choose whether the public product emphasizes this mode.
- The specialized flow rides on top of the already-proven import pipeline.

## Phase 10: Launch Checklist

Goal: choose the public posture deliberately instead of accidentally shipping the internal testing posture.

Checklist:

- Decide whether public launch keeps any generic YouTube import behavior or switches entirely to a stricter mode.
- Confirm which environments and account types, if any, may continue using open test mode.
- Finalize user-facing copy for import, preview, blocked, and review-required states.
- Confirm privacy policy, terms, and support documentation for the chosen public posture.
- Verify feature flags can disable broad import behavior instantly.
- Review quotas, storage costs, and abuse controls with realistic usage numbers.
- Run end-to-end tests for pasted URL import, job completion, failed import, duplicate handling, and playback.
- If the free-music layer will be exposed publicly, test attribution output and source-proof display.

Acceptance:

- The team has consciously chosen a public import policy.
- Broad test-only behavior is not silently exposed to everyone.
- The feature can be disabled or narrowed without data loss.
- The rollout path from internal testing to public launch is clear.

## Open Questions

- Which environments and account types should be allowed to use open test mode first?
- What provenance fields will support/debugging need most often?
- What public posture is most likely after testing: broad import, allowlisted import, review-required import, or copyright-safe-only import?
- Should imported external songs count against the same quota as user-uploaded files?
- If keyword search or free-music discovery is added later, should it live as a dedicated tab or become the default experience?

## Source Notes

- YouTube Terms of Service: https://www.youtube.com/static?gl=US&template=terms
- YouTube oEmbed endpoint: https://www.youtube.com/oembed
- YouTube Help, license types: https://support.google.com/youtube/answer/2797468
- YouTube Help, Audio Library: https://support.google.com/youtube/answer/3376882
