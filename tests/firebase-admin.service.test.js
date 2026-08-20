jest.mock("firebase-admin", () => ({ apps: [] }));
jest.mock("../src/config/env", () => ({ FIREBASE_SERVICE_ACCOUNT_JSON: "" }));

const {
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
