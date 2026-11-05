// Locker actuator. The board holds no AI and no policy: it runs only commands the gateway signed,
// and with no valid command, no key or no gateway, the door stays locked.
#include <Adafruit_SSD1306.h>
#include <Arduino.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <LiquidCrystal_I2C.h>
#include <Servo.h>
#include <Wire.h>
#include <bearssl/bearssl_hmac.h>

#include "lock_protocol.h"
#include "secrets.h"

using lockproto::CommandGate;
using lockproto::Result;

// GPIO4 and GPIO5 are the default I2C pins, so the servo and LEDs avoid them.
constexpr uint8_t SERVO_PIN = 14;      // D5
constexpr uint8_t LED_RED_PIN = 12;    // D6
constexpr uint8_t LED_GREEN_PIN = 13;  // D7
constexpr int ANGLE_LOCKED = 10;
constexpr int ANGLE_OPEN = 100;
constexpr uint32_t OPEN_MS = 5000;
constexpr uint32_t SERVO_SETTLE_MS = 700;
constexpr uint32_t GATEWAY_TIMEOUT_MS = 8000;

uint8_t lockKey[32];
bool keyValid = false;

void hmacSha256(const std::string& message, uint8_t out[lockproto::MAC_BYTES]) {
  br_hmac_key_context keyContext;
  br_hmac_context context;
  br_hmac_key_init(&keyContext, &br_sha256_vtable, lockKey, sizeof(lockKey));
  br_hmac_init(&context, &keyContext, 0);
  br_hmac_update(&context, message.data(), message.size());
  br_hmac_out(&context, out);
}

ESP8266WebServer server(80);
CommandGate gate(LOCK_ID, hmacSha256);
Servo servo;

Adafruit_SSD1306 oled(128, 64, &Wire, -1);
LiquidCrystal_I2C* lcd = nullptr;
enum class DisplayKind { NONE, OLED, LCD } displayKind = DisplayKind::NONE;

bool unlocked = false;
uint32_t relockAtMs = 0;
bool servoAttached = false;
uint32_t servoDetachAtMs = 0;
uint32_t lastGatewayMs = 0;
bool gatewaySeen = false;
bool gatewayLost = false;

