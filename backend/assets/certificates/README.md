# Supabase database CA

`supabase-prod-ca-2021.crt` is the public production CA published by Supabase, downloaded on 2026-11-18 from:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

The download URL is defined in Supabase's official dashboard configuration:
https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json

SHA-256 certificate fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.

Expires 2031-04-26. Update deliberately if Supabase rotates its database CA. The connector uses it only for Supabase-owned database endpoints, with full hostname verification. Other hosts retain system certificate trust.
