# proofbolt

A locker that opens only when a live grant on Arkiv, its secret access code, a 0G AI decision and a signed command all pass.

**Current state:** runs on a real ESP8266 with a servo, the live 0G Router, Arkiv's Rabdi testnet and 0G's Galileo testnet.

```
Browser ── access link, camera photo ─────> Gateway (laptop) ── 0G Router (AI decision)
                                               │ ───────────── Arkiv (grants, status) ──> Status page
                                     policy.ts decides
                                               │
                              signed one-time command (HMAC + nonce)
                                               ▼
                                     ESP8266 ── servo lock, display, LEDs
```

The ESP8266 holds no AI and no policy. Without a valid command, a key or a live gateway, the door stays locked.

## Run it with no hardware or credentials

```bash
cd gateway
pnpm install
cp .env.example .env
```

Set `LOCK_KEY_HEX` in `.env` to the output of `openssl rand -hex 32`, then run each of these in its own terminal:

```bash
pnpm mock-lock
```

```bash
pnpm start
```

The gateway prints a dev access link to open. With `DEV_MOCKS=1`, the AI is fake and grants are local.

## Check it yourself

No account or key is needed. Writer wallet on Arkiv Rabdi: `0x984Cab2cDC1Eccc6F8f1bbe1e31A78145a027724`.

```bash
curl -s -X POST https://rpc.rabdi.db-chain.testnet.arkiv.network -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["arkiv.schema = str('"'"'proofbolt.attempt'"'"') AND lockerId = str('"'"'locker-1'"'"') AND $creator = addr(0x984Cab2cDC1Eccc6F8f1bbe1e31A78145a027724)",{"select":{"key":true,"attributes":true,"expiresAt":true},"limit":5}]}'
```

To rebuild the decision history from 0G, set `OG_ANCHOR_ADDRESS` to the contract below and run `pnpm zerog replay` in `gateway/`.

| Deployment | Network | Address |
|---|---|---|
| `DecisionAnchor` | 0G Galileo testnet (16602) | Added after the final deployment |

## Use Arkiv

Without `ARKIV_PRIVATE_KEY`, `DEV_MOCKS=1` keeps grants in a local file. To use Arkiv, run this and put the key it prints in `.env`:

```bash
pnpm arkiv wallet
```

Fund the address at https://hub.arkiv.network/faucet, and put a key from https://hub.arkiv.network/access-keys in `ARKIV_ACCESS_KEY`. Set `ARKIV_GATEWAY_ADDRESS` to the wallet's address, then check it works and create a grant:

```bash
pnpm arkiv check
```

```bash
pnpm arkiv grant 10
```

Open the access link it prints, which takes you straight to the gesture. Anyone with the link can try the gesture, so share it like a key. Arkiv holds only a hash of its code. To revoke a grant, run `pnpm arkiv revoke <grant>`. The public status page reads only Arkiv, so it keeps working when the gateway is down:

```bash
pnpm status
```

Open http://localhost:8090. See [arkiv/schema.md](arkiv/schema.md) for what is stored.

## Publish decisions to 0G

Each decision is uploaded in full to 0G Storage, anchored by the `DecisionAnchor` contract on 0G Chain, then linked from Arkiv and the status page. This runs in the background and never affects the door. Without `OG_PRIVATE_KEY`, `DEV_MOCKS=1` skips it.

Run this and put the key it prints in `.env`, then fund the address at https://faucet.0g.ai:

```bash
pnpm zerog wallet
```

Check that storage works, then deploy the contract and put its address in `OG_ANCHOR_ADDRESS`:

```bash
pnpm zerog check
```

```bash
pnpm zerog deploy
```

Anyone can rebuild and verify the history from 0G alone, with only `OG_ANCHOR_ADDRESS` set:

```bash
pnpm zerog replay
```

Decisions made with `DEV_MOCKS=1` are fake and get published like any other. Deploy a new contract and delete `data/` before the real demo, so the public record holds only real decisions.

## Test the real 0G AI

Set `OG_API_KEY` in `.env`. To use the real AI with no Arkiv or 0G publishing keys set, run:

```bash
DEV_AI=LIVE pnpm start
```

