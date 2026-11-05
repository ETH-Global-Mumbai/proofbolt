// Signed one-time command protocol. No Arduino includes, so it also builds on a PC for tests.
// The gateway's copy lives in gateway/src/lock/protocol.ts and must stay byte-identical.
#pragma once

#include <cstdint>
#include <string>

namespace lockproto {

constexpr size_t NONCE_BYTES = 16;
constexpr size_t MAC_BYTES = 32;
constexpr size_t MAX_ARG_LEN = 64;
constexpr uint32_t NONCE_TTL_MS = 15000;
constexpr uint8_t MAX_BAD_MACS = 5;
constexpr uint32_t LOCKOUT_MS = 30000;

using MacFn = void (*)(const std::string& message, uint8_t out[MAC_BYTES]);

enum class Result { OK, NO_NONCE, EXPIRED, BAD_NONCE, BAD_CMD, BAD_ARG, BAD_MAC, LOCKED_OUT };

inline const char* resultName(Result r) {
  switch (r) {
    case Result::OK: return "OK";
    case Result::NO_NONCE: return "NO_NONCE";
    case Result::EXPIRED: return "EXPIRED";
    case Result::BAD_NONCE: return "BAD_NONCE";
    case Result::BAD_CMD: return "BAD_CMD";
    case Result::BAD_ARG: return "BAD_ARG";
    case Result::BAD_MAC: return "BAD_MAC";
    case Result::LOCKED_OUT: return "LOCKED_OUT";
  }
  return "UNKNOWN";
}

inline std::string commandMessage(const std::string& lockId, const std::string& nonceHex,
                                  const std::string& cmd, const std::string& arg) {
  return "locker-v1\n" + lockId + "\n" + nonceHex + "\n" + cmd + "\n" + arg;
}

inline std::string ackMessage(const std::string& lockId, const std::string& nonceHex,
                              const std::string& cmd, const std::string& result) {
  return "locker-ack-v1\n" + lockId + "\n" + nonceHex + "\n" + cmd + "\n" + result;
}

inline std::string hexEncode(const uint8_t* data, size_t len) {
  static const char digits[] = "0123456789abcdef";
  std::string out;
  out.reserve(len * 2);
  for (size_t i = 0; i < len; i++) {
    out.push_back(digits[data[i] >> 4]);
    out.push_back(digits[data[i] & 0x0f]);
  }
  return out;
}

inline int hexValue(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

inline bool hexDecode(const std::string& hex, uint8_t* out, size_t outLen) {
  if (hex.size() != outLen * 2) return false;
  for (size_t i = 0; i < outLen; i++) {
    int hi = hexValue(hex[i * 2]);
    int lo = hexValue(hex[i * 2 + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = static_cast<uint8_t>((hi << 4) | lo);
  }
  return true;
}

inline bool constantTimeEqual(const uint8_t* a, const uint8_t* b, size_t len) {
  uint8_t diff = 0;
  for (size_t i = 0; i < len; i++) diff |= a[i] ^ b[i];
  return diff == 0;
}

inline bool isKnownCommand(const std::string& cmd) {
  return cmd == "OPEN" || cmd == "SHOW" || cmd == "SAFE" || cmd == "PING";
}

// A newline would make two different commands sign the same message.
inline bool isValidArg(const std::string& arg) {
  if (arg.size() > MAX_ARG_LEN) return false;
  for (char c : arg) {
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

// Holds the single outstanding nonce. Every attempt consumes it, so a captured command
// can't be replayed and a wrong guess can't be retried against the same nonce.
class CommandGate {
 public:
  CommandGate(const std::string& lockId, MacFn mac) : lockId_(lockId), mac_(mac) {}

  void issueNonce(const std::string& nonceHex, uint32_t nowMs) {
    nonceHex_ = nonceHex;
    issuedAtMs_ = nowMs;
  }

  bool lockedOut(uint32_t nowMs) {
    if (lockedOut_ && nowMs - lockedAtMs_ >= LOCKOUT_MS) {
      lockedOut_ = false;
      badMacs_ = 0;
    }
    return lockedOut_;
  }

  Result verify(const std::string& nonceHex, const std::string& cmd, const std::string& arg,
                const std::string& macHex, uint32_t nowMs) {
    if (lockedOut(nowMs)) return Result::LOCKED_OUT;
    if (nonceHex_.empty()) return Result::NO_NONCE;

    const std::string expected = nonceHex_;
    const uint32_t ageMs = nowMs - issuedAtMs_;
    nonceHex_.clear();

    if (ageMs > NONCE_TTL_MS) return Result::EXPIRED;
    if (nonceHex != expected) return Result::BAD_NONCE;
    if (!isKnownCommand(cmd)) return Result::BAD_CMD;
    if (!isValidArg(arg)) return Result::BAD_ARG;

    uint8_t given[MAC_BYTES];
    uint8_t computed[MAC_BYTES];
    const bool decoded = hexDecode(macHex, given, MAC_BYTES);
    mac_(commandMessage(lockId_, expected, cmd, arg), computed);
    if (!decoded || !constantTimeEqual(given, computed, MAC_BYTES)) {
      if (++badMacs_ >= MAX_BAD_MACS) {
        lockedOut_ = true;
        lockedAtMs_ = nowMs;
      }
      return Result::BAD_MAC;
    }
    badMacs_ = 0;
    return Result::OK;
  }

 private:
  std::string lockId_;
  MacFn mac_;
  std::string nonceHex_;
  uint32_t issuedAtMs_ = 0;
  uint8_t badMacs_ = 0;
  bool lockedOut_ = false;
  uint32_t lockedAtMs_ = 0;
};

}  // namespace lockproto
