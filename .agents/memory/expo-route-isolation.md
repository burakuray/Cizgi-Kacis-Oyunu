---
name: Expo route isolation
description: Expo Router's file-based route discovery applies to every file under an artifact's app directory.
---

Keep pure helpers, shared types, and testable game logic outside the Expo Router `app/` directory.

**Why:** Expo Router warns that any TypeScript file under `app/` is a route and expects a default React component export, even when the file is only imported as a helper module.

**How to apply:** Place non-screen modules at the artifact root or in a separate non-route directory, and import them through the artifact alias.