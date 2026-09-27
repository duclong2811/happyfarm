# ADR 0001: Cloudflare-native web stack

Status: Accepted

## Decision
Use a browser-first TypeScript architecture with React + Three.js/React Three Fiber, Cloudflare Workers, Durable Objects, D1, and R2.

## Why
- Browser deployment is a primary goal.
- Farm gameplay is event-driven and well suited to timestamp-based offline progression.
- Durable Objects fit per-farm realtime coordination and WebSockets.
- D1 is sufficient for early persistent relational state while keeping operations close to Workers.
- R2 suits large game assets better than storing binaries in D1.
- TypeScript across contracts/client/server reduces translation overhead and agent context switching.

## Tradeoffs
- Not ideal for high-frequency authoritative physics/FPS simulation.
- D1/DO platform constraints must be respected.
- If future gameplay requires intensive 20-60 Hz server simulation, that subsystem may move to dedicated game servers while Cloudflare remains the edge/API/security layer.

## Consequences
Domain logic must remain portable and not depend directly on Cloudflare APIs. Infrastructure adapters isolate platform-specific code.
