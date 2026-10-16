# Grove SDK types 1.5.0 (used API subset)

Type-only subset of the host-provided Grove SDK. On 2026-10-15 the network signature was verified against local Portal Desktop `plugins/sdk/index.d.ts` and `desktop/shared/plugin-sdk.ts` (SDK 1.5.0). Existing used interfaces are retained; unused Agent and external-open APIs are not vendored. This package includes no runtime or credentials. The MIT license is included here.

The running desktop client injects `window.grove`; this package contains no runtime and no credentials. Update this directory together with the plugin's `minSdkVersion` when adopting a newer contract. The original contract lives at `plugins/sdk` in the client workspace; see the root README for host documentation.
