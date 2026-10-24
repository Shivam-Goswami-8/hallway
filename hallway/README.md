# Hallway: random video chat for verified students

    npm install
    EXTRA_DOMAINS=indusuni.ac.in npm start     # then open http://localhost:3000

Dev mode prints the login OTP in the terminal. Test with two browser windows
(use two different university emails; one tab can be incognito).

## Env vars
- EXTRA_DOMAINS  comma-separated allowed email domains
- TURN_URL / TURN_USER / TURN_PASS  TURN server (needed for reliability on real networks)
- NODE_ENV=production  stops printing OTPs (wire up real email sending first)

## Next steps
1. Send OTP by email (Resend / nodemailer) and move sessions, bans, reports to Postgres/Supabase
2. HTTPS (required for camera access off localhost) and deploy (Render / Railway / Fly.io)
3. NSFW frame detection (nsfwjs) to auto-blur remote video
4. Redis queue when you run more than one server instance