To score the AI on your own photos, put JPEGs in `gateway/photos/`, which git ignores. Name each one `<challenge>__<expected answer>.jpg`, like `show-a-fist__OPEN.jpg`, `show-a-fist__HOLD-wrong-gesture.jpg` or `show-a-fist__ALERT-printed.jpg`. Each photo spends credits:

```bash
pnpm zerog photos photos
```

## Manage access

The owner's page creates access links with a QR code, lists live access with the time left, and revokes it. It reads and writes Arkiv directly.

```bash
pnpm owner-page
```

Open http://localhost:8070. It only accepts connections from this laptop, so **never put port 8070 on a tunnel**: it has no login and uses the gateway's wallet. `pnpm arkiv grant` and `pnpm arkiv revoke` do the same from a terminal.

## Use a phone

Phones need HTTPS for the camera, so run a tunnel to the gateway:

```bash
ngrok http --url=<your domain> 8080
```

Set `KIOSK_URL=https://<your domain>` in `.env`. `pnpm arkiv grant` then also prints a QR code of the access link, so anyone with the code can scan it and go straight to the gesture. Anyone holding the link can try the door, so treat the code like a key. Free ngrok domains may show a warning page first, with a **Visit Site** button.

## Flash the ESP8266

```bash
cd firmware
cp include/secrets.example.h include/secrets.h
```

Edit `secrets.h`, using the same `LOCK_ID` and key as the gateway's `.env`, then flash and watch the serial log:

```bash
pio run -t upload -t monitor
```

Set `LOCK_URL` in `.env` to the IP address the board prints, and remove `DEV_MOCKS` to use the real services.

| Part | Pin |
|---|---|
| Servo signal | GPIO14 (D5), with the servo on a separate 5 V supply and a shared ground |
| Red LED | GPIO12 (D6) |
| Green LED | GPIO13 (D7) |
| I2C display | SDA GPIO4 (D2), SCL GPIO5 (D1). SSD1306 and PCF8574 LCD are detected at boot |

To watch the display, servo and LEDs respond to signed commands, with no gateway running:

```bash
LOCK_URL=http://<board ip> pnpm lock-test
```

Check `ANGLE_LOCKED` and `ANGLE_OPEN` in `src/main.cpp` against your bolt before fitting the servo.

## Lock API

| Route | Purpose |
|---|---|
| `GET /nonce` | Issues the single outstanding nonce, valid for 15 seconds |
| `POST /cmd` | Form fields `nonce`, `cmd` (`OPEN`, `SHOW`, `SAFE`, `PING`), `arg`, `mac` |
| `GET /status` | Lock state, with no authentication |

`mac` is HMAC-SHA256 of `locker-v1\n<lock id>\n<nonce>\n<cmd>\n<arg>`. Every attempt uses up the nonce, and five bad MACs lock the API for 30 seconds. If no valid command arrives for 8 seconds, the board relocks and shows `SAFE STOP`.

## Tests

See [TESTING.md](TESTING.md) for the manual tests on the real hardware and live services.

```bash
cd gateway && pnpm test && pnpm typecheck
```

```bash
cd firmware && g++ -std=c++17 -Iinclude test/gate_test.cpp -lcrypto -o /tmp/gate_test && /tmp/gate_test
```

## How we used AI

This project was built with Claude Code, which wrote most of the code and documents under the team's direction. Claude Code also ran many of the tests. The team chose the project, wired the hardware, ran the manual tests, including the real-hand unlock, and reviewed the results. See the commits marked `Co-Authored-By: Claude`.

## Known limits

- The owner's page has no login. It relies on being reachable only from this laptop.
- An access link is a bearer secret, and the gesture shows a live hand, not whose hand it is. There is no identity check.
- The gateway trusts its camera, so injected video could pass the challenge.
- The gateway holds the policy and the signing key, so it is a trusted party.
- If Arkiv can't be read, every unlock is refused. If a status write or 0G upload fails, the door still works and publishing retries.
- The key sits in the board's external flash, so the board must stay inside the locked box.
- Anyone on the network can request a nonce, which can disrupt a command but can't open the lock.
- The randomness of `ESP.random()` has not been measured.
- The AI is judged on a few test photos only, so its accuracy is unmeasured. Injected video or a good fake could fool it.
- The board has no battery or manual override, so losing power leaves the servo wherever it stopped.
