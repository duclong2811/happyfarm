# API and Realtime Protocols

## Versioning
Public contracts start at `v1`. Breaking payload changes require an explicit versioning decision.

## Authentication context
Actor identity comes from verified server auth/session context, never from a client-supplied player ID.

## REST envelope
Successful responses may use:

```json
{"ok":true,"data":{}}
```

Errors:

```json
{"ok":false,"error":{"code":"CROP_NOT_READY","requestId":"..."}}
```

Do not expose SQL messages, stack traces, secrets, or internal implementation details.

## WebSocket envelope

```ts
type GameMessage = {
  type: string;
  requestId?: string;
  sequence?: number;
  payload: unknown;
};
```

Every payload is runtime validated before use.

## Example command
Client -> server:

```json
{
  "type":"crop.harvest",
  "requestId":"uuid",
  "payload":{"farmId":"farm_123","tileId":"tile_42"}
}
```

Server validates auth, farm permission, crop state, server time, and idempotency. Then it persists result and broadcasts a validated event.

Server -> clients:

```json
{
  "type":"crop.harvested",
  "requestId":"uuid",
  "payload":{
    "farmId":"farm_123",
    "tileId":"tile_42",
    "cropId":"crop_carrot",
    "itemsAdded":3,
    "xpAwarded":8,
    "currencyAwarded":24
  }
}
```

## Stable error codes
Initial set:
- NOT_AUTHENTICATED
- NOT_AUTHORIZED
- INVALID_INPUT
- RESOURCE_NOT_FOUND
- FARM_PERMISSION_DENIED
- TILE_INVALID
- TILE_OCCUPIED
- CROP_NOT_READY
- INSUFFICIENT_ITEMS
- INSUFFICIENT_FUNDS
- REQUEST_ALREADY_PROCESSED
- CONFLICT_STALE_STATE
- RATE_LIMITED
- INTERNAL_ERROR

## Retry/idempotency
Client may retry network requests. High-value commands use a request ID. A duplicate request must not duplicate currency, items, XP, unlocks, or rewards.

## Client authority restrictions
Never accept authoritative balance, reward, maturity, price, level, XP, ownership, or permission values from clients.
