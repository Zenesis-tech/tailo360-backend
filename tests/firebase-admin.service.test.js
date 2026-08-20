jest.mock("firebase-admin", () => ({ apps: [] }));
const mockEnv = {
  FIREBASE_SERVICE_ACCOUNT_JSON: "",
  FIREBASE_SERVICE_ACCOUNT_BASE64: "",
};
jest.mock("../src/config/env", () => mockEnv);

const {
  firebaseServiceAccountValue,
  parseFirebaseServiceAccount,
} = require("../src/services/firebase-admin.service");

const account = {
  type: "service_account",
  project_id: "tailo360-test",
  client_email: "firebase@example.test",
  private_key: "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n",
};

test("parses a normal service-account JSON secret", () => {
  expect(parseFirebaseServiceAccount(JSON.stringify(account))).toMatchObject(
    account,
  );
});

test("parses service-account JSON that a host stored with an extra encoding layer", () => {
  const parsed = parseFirebaseServiceAccount(
    JSON.stringify(JSON.stringify(account)),
  );
  expect(parsed.project_id).toBe(account.project_id);
  expect(parsed.private_key).toContain("\nTEST\n");
});

test("repairs literal private-key newlines introduced by a hosting panel", () => {
  const malformed = JSON.stringify(account).replace(/\\n/g, "\n");
  expect(parseFirebaseServiceAccount(malformed).private_key).toContain(
    "\nTEST\n",
  );
});

test("rejects incomplete service-account credentials", () => {
  expect(() =>
    parseFirebaseServiceAccount(JSON.stringify({ project_id: "test" })),
  ).toThrow("missing client_email");
});

test("decodes a Base64 service-account secret without dashboard escaping", () => {
  const json = JSON.stringify(account);
  mockEnv.FIREBASE_SERVICE_ACCOUNT_JSON = "not-used";
  mockEnv.FIREBASE_SERVICE_ACCOUNT_BASE64 = Buffer.from(json).toString(
    "base64",
  );
  expect(parseFirebaseServiceAccount(firebaseServiceAccountValue())).toMatchObject(
    account,
  );
  mockEnv.FIREBASE_SERVICE_ACCOUNT_JSON = "";
  mockEnv.FIREBASE_SERVICE_ACCOUNT_BASE64 = "";
});

test.each([
  (encoded) => `"${encoded}"`,
  (encoded) => `'${encoded}'`,
  (encoded) => `\\${encoded}`,
  (encoded) => `${encoded.slice(0, 80)}\n${encoded.slice(80)}`,
])("normalizes harmless Base64 formatting added by a host", (decorate) => {
  const json = JSON.stringify(account);
  const encoded = Buffer.from(json).toString("base64");
  mockEnv.FIREBASE_SERVICE_ACCOUNT_BASE64 = decorate(encoded);
  expect(parseFirebaseServiceAccount(firebaseServiceAccountValue())).toMatchObject(
    account,
  );
  mockEnv.FIREBASE_SERVICE_ACCOUNT_BASE64 = "";
});
