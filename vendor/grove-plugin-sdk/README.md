# Grove SDK types 1.3.0

Pinned type-only snapshot of `@beings/grove-plugin-sdk` from the Portal Desktop plugin integration, copied on 2026-10-09. The SDK is not published on npm yet; vendoring this small contract makes `npm ci` work without checking out the desktop client. The MIT license is included here.

The running desktop client injects `window.grove`; this package contains no runtime and no credentials. Update this directory together with the plugin's `minSdkVersion` when adopting a newer contract. The original contract lives at `plugins/sdk` in the client workspace; see the root README for host documentation.
