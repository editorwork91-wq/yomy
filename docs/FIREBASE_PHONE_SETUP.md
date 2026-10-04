# YOMY Firebase Phone Authentication — Beginner Setup

This branch uses Firebase Web Phone Auth for optional phone-number verification. Supabase remains YOMY's primary account/session system.

## 1. Create or open the Firebase project

Open https://console.firebase.google.com/

Create a Firebase project or select the project you want to use for YOMY.

Then add a Web app from the Firebase project overview. Firebase gives you a configuration object containing values such as:

- apiKey
- authDomain
- projectId
- storageBucket
- messagingSenderId
- appId

These are project/app identifiers used by the client SDK. They are not equivalent to a service-account private key.

## 2. Enable Phone Authentication

In Firebase:

1. Go to Authentication.
2. Open Sign-in method.
3. Enable Phone.
4. Open Settings and configure the SMS region policy.
5. For an Egypt-first launch, allow Egypt (EG) before testing real Egyptian numbers.

Firebase's phone-auth documentation notes that new projects may have no SMS regions enabled by default.

## 3. Add the YOMY web configuration to the frontend

Create environment variables for the web application:

VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

Do not put a Firebase service-account private key in the frontend.

For Vercel, add these variables to the YOMY project's Environment Variables and rebuild.

For local development, put them in the local .env file and never commit real secrets.

## 4. Authorize the production domain

Go to:

Authentication → Settings → Authorized domains

Add the HTTPS domain where the YOMY web application is actually served.

Phone Auth uses Firebase reCAPTCHA to protect SMS requests. Firebase requires the request to come from an authorized domain.

For real phone testing, use an HTTPS/staging deployment rather than depending on a local development URL.

## 5. Use Firebase test phone numbers first

Go to:

Authentication → Sign-in method → Phone → Phone numbers for testing

Add a fictional test phone number and a 6-digit code.

This is the safest first test because Firebase does not send a real SMS for the fictional test number and it avoids consuming SMS quota during development.

Do not hard-code a fictional production test number into YOMY.

## 6. Configure the server-side Firebase verification value

YOMY does not trust a phone number merely because the browser says "verified".

After Firebase Phone Auth confirms the SMS code, YOMY obtains a Firebase ID token and sends it to the Supabase Edge Function.

The Edge Function validates that Firebase token through Firebase Authentication's REST accounts lookup endpoint and checks that the returned phone number exactly matches the requested E.164 number.

The Edge Function therefore needs the Firebase Web API Key as the Supabase function secret:

FIREBASE_WEB_API_KEY

Use the Web API Key from the same Firebase project's web configuration.

Set it in the Supabase project's Edge Function secrets. It is used only by the server-side verification request.

## 7. Android package name

YOMY's Capacitor app ID is:

com.yomy.app

This is the Android package/application ID used by the generated Android project.

You may register an Android app with the same package name in Firebase Project Settings → Your apps.

Important: the current YOMY implementation uses the Firebase Web Auth SDK for phone verification, not the native Android Firebase Auth SDK. Therefore this phase is deliberately not tied to Google Play Services and can use the web reCAPTCHA route on devices without GMS.

If YOMY later moves phone authentication to the native Android Firebase Auth SDK, add the app's SHA-1 and SHA-256 fingerprints in Firebase Project Settings. Firebase documents SHA-1 as required for the reCAPTCHA fallback used by native phone auth on devices without Google Play services.

## 8. What happens inside YOMY

When the user leaves the phone field empty:

- YOMY creates the account normally with Supabase email/password.
- No phone provider is required.

When the user enters a phone number:

- YOMY normalizes it to E.164.
- YOMY checks that the number is still eligible for another linked account.
- Firebase Phone Auth starts SMS verification.
- Firebase protects the request with reCAPTCHA.
- The user enters the 6-digit code.
- YOMY receives a Firebase ID token.
- The Supabase Edge Function validates the Firebase token and creates a short-lived YOMY verification nonce.
- Only that nonce can be used to create the Supabase account with the verified phone number.
- The nonce is consumed atomically, so it cannot be replayed after successful account creation.

## 9. Cost and abuse protection

Real phone verification is not the same as Firebase's fictional test-number mode.

Firebase currently documents Phone Auth SMS as a usage-limited/billable area depending on the Firebase plan and service. The Firebase Authentication limits page also documents per-IP, per-project, and per-phone-number throttling.

For early development:

- use Firebase fictional test numbers;
- enable an SMS region policy;
- keep the phone field optional;
- do not repeatedly request SMS codes while debugging.

## 10. Twilio status

Twilio is no longer part of the YOMY phone-verification code path.

The application no longer calls Twilio Verify.

After deploying this branch, any old TWILIO_* Edge Function secrets can be removed from the Supabase project manually once you have confirmed that no other project/function uses them.

## Official documentation

Firebase Web setup:
https://firebase.google.com/docs/web/setup

Firebase Web Phone Auth:
https://firebase.google.com/docs/auth/web/phone-auth

Firebase Android Phone Auth:
https://firebase.google.com/docs/auth/android/phone-auth

Firebase Auth REST API:
https://firebase.google.com/docs/reference/rest/auth

Firebase pricing:
https://firebase.google.com/pricing

Firebase Auth limits:
https://firebase.google.com/docs/auth/limits
