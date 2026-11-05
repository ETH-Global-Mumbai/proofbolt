// Host test for the command gate:
//   g++ -std=c++17 -Iinclude test/gate_test.cpp -lcrypto -o /tmp/gate_test && /tmp/gate_test
#include <openssl/hmac.h>

#include <cassert>
#include <cstdio>

#include "lock_protocol.h"

using namespace lockproto;

static const uint8_t KEY[32] = {1, 2, 3, 4, 5, 6, 7, 8};
static const char* NONCE = "000102030405060708090a0b0c0d0e0f";

static void mac(const std::string& message, uint8_t out[MAC_BYTES]) {
  unsigned int len = 0;
  HMAC(EVP_sha256(), KEY, sizeof(KEY), reinterpret_cast<const uint8_t*>(message.data()), message.size(), out, &len);
}

static std::string sign(const std::string& nonce, const std::string& cmd, const std::string& arg) {
  uint8_t out[MAC_BYTES];
  mac(commandMessage("locker-1", nonce, cmd, arg), out);
  return hexEncode(out, MAC_BYTES);
}

int main() {
  // Shared with gateway/test/protocol.test.ts, so both languages must sign the same bytes.
  assert(sign(NONCE, "OPEN", "") == "8817021fd8ae384c90893eecce7f66b324cfe85e0c987fd21fa70de13857378c");

  CommandGate gate("locker-1", mac);

  // Valid command is accepted once, and replaying it fails.
  gate.issueNonce(NONCE, 1000);
  assert(gate.verify(NONCE, "OPEN", "", sign(NONCE, "OPEN", ""), 1100) == Result::OK);
  assert(gate.verify(NONCE, "OPEN", "", sign(NONCE, "OPEN", ""), 1200) == Result::NO_NONCE);

  // Expired nonce.
  gate.issueNonce(NONCE, 1000);
  assert(gate.verify(NONCE, "OPEN", "", sign(NONCE, "OPEN", ""), 1000 + NONCE_TTL_MS + 1) == Result::EXPIRED);

  // A MAC for SHOW can't be reused for OPEN.
  gate.issueNonce(NONCE, 1000);
  assert(gate.verify(NONCE, "OPEN", "", sign(NONCE, "SHOW", ""), 1100) == Result::BAD_MAC);

  // A bad attempt burns the nonce.
  assert(gate.verify(NONCE, "OPEN", "", sign(NONCE, "OPEN", ""), 1200) == Result::NO_NONCE);

  // Wrong nonce, unknown command, newline in arg and malformed MAC.
  gate.issueNonce(NONCE, 1000);
  assert(gate.verify("ff", "OPEN", "", sign("ff", "OPEN", ""), 1100) == Result::BAD_NONCE);
  gate.issueNonce(NONCE, 1000);
  assert(gate.verify(NONCE, "ERASE", "", sign(NONCE, "ERASE", ""), 1100) == Result::BAD_CMD);
  gate.issueNonce(NONCE, 1000);
  assert(gate.verify(NONCE, "SHOW", "a\nb", sign(NONCE, "SHOW", "a\nb"), 1100) == Result::BAD_ARG);
  gate.issueNonce(NONCE, 1000);
  assert(gate.verify(NONCE, "OPEN", "", "zz", 1100) == Result::BAD_MAC);

  // Lockout after repeated bad MACs, even with a valid command, then recovery.
  CommandGate limited("locker-1", mac);
  for (int i = 0; i < MAX_BAD_MACS; i++) {
    limited.issueNonce(NONCE, 1000);
    assert(limited.verify(NONCE, "OPEN", "", std::string(64, '0'), 1100) == Result::BAD_MAC);
  }
  limited.issueNonce(NONCE, 1100);
  assert(limited.verify(NONCE, "OPEN", "", sign(NONCE, "OPEN", ""), 1200) == Result::LOCKED_OUT);
  limited.issueNonce(NONCE, 1100 + LOCKOUT_MS);
  assert(limited.verify(NONCE, "OPEN", "", sign(NONCE, "OPEN", ""), 1200 + LOCKOUT_MS) == Result::OK);

  // Timing survives millis() wrapping around.
  gate.issueNonce(NONCE, 0xFFFFFF00u);
  assert(gate.verify(NONCE, "OPEN", "", sign(NONCE, "OPEN", ""), 0x00000010u) == Result::OK);

  puts("gate tests passed");
}
