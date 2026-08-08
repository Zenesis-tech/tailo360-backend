# Tailo360 API

The Express/MongoDB API is the authoritative source for studio data, workflow state, pricing, payments, and permissions. It is tenant-scoped from the authentication middleware onward.

## Run

1. Copy `.env.example` to `.env` and replace the JWT secrets.
2. Start MongoDB locally or set `MONGODB_URI` to MongoDB Atlas.
3. Create a private Cloudflare R2 bucket and a bucket-scoped Read/Write API token. Set `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`.
4. Add every mobile OAuth client ID to `GOOGLE_CLIENT_IDS` (comma-separated). The API verifies Google ID tokens; it never trusts a client-provided profile.
5. Run `npm.cmd install` then `npm.cmd run dev` from this folder.
4. The API is at `http://localhost:4000/api/v1`; `GET /health` confirms service availability.

## OTP provider

Production OTP delivery defaults to MSG91. Set `OTP_PROVIDER=twilio` to use [Twilio Verify](https://www.twilio.com/docs/verify/api) instead, then provide `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID`. Twilio Verify owns OTP generation and validation, so the configured Verify Service must have SMS enabled. Keep the MSG91 values set only when `OTP_PROVIDER=msg91`.

Local development uses the fixed code `123456` when `OTP_DELIVERY_MODE=development`. Set `OTP_DELIVERY_MODE=provider` to send and verify real SMS OTPs locally through the configured provider. Production always uses the provider regardless of this setting.

## Key endpoint groups

| Group | Endpoints |
| --- | --- |
| Auth | `POST /auth/otp/request`, `/auth/otp/verify`, `/auth/google`, `/auth/refresh`, `/auth/logout`, `GET /auth/me` |
| Studio | `GET/PATCH /studio`, `GET /studio/members` |
| Customers | `GET/POST /customers`, `GET/PATCH/DELETE /customers/:id`, versioned measurements |
| Templates/prices | `GET/POST/PATCH /garment-templates`, `GET /pricing`, `PUT /pricing/:templateId` |
| Orders | `GET/POST /orders`, `GET/PATCH /orders/:id`, `POST /orders/:id/status`, `/cancel`, `/handover`, `/activity` |
| Money/ops | `POST /payments`, `GET /payments/due`, `GET /dashboard`, `GET /calendar`, `GET /referral` |
| Private media | `POST /media/upload-url`, `POST /media/:id/complete`, `GET /media/:id/url` |
| Subscription | `GET /subscription`, `/subscription/plans`, `/subscription/products`, `POST /subscription/validate-purchase` |

The existing detailed endpoint request/response contract is in `../docs/04-api-reference.md`. All write API errors have `{ error: { code, message, details? } }` and create-order/payment accepts `Idempotency-Key`.

## Garment audiences

During studio onboarding, `POST /auth/otp/verify` and `POST /auth/google` accept `garmentAudiences`, a non-empty array containing `men`, `women`, `kids`, and/or `unisex`. The selection is stored at `studio.settings.garmentAudiences`, and only matching starter templates are provisioned. `GET /garment-templates` automatically respects the studio selection and optionally accepts `?audience=women`. Changing `settings.garmentAudiences` through `PATCH /studio` adds missing starter garments for newly selected audiences and hides deselected catalogues without deleting templates referenced by historical orders.

R2 objects are private. The app first asks the API for a signed PUT URL, uploads directly with the returned `Content-Type`, calls `complete`, and uses a signed GET URL only when it needs to display/play media. This keeps user media and all R2 credentials out of the mobile bundle. Cloudflare documents this short-lived presigned-URL pattern for direct client uploads and downloads. [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

## Store subscriptions

Run `npm.cmd run seed:plans` once to create the Starter, Pro, and Studio plan records, and `npm.cmd run seed:referrals` once to create the initial referral-reward policy. Plans, prices, trial duration, feature lists, limits, active state, and per-platform product IDs are all MongoDB data—not mobile constants or environment data. A platform admin manages plans with `GET/POST/PATCH /admin/subscription-plans` and versioned referral policies with `GET/POST /admin/referral-reward-configs`; add real Play/App Store product IDs there before a plan becomes purchasable. The app asks the backend for that configured catalog, launches the native store sheet, and submits its transaction proof to `POST /subscription/validate-purchase`. The backend calls Google Play Developer API or App Store Server API, maps the verified store state to the studio subscription, and rejects a transaction already claimed by another studio.

Referral policy snapshots are stored on each referral at creation, so changing the reward later cannot change a promise already made. The backend expires trials/referrals, enforces the selected plan's customer/order limits on every create call, and rewards the referrer only when the configured qualifying condition is met.

For Google, grant the service account in `GOOGLE_SERVICE_ACCOUNT_JSON` access to the Play Console app and set `GOOGLE_PLAY_PACKAGE_NAME`. Google’s subscription API reads a subscription by purchase token and requires the Android Publisher scope. [Google Play subscription lookup](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get)

For Apple, create an App Store Connect API key and set the Apple issuer/key/private-key/bundle fields. The backend calls App Store Server API using a transaction ID; keep `APPLE_ENVIRONMENT=sandbox` for TestFlight/sandbox and switch it to `production` for release. [Apple App Store Server API](https://developer.apple.com/documentation/appstoreserverapi)
"# tailo360-backend" 
