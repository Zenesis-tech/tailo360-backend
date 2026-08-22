# Tailo360 API

The Express/MongoDB API is the authoritative source for studio data, workflow state, pricing, payments, and permissions. It is tenant-scoped from the authentication middleware onward.

## Run

1. Copy `.env.example` to `.env` and replace the JWT secrets.
2. Start MongoDB locally or set `MONGODB_URI` to MongoDB Atlas.
3. Create a private Cloudflare R2 bucket and a bucket-scoped Read/Write API token. Set `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`.
4. Add every mobile OAuth client ID to `GOOGLE_CLIENT_IDS` (comma-separated). The API verifies Google ID tokens; it never trusts a client-provided profile.
5. Run `npm.cmd install` then `npm.cmd run dev` from this folder.
6. The API is at `http://localhost:4000/api/v1`; `GET /health` confirms service availability.

## OTP provider

Production OTP delivery defaults to MSG91. Set `OTP_PROVIDER=twilio` to use [Twilio Verify](https://www.twilio.com/docs/verify/api) instead, then provide `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID`. Twilio Verify owns OTP generation and validation, so the configured Verify Service must have SMS enabled. Keep the MSG91 values set only when `OTP_PROVIDER=msg91`.

Local development uses the fixed code `123456` when `OTP_DELIVERY_MODE=development`. Set `OTP_DELIVERY_MODE=provider` to send and verify real SMS OTPs locally through the configured provider. Production always uses the provider regardless of this setting.

### Firebase Phone Authentication option

Phone authentication is controlled by `PHONE_AUTH_MODE`; users see one Continue button and never choose the infrastructure provider. Set `PHONE_AUTH_MODE=server` to use `OTP_PROVIDER` (MSG91 or Twilio), or set `PHONE_AUTH_MODE=firebase` to use Firebase Phone Auth. The Flutter app reads this public configuration immediately before requesting a code. In Firebase mode, Firebase sends and verifies the SMS on the device, then the app posts the resulting ID token to `POST /auth/firebase/phone`. The API verifies that it is a current Firebase token issued specifically by the `phone` provider before creating the normal Tailo360 access and refresh tokens.

To enable it, turn on the Phone provider in Firebase Authentication, register the Android release and debug SHA-1/SHA-256 fingerprints, keep the current `google-services.json` in `android/app`, and set `FIREBASE_SERVICE_ACCOUNT_JSON` on the API. For iOS, add the Firebase-generated `GoogleService-Info.plist`, enable Push Notifications and Background Modes, and configure an APNs key in Firebase. Use Firebase test phone numbers during development to avoid sending real SMS messages.

## Key endpoint groups

| Group | Endpoints |
| --- | --- |
| Auth | `POST /auth/otp/request`, `/auth/otp/verify`, `/auth/firebase/phone`, `/auth/google`, `/auth/refresh`, `/auth/logout`, `GET /auth/me` |
| Studio | `GET/PATCH /studio`, `GET /studio/members` |
| Customers | `GET/POST /customers`, `GET/PATCH/DELETE /customers/:id`, versioned measurements |
| Templates/prices | `GET/POST/PATCH /garment-templates`, `GET /pricing`, `PUT /pricing/:templateId` |
| Orders | `GET/POST /orders`, `GET/PATCH /orders/:id`, `POST /orders/:id/status`, `/cancel`, `/handover`, `/activity` |
| Money/ops | `POST /payments`, `GET /payments/due`, `GET /dashboard`, `GET /calendar`, `GET /referral` |
| Private media | `POST /media/upload-url`, `POST /media/:id/complete`, `GET /media/:id/url` |
| Subscription | `GET /subscription`, `/subscription/plans`, `/subscription/products`, `POST /subscription/validate-purchase` |
| Data portability | `GET /studio/export` |
| Platform backups | `GET/POST /admin/backups`, `POST /admin/backups/:id/restore` |

The existing detailed endpoint request/response contract is in `../docs/04-api-reference.md`. All write API errors have `{ error: { code, message, details? } }` and create-order/payment accepts `Idempotency-Key`.

## Encrypted backups and restore

Backups are an infrastructure responsibility and are never exposed to studio users. The scheduled job writes separate encrypted database collection snapshots and encrypted media objects to the private R2 bucket. Payloads use AES-256-GCM authenticated encryption, R2 server-side encryption is requested as an additional layer, concurrent jobs are prevented by a MongoDB lock, and expired backup prefixes are deleted according to `BACKUP_RETENTION_DAYS`.

Generate a dedicated 32-byte key, encode it as 64 hexadecimal characters or base64, store it in the production secret manager as `BACKUP_ENCRYPTION_KEY`, and retain an offline recovery copy. Losing the key makes every backup permanently unreadable. Configure `BACKUP_R2_BUCKET` as a separate private bucket accessible by the R2 token, so deletion of the primary media bucket cannot erase recovery data. Set `BACKUP_ENABLED=true` only after both buckets and the encryption key are configured. The default schedule is 02:30 Asia/Kolkata with 30-day retention.

Platform administrators can list and create backups through the admin API. An API restore requires maintenance mode and the exact confirmation string `RESTORE <backup-id>`. Operators with server access can run:

```text
npm run backup:now
npm run backup:restore -- <backup-id> "RESTORE <backup-id>"
```

Always perform a restore drill in an isolated environment before relying on production recovery. Keep R2 credentials and the encryption key in separate security domains where possible.

## Garment audiences

During studio onboarding, `POST /auth/otp/verify` and `POST /auth/google` accept `garmentAudiences`, a non-empty array containing `men`, `women`, `kids`, and/or `unisex`. The selection is stored at `studio.settings.garmentAudiences`, and only matching starter templates are provisioned. `GET /garment-templates` automatically respects the studio selection and optionally accepts `?audience=women`. Changing `settings.garmentAudiences` through `PATCH /studio` adds missing starter garments for newly selected audiences and hides deselected catalogues without deleting templates referenced by historical orders.

R2 objects are private. The app first asks the API for a signed PUT URL, uploads directly with the returned `Content-Type`, calls `complete`, and uses a signed GET URL only when it needs to display/play media. This keeps user media and all R2 credentials out of the mobile bundle. Cloudflare documents this short-lived presigned-URL pattern for direct client uploads and downloads. [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

## Store subscriptions

Run `npm.cmd run seed:plans` once to create the Starter, Pro, and Studio plan records, and `npm.cmd run seed:referrals` once to create the initial referral-reward policy. Plans, prices, trial duration, feature lists, limits, active state, and per-platform product IDs are all MongoDB data—not mobile constants or environment data. A platform admin manages plans with `GET/POST/PATCH /admin/subscription-plans` and versioned referral policies with `GET/POST /admin/referral-reward-configs`; add real Play/App Store product IDs there before a plan becomes purchasable. The app asks the backend for that configured catalog, launches the native store sheet, and submits its transaction proof to `POST /subscription/validate-purchase`. The backend calls Google Play Developer API or App Store Server API, maps the verified store state to the studio subscription, and rejects a transaction already claimed by another studio.

Referral policy snapshots are stored on each referral at creation, so changing the reward later cannot change a promise already made. The backend expires trials/referrals, enforces the selected plan's customer/order limits on every create call, and rewards the referrer only when the configured qualifying condition is met.

For Google, grant the service account in `GOOGLE_SERVICE_ACCOUNT_JSON` access to the Play Console app and set `GOOGLE_PLAY_PACKAGE_NAME`. Google’s subscription API reads a subscription by purchase token and requires the Android Publisher scope. [Google Play subscription lookup](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get)

## Introductory subscription offers

Platform admins manage launch campaigns at **Commercial → Subscription offers**. An offer can give every eligible new studio (or the first configured number of new studios) a free trial or active-plan access for 1–365 days. Campaigns can be scheduled, paused, capped, and prioritised when dates overlap.

For example, create `LAUNCH_1000` with **90 days**, **Starter**, and a **maximum of 1,000**. The server reserves each redemption atomically during first-time studio provisioning, so concurrent signups cannot exceed the cap. Offer details are snapshotted onto the resulting subscription and are visible through the existing subscriptions/admin APIs.

For Apple, create an App Store Connect API key and set the Apple issuer/key/private-key/bundle fields. The backend calls App Store Server API using a transaction ID; keep `APPLE_ENVIRONMENT=sandbox` for TestFlight/sandbox and switch it to `production` for release. [Apple App Store Server API](https://developer.apple.com/documentation/appstoreserverapi)
"# tailo360-backend" 
