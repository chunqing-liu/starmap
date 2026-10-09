# Plugin provenance

The distributable plugin in `src/` was extracted from the Grove plugin integration in Portal Desktop on 2026-10-09. Its board implementation was adapted from chunqing-liu/portal-desktop commit `2f84fd6fc9d4b00a87a1c13a4e8871a42ca5225c` (P16/P17). It retains the original MIT license, authorship and storage schema.

The pre-existing `pipeline/`, `tests/`, `shared-types.ts`, `README_PIPELINE.md` and `THIRD_PARTY_NOTICES` in this repository are preserved. They contain later board and pixel-office work and are not bundled by the current plugin build. This extraction does not claim that those later office features have been ported to the plugin.

React, React DOM and React Flow are bundled into `index.html`; esbuild retains their bundled license comments. `vendor/grove-plugin-sdk/` is a type-only SDK 1.3.0 snapshot with its license. The installed plugin ID remains `community.pipeline` so existing host-managed user data continues to work.
