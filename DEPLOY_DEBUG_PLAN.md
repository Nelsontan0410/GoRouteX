# GoRouteX deployment diagnosis and optimization plan

Read-only investigation, 10 September 2026. No deployment, dependency installation, configuration or production change was performed.

## Verified evidence

- Site: `goroutex`, site ID `d231093f-7052-48ce-9bdf-59ca2b8c91a7`.
- Current production deploy: `6aa26aadf0efb9265ebd0739`.
- Created 2026-09-10 16:30:37.444 Singapore time; published 16:31:22.091. Creation-to-publication: 44.647 seconds. Netlify reports `deploy_time: 43` seconds and state `ready`, with no deploy error.
- Deploy metadata: title `Build from drop deployment`, source `api`, source ZIP present, build ID present, no commit or branch. This is evidence of a source-upload/build workflow for this deployment; it does not establish how every prior deployment was started.
- Summary: 12 new files uploaded, three functions deployed. Three newly published pages are test harnesses under `tests/`.
- Secret-scanning report: 31,103 scanned files, no matches. This count is not the public asset count and does not prove dependencies were publicly exposed. Build/dependency contents are a hypothesis to verify against build logs and the deployed-file manifest.
- Workspace: 76 files, 5,342,794 bytes; largest files are LTA JSON (2,834,358 bytes) and app.html (843,753 bytes). The raw LTA download is absent.
- netlify.toml specifies the functions directory and esbuild bundler, but no explicit build command or publish directory. Dashboard overrides were not exposed by the connector.
- package-lock.json locks 180 dependency packages; firebase-admin is the declared dependency. The production deploy lists three function packages of approximately 3.55 MB each. Their size alone does not prove a bottleneck; no per-stage timing was returned.
- This workspace has no node_modules, .netlify site link, deployment script or local Git directory. The current shell cannot resolve node/npm/npx/netlify from PATH. Bundled Node is available; this is a local CLI preparation issue, not evidence of a cloud build failure.
- A single bounded HTTPS GET for production app.html returned 200: approximately 1.52 seconds to first byte and 2.42 seconds overall. This is not a multi-location performance benchmark or browser runtime test.

## What remains unproven

The available deployment reader retrieves known deploy IDs, but does not expose a deployment-history list or build-log operation. A stalled deploy URL/log and whether the stall is in Codex, Netlify, or the website are needed to identify the recurring failure stage. The latest successful deployment cannot establish queue time before deploy creation, source ZIP preparation/upload time, earlier errors, or time spent by an agent checking an already-finished deployment.

## Implementation plan, in priority order

1. **Make deployment observable and bounded.** Add one deploy command that records preparation, dependency installation, function bundling, upload, cloud processing and smoke-test timestamps. Save machine-readable deploy ID, URL, state, duration and concise error locally. Query the existing deploy ID on uncertainty; do not launch duplicate deployments. Poll at 5/10/20/30-second intervals, then report the current stage after a configurable timeout. A monitoring timeout must not be called a deploy failure.

2. **Create an explicit publication directory.** Add a small deterministic static-file packaging script producing dist/ from a reviewed asset manifest. Keep required HTML, JS, CSS, runtime data and _headers. Exclude tests, diagnostic pages, screenshots, documentation, editor metadata, dependency folders and server source from public output. Keep Functions source and dependencies available to the build separately. Validate local references and required assets before upload; do not blindly exclude assets by filename extension. Set the explicit publish/build configuration only after verifying the actual deploy mechanism and dashboard settings.

3. **Use one reproducible deploy path.** Pin a supported Node and Netlify CLI version; install once rather than fetch an unpinned CLI for every run. Use the lockfile and npm ci when dependencies change. Reuse dependency caches with keys tied to runtime and lockfile. Bind the known site ID explicitly. Do not remove/redeploy Functions merely to speed up a frontend update: payment and approval endpoints must remain present. Measure bundling time before changing firebase-admin packaging.

4. **Separate deployment from comprehensive QA.** Run syntax, relevant tests and reference validation before deploying. After Netlify reaches ready, check only the deploy permalink, a version marker, key assets, and read-only/non-mutating function health checks. Do not rerun full browser navigation and route simulation for every CSS change. Google API referrer rejection should be reported as a separate QA limitation, never trigger an automatic redeploy.

5. **Make freshness visible.** Include a non-secret build-version file in the publication artifact. Compare its version on the deploy permalink and production URL. Diagnose successful-deploy/stale-browser reports through version and cache evidence. Introduce consistent asset versioning if measurements show mixed/stale assets; do not assume all cache settings should be disabled.

6. **Verify with controlled deployments, after authorization.** First inspect the slow/failed deployment log and map timings to stages. For the optimized workflow, use one preview deploy, confirm frontend and all three Functions remain present, and confirm no test pages are in public output. Compare file counts, bytes and phase times against the baseline; measure warm runs only when subsequent authorized changes need deployment. Production release is separate from this diagnostic plan.

## Acceptance criteria

- Every run returns a deploy ID or an explicit pre-upload error; no silent indefinite waiting.
- No duplicate deployment caused by polling or an ambiguous network response.
- Public manifest contains application assets only; all required assets and three Functions survive packaging.
- Logs identify the slow stage, not merely a total elapsed time.
- A ready deployment ends the deploy wait and proceeds to bounded smoke tests.
- Record cold/warm timings; choose a latency target from measured stage baselines. Do not promise a fixed speedup based only on the 31,103-file scan count.
- Retain secret scanning. Reduce publication scope and inspect build inputs instead of disabling checks.

## Sources

- Current deployment metadata: https://app.netlify.com/projects/goroutex/deploys/6aa26aadf0efb9265ebd0739
- Netlify deployment mechanisms: https://docs.netlify.com/deploy/create-deploys/
- Source ZIP Build API: https://developers.netlify.com/guides/deploy-zip-file-to-production-website/
- CLI deployment options: https://cli.netlify.com/commands/deploy/
- Secret scanning: https://docs.netlify.com/manage/security/secret-scanning/

This document is a diagnostic result and proposed change plan. None of the proposed deployment/configuration changes have been applied.
