# Legal pages: reviews and open points

`web/legal/privacy.html` and `web/legal/terms.html` were rewritten on 2026-11-29 from two
reviews, then checked with Metranos Ltd's legal advisers, who approved them with the Pro
liability cap at the fees of the last 12 months or £10. The "draft" banner was removed from all
the legal pages then. The points below stay as a record and as the checklist for any later
change.

## Adopted

**Privacy policy**
- Website and Android app described separately.
- The controller named, with its company number.
- Cloudflare as processor, with the purpose of processing IP addresses (delivery, security,
  abuse prevention), legitimate interests as the basis, and Cloudflare's own log retention.
- Map tile providers named: OpenFreeMap, and IGN (PNOA) only for the satellite view. YouTube and
  operator sites are links only.
- Local storage listed item by item, with its purpose.
- Travellers' reports called **pseudonymous, not anonymous**, with the safeguards. The published
  output is "aggregated", not "anonymous".
- Lawful bases:
  - consent for reports;
  - legitimate interests for abuse prevention, security and support emails.
- Support emails: their purpose, and retention of 12 months after the query is closed.
- Recipients and international transfers: adequacy, including the UK–US data bridge where the
  recipient is certified, or standard contractual clauses with the UK Addendum.
- A retention list.
- The full list of data subject rights and how to withdraw consent. Pseudonymous reports can
  only be found with the in-app buttons.
- The ICO and the AEPD as authorities. A section on children under 13. A section on changes.
- Google Play:
  - an independent controller;
  - the app receives only Pro's on/off status;
  - aggregated statistics;
  - reviews, which include the name shown in Play.
- The phone's country (SIM or network), read on the phone only.

**Terms**
- The contracting entity (Metranos Ltd) and acceptance.
- "Not an official railway information system".
- Accuracy: no warranty, and not proof for compensation claims.
- A strengthened safety section: no operations, track-access or personal-safety decisions;
  reports are unverified even when many agree; 999 and 112.
- Third-party data and services, including mapping, Cloudflare and Google Play.
- Not affiliated: UK bodies added (Network Rail, National Rail / RDG, TfL, Translink).
- Acceptable use: no scraping, bulk use, hotlinking or redistribution of the data our servers
  serve, and no bypassing limits or Play Integrity. The underlying open data stays available
  from its sources under its own licences.
- Travellers' reports:
  - the rules;
  - our right to hide, remove, block, change thresholds or suspend;
  - a licence to Metranos Ltd to process, aggregate and display reports, without identifying
    users publicly.
- Intellectual property: the code is MIT or Apache 2.0; the brand, logos, graphics and texts
  belong to Metranos Ltd or their owners; data under its own licences.
- Subscriptions:
  - renewal, cancellation and price changes;
  - refunds through Google Play plus statutory rights against Metranos Ltd;
  - Pro's dependence on third-party data;
  - changes to Pro.
- Availability: free features can change or stop without notice. **The 60-day notice and the
  pro-rata refund now apply to Pro only** (review 2: free features depend on upstream feeds).
- Suspension. Limitation of liability, with the statutory carve-outs and a cap for Pro.
- A narrow misuse clause. Consumer rights. Changes to the terms.
- Courts: a consumer can also sue where they live (Scotland, NI, Spain, EU).

## Points raised for the solicitor

1. **The liability cap for Pro** (fees in the last 12 months, or £10 if greater; approved): fair under the
   Consumer Rights Act 2015 for digital content?
2. **The exclusion list for the free service** (missed trains, travel costs, rejected claims,
   indirect loss): acceptable under the CRA s. 62 fairness test, and under Spanish consumer law
   for Spanish users?
3. **The misuse clause** (s. 14): narrow enough not to be unfair?
4. **PECR / LSSI and the website's visit counter.** It exists only to show the "get the app"
   banner from the 3rd visit. It may not count as "strictly necessary". If it doesn't, the
   simplest fix is technical: show the banner until it's dismissed and keep only the dismissal
   (no counter). That change is ready to make on request.
5. **International transfers:**
   - Confirm Cloudflare's DPA (SCCs with the UK Addendum, and Data Privacy Framework / UK
     Extension certification).
   - Confirm that Google's terms cover Play Integrity.
6. **ICO data protection fee:** Metranos Ltd should check whether it's registered, and pay if
   not. This is needed once travellers' reports or support emails are handled.
7. **DPIA** for travellers' reports, before `REPORTS_ENABLED=true`.
8. **EU representatives:** not needed while reports are UK only. The website serves EU users,
   but only Cloudflare processes their technical data. Confirm Art. 27 doesn't bite for that
   alone.
9. **The registered office:** the provider page says "128 City Road, London, EC1V 2NX". Check it
   matches Companies House and the Google Play developer profile exactly (one review saw
   "124-128 City Road").

## Not adopted, and why

- **A broad indemnity:** reviewer 1 warned it can be unfair for consumers, so only a narrow
  misuse clause was kept.
- **"Exempt from consent under PECR reg. 6 / LSSI art. 22.2" for all local storage** (review 2):
  not stated as a fact, because of point 4. The policy describes the purpose instead.
