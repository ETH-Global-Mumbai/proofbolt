# Locker

A locker that opens only when a valid grant, a fresh World ID check, a 0G AI decision and a signed command all pass.

```
Browser ── World ID check, camera photo ──> Gateway (laptop) ── 0G Router (AI decision)
                                               │
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

Open http://localhost:8080. With `DEV_MOCKS=1`, World ID and the AI are fake and the seeded grant is `dev-grant`.

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

Check `ANGLE_LOCKED` and `ANGLE_OPEN` in `src/main.cpp` against your bolt before fitting the servo.

## Lock API

| Route | Purpose |
|---|---|
| `GET /nonce` | Issues the single outstanding nonce, valid for 15 seconds |
| `POST /cmd` | Form fields `nonce`, `cmd` (`OPEN`, `SHOW`, `SAFE`, `PING`), `arg`, `mac` |
| `GET /status` | Lock state, with no authentication |

`mac` is HMAC-SHA256 of `locker-v1\n<lock id>\n<nonce>\n<cmd>\n<arg>`. Every attempt uses up the nonce, and five bad MACs lock the API for 30 seconds. If no valid command arrives for 8 seconds, the board relocks and shows `SAFE STOP`.

## Tests

```bash
cd gateway && pnpm test && pnpm typecheck
```

```bash
cd firmware && g++ -std=c++17 -Iinclude test/gate_test.cpp -lcrypto -o /tmp/gate_test && /tmp/gate_test
```

## Not built yet

- Uploading the log to 0G Storage. It is only written to `data/episode.jsonl` for now.
- The on-chain contract. Grants are in `data/grants.json` for now, and 0G requires contract addresses.
- `WORLD_DEBRIEF.md`, which the World prize requires.

## Known limits

- The gateway trusts its camera, so injected video could pass the challenge.
- The gateway holds the policy and the signing key, so it is a trusted party.
- The key sits in the board's external flash, so the board must stay inside the locked box.
- Anyone on the network can request a nonce, which can disrupt a command but can't open the lock.
- The randomness of `ESP.random()` has not been measured.
