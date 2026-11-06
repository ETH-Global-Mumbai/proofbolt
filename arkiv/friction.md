# Arkiv feedback

## An unfunded wallet gets an unhelpful error

- **Expected:** an error saying the wallet has no tGLM, since the first-entity guide says creation fails for insufficient funds.
- **Happened:** `EntityMutationError: Transaction failed: Execution error without revert data`.
- **Reproduce:** with `@arkiv-network/sdk` 1.0.1, call `createEntity` from a new wallet with no funds on Rabdi.
- **Improvement:** put the node's `insufficient funds` detail in the top-level message and name the faucet. Today it's only in the error's `cause` chain.

## Errors print the access key

- **Expected:** a failed write doesn't reveal secrets.
- **Happened:** printing a failed `createEntity` error in full includes the RPC URL, and `rabdi({ accessKey })` puts the key in that URL. An uncaught failure therefore writes the key to the terminal and to any log.
- **Reproduce:** call `createEntity` from an unfunded wallet with an access key set, and don't catch the error.
- **Improvement:** send the key in the `X-API-KEY` header by default, or redact it from error messages.

## The docs don't say how to read one entity's system fields

The select and filter pages list `$expiresAt` and `$owner` as filters but don't show the shape they come back in. We found `getEntity(key, schema)` and its return shape in the SDK's type definitions.

## `$owner` alone doesn't prove who wrote an entity

Anyone can use `changeOwnership` to hand an entity to another wallet, so a reader that filters only with `ownedBy` can be fed planted data. The docs could warn about this next to `ownedBy` and recommend adding `createdBy`.

## The query language's `addr()` is unquoted, unlike `str()`

- **Expected:** `$creator = addr('0x...')`, since strings are written `str('...')`.
- **Happened:** `addr takes a 0x-prefixed address`, pointing at the quote.
- **Reproduce:** send that query through `arkiv_query`. `addr(0x...)` works.
- **Improvement:** accept both, or say in the error that the value takes no quotes. Calling `.toString()` on a query builder is what showed us the right form.

## The Hub's wallet sign-in crashed

- **Expected:** choosing MetaMask on the faucet page starts the wallet connection.
- **Happened:** the page showed "This page couldn't load", with Reload and Back buttons. It worked on a later try, so we can't say what fixed it.
- **Reproduce:** we couldn't reproduce it on demand. We were on Linux with MetaMask, connecting from https://hub.arkiv.network/faucet.
- **Improvement:** keep the wallet error inside the sign-in dialog, with a reason, so one failure doesn't take down the page.