bool i2cPresent(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

void detectDisplay() {
  Wire.begin();
  for (uint8_t address : {0x3C, 0x3D}) {
    if (i2cPresent(address) && oled.begin(SSD1306_SWITCHCAPVCC, address)) {
      displayKind = DisplayKind::OLED;
      return;
    }
  }
  for (uint8_t address : {0x27, 0x3F}) {
    if (i2cPresent(address)) {
      lcd = new LiquidCrystal_I2C(address, 16, 2);
      lcd->init();
      lcd->backlight();
      displayKind = DisplayKind::LCD;
      return;
    }
  }
}

void show(const String& line1, const String& line2 = "") {
  Serial.printf("[display] %s | %s\n", line1.c_str(), line2.c_str());
  if (displayKind == DisplayKind::OLED) {
    oled.clearDisplay();
    oled.setTextColor(SSD1306_WHITE);
    oled.setTextSize(1);
    oled.setCursor(0, 0);
    oled.println(line1);
    oled.println();
    oled.println(line2);
    oled.display();
  } else if (displayKind == DisplayKind::LCD) {
    lcd->clear();
    lcd->setCursor(0, 0);
    lcd->print(line1.substring(0, 16));
    lcd->setCursor(0, 1);
    lcd->print(line2.substring(0, 16));
  }
}

void moveServo(int angle) {
  if (!servoAttached) {
    servo.attach(SERVO_PIN, 500, 2400);
    servoAttached = true;
  }
  servo.write(angle);
  servoDetachAtMs = millis() + SERVO_SETTLE_MS;
}

void relock() {
  unlocked = false;
  moveServo(ANGLE_LOCKED);
  digitalWrite(LED_GREEN_PIN, LOW);
  digitalWrite(LED_RED_PIN, HIGH);
}

void unlock() {
  unlocked = true;
  relockAtMs = millis() + OPEN_MS;
  moveServo(ANGLE_OPEN);
  digitalWrite(LED_RED_PIN, LOW);
  digitalWrite(LED_GREEN_PIN, HIGH);
}

void sendJson(int code, const String& body) {
  server.send(code, "application/json", body);
}

void handleNonce() {
  if (!keyValid) return sendJson(503, "{\"error\":\"NO_KEY\"}");
  uint8_t nonce[lockproto::NONCE_BYTES];
  for (size_t i = 0; i < sizeof(nonce); i += 4) {
    const uint32_t word = ESP.random();
    memcpy(nonce + i, &word, 4);
  }
  const std::string nonceHex = lockproto::hexEncode(nonce, sizeof(nonce));
  gate.issueNonce(nonceHex, millis());
  sendJson(200, String("{\"nonce\":\"") + nonceHex.c_str() + "\",\"ttlMs\":" + lockproto::NONCE_TTL_MS + "}");
}

void handleCommand() {
  if (!keyValid) return sendJson(503, "{\"error\":\"NO_KEY\"}");
  const std::string nonce = server.arg("nonce").c_str();
  const std::string cmd = server.arg("cmd").c_str();
  const std::string arg = server.arg("arg").c_str();
  const std::string mac = server.arg("mac").c_str();

  const Result result = gate.verify(nonce, cmd, arg, mac, millis());
  if (result != Result::OK) {
    Serial.printf("[cmd] rejected: %s\n", lockproto::resultName(result));
    const int code = result == Result::LOCKED_OUT ? 429 : 403;
    return sendJson(code, String("{\"error\":\"") + lockproto::resultName(result) + "\"}");
  }

  // The nonce was consumed by verify, before anything below can move the lock.
  lastGatewayMs = millis();
  gatewaySeen = true;
  if (gatewayLost) {
    gatewayLost = false;
    show("LOCKED", "Gateway back");
  }

  if (cmd == "OPEN") {
    unlock();
    show("OPEN", "Relocks shortly");
  } else if (cmd == "SAFE") {
    relock();
    show("SAFE STOP", arg.c_str());
  } else if (cmd == "SHOW") {
    const String text = arg.c_str();
    const int split = text.indexOf('|');
    if (split < 0) show(text);
    else show(text.substring(0, split), text.substring(split + 1));
  }

  uint8_t ack[lockproto::MAC_BYTES];
  hmacSha256(lockproto::ackMessage(LOCK_ID, nonce, cmd, "OK"), ack);
  sendJson(200, String("{\"result\":\"OK\",\"ack\":\"") + lockproto::hexEncode(ack, sizeof(ack)).c_str() + "\"}");
}

void handleStatus() {
  sendJson(200, String("{\"lockId\":\"") + LOCK_ID + "\",\"locked\":" + (unlocked ? "false" : "true") +
                    ",\"keyValid\":" + (keyValid ? "true" : "false") +
                    ",\"gatewayLost\":" + (gatewayLost ? "true" : "false") +
                    ",\"uptimeMs\":" + millis() + ",\"freeHeap\":" + ESP.getFreeHeap() + "}");
}

bool loadKey() {
  if (!lockproto::hexDecode(LOCK_KEY_HEX, lockKey, sizeof(lockKey))) return false;
  uint8_t any = 0;
  for (uint8_t byte : lockKey) any |= byte;
  return any != 0;
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  relock();

  detectDisplay();
  keyValid = loadKey();
  if (!keyValid) show("NO KEY", "Stays locked");
  else show("LOCKED", "Joining Wi-Fi");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  server.on("/nonce", HTTP_GET, handleNonce);
  server.on("/cmd", HTTP_POST, handleCommand);
  server.on("/status", HTTP_GET, handleStatus);
  server.begin();
}

void loop() {
  static bool announcedIp = false;
  const uint32_t now = millis();

  if (WiFi.status() == WL_CONNECTED && !announcedIp) {
    announcedIp = true;
    Serial.printf("[wifi] %s\n", WiFi.localIP().toString().c_str());
    if (keyValid) show("LOCKED", WiFi.localIP().toString());
  }
  server.handleClient();

  if (unlocked && static_cast<int32_t>(now - relockAtMs) >= 0) {
    relock();
    show("LOCKED");
  }
  if (servoAttached && static_cast<int32_t>(now - servoDetachAtMs) >= 0) {
    servo.detach();
    servoAttached = false;
  }
  if (gatewaySeen && !gatewayLost && now - lastGatewayMs > GATEWAY_TIMEOUT_MS) {
    gatewayLost = true;
    relock();
    show("SAFE STOP", "Gateway lost");
  }
}
