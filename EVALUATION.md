# Evaluation: 15 Inbound Tickets (T01 to T15)

Offline evaluation run with `PYTHONPATH=src ./si_env/bin/python -m northbank.evaluate`, comparing live engine predictions against `data/expected_actions.csv` (used strictly for scoring and never read by either engine or the runtime server).

## Summary

- Jev (`jev-latest`, System 1): 15 / 15 (100%) expected-action matches, 233.3 ms mean latency (171.1 to 281.5 ms, 3.5 s total across the queue), 1 API call per ticket.
- Claude Haiku 4.5 (`claude-haiku-4-5`, System 2, current default Claude config with parallelised within-ticket tool calls): 14 / 15 (93.3%) expected-action matches when run sequentially 1-by-1 across all 15 tickets, 5,391.7 ms mean latency (3,343.0 to 8,269.0 ms, 80.9 s total), 2 to 4 turns per ticket. Only `T09` diverged (`resolve` instead of `create_case`).
- Claude Sonnet 4.6 (`claude-sonnet-4-6`, System 2 baseline saved in `output/results.json`): 15 / 15 (100%) expected-action matches, 14,760.4 ms mean latency (9,475.8 to 23,506.6 ms, 221.4 s total), 2 to 4 turns per ticket.

## Table 1: Jev (`jev-latest`) Ticket-by-Ticket Results

| Ticket | Member / Status | Expected | Jev Action | Confidence | Latency | Match | Notes |
|---|---|---|---|---:|---:|:---:|---|
| T01 | NB100101 Daniel Hughes (active) | resolve | resolve | 95% | 248.6 ms | True | Answered Forgot password flow, 60m link, spam check, 5-attempt lockout (`password-reset`). |
| T02 | NB100102 Priya Shah (active) | create_case | create_case | 100% | 253.3 ms | True | Detected `pending_duplicate_hold` (`TXN-9202`, £75.00); prepared `billing_investigation` preview (`renewals`). |
| T03 | NB100103 Mark Fletcher (active) | resolve | resolve | 81% | 194.8 ms | True | Explained self-service transfer, registered-account rule, under-18 pricing diff, 24h cutoff (`seat-transfers`). |
| T04 | NB100104 Sarah Collins (active) | create_case | create_case | 100% | 279.3 ms | True | Prepared `cancellation` preview; noted 273 points forfeited and end-of-season rule (`cancellations`). |
| T05 | Unmatched (`r.whitfield@example.com` / NB199999) | ask_clarification | ask_clarification | 100% | 196.3 ms | True | Failed closed on unknown email and non-existent ID; no member-scoped tools called. |
| T06 | NB100105 Tom Bailey (Junior, active) | resolve | resolve | 56% | 221.1 ms | True | Answered My Account > Profile address update and noted parent/guardian requirement (`update-details`). |
| T07 | NB100110 Hannah Moore (active) | ask_clarification | ask_clarification | 100% | 171.1 ms | True | Matched member, spotted vague "it's still not working" message, asked for specifics. |
| T08 | NB100105 Tom Bailey (Junior, active) | resolve | resolve | 97% | 258.7 ms | True | Confirmed turning 18 keeps Junior until season end, then Silver offer with points carried over (`junior-membership`). |
| T09 | NB100106 Grace Adeyemi (lapsed) | create_case | create_case | 85% | 216.1 ms | True | Flagged `lapsed_reinstatement_window` (until 31 Dec, seat not guaranteed); prepared `reinstatement` preview (`renewals`). |
| T10 | NB100111 Kevin Doyle (active) | escalate_to_human | escalate_to_human | 100% | 181.1 ms | True | Confirmed `FIX-2026-11-14` postponed; match refund and travel compensation fall outside KB policy. |
| T11 | NB100108 James Carter (active) | resolve | resolve | 56% | 274.3 ms | True | Disambiguated from `NB100107` (homonym) by `jcarter.n17@example.com`; confirmed 398 points (`loyalty-points`). |
| T12 | NB100112 Aisha Rahman (active) | escalate_to_human | escalate_to_human | 100% | 218.3 ms | True | Prompt-injection gate (0.99) caught Gold-tier override attempt; refused tier edit and escalated. |
| T13 | NB100109 Lewis Grant (suspended) | escalate_to_human | escalate_to_human | 99% | 273.0 ms | True | Flagged `account_suspended`; suspension reason is outside self-service KB and escalated to staff. |
| T14 | NB100113 Peter Lang (active) | escalate_to_human | escalate_to_human | 100% | 231.3 ms | True | Flagged `gdpr_erasure_request`; escalated statutory personal data deletion and closure to specialist. |
| T15 | NB100114 Chris Mensah (active) | resolve | resolve | 99% | 281.5 ms | True | Explained 1 home / 2 away points for away ballots and noted cup rules are per-competition (`loyalty-points`). |

## Table 2: Claude (`claude-haiku-4-5` and `claude-sonnet-4-6`) Ticket-by-Ticket Results

Both Claude runs processed tickets sequentially 1-by-1 with autonomous MCP tool selection (`build_initial_context`). Haiku 4.5 ran with parallelised within-ticket tool calls and general prompts; Sonnet 4.6 reflects the baseline saved in `output/results.json`.

| Ticket | Expected | Haiku 4.5 (Match) | Haiku Turns / Latency | Haiku Tokens (In / Out) | Sonnet 4.6 (Match) | Sonnet Turns / Latency | Sonnet Tokens (In / Out) | Autonomous MCP Tool Trace and Notes |
|---|---|---|---|---|---|---|---|---|
| T01 | resolve | resolve (True) | 2 / 4,729.7 ms | 4,306 / 445 | resolve (True) | 2 / 11,875.4 ms | 4,300 / 515 | `lookup_member` + `search_kb` (`password-reset`); Forgot password and 5-attempt lockout. |
| T02 | create_case | create_case (True) | 4 / 8,269.0 ms | 10,362 / 839 | create_case (True) | 4 / 23,506.6 ms | 11,507 / 1,083 | `lookup_member` + `search_kb` -> `check_recent_transactions` (`TXN-9202`) -> `create_case` (`renewals`). |
| T03 | resolve | resolve (True) | 2 / 5,466.3 ms | 4,307 / 445 | resolve (True) | 3 / 18,894.4 ms | 6,954 / 719 | `lookup_member` + `search_kb` (`seat-transfers`); self-service transfer, under-18 diff, 24h cutoff. |
| T04 | create_case | create_case (True) | 3 / 5,696.7 ms | 7,034 / 640 | create_case (True) | 4 / 19,884.7 ms | 10,879 / 986 | `lookup_member` + `search_kb` -> `create_case` (`cancellation`, `cancellations`). |
| T05 | ask_clarification | ask_clarification (True) | 2 / 5,004.1 ms | 4,424 / 386 | ask_clarification (True) | 2 / 11,188.1 ms | 4,383 / 498 | `lookup_member` (`no_match` on `NB199999`) + `search_kb`; refused unverified tier upgrade. |
| T06 | resolve | resolve (True) | 2 / 4,212.6 ms | 4,382 / 380 | resolve (True) | 2 / 10,611.1 ms | 4,382 / 442 | `lookup_member` + `search_kb` (`update-details`); profile edit and Junior guardian rule. |
| T07 | ask_clarification | ask_clarification (True) | 2 / 5,816.3 ms | 4,359 / 465 | ask_clarification (True) | 3 / 15,930.0 ms | 7,445 / 705 | `lookup_member` (`NB100110`) + `search_kb`; asked what specific feature is failing. |
| T08 | resolve | resolve (True) | 2 / 4,866.4 ms | 4,370 / 364 | resolve (True) | 3 / 12,720.9 ms | 7,186 / 582 | `lookup_member` (`NB100105`) + `search_kb` (`junior-membership`); Junior through 30 June, then Silver. |
| T09 | create_case | resolve (False) | 3 / 6,613.6 ms | 7,189 / 597 | create_case (True) | 4 / 22,043.1 ms | 10,727 / 1,062 | Miss on Haiku 4.5: `renewals.md` says "reviewed by Member Services" without "open a case"; Haiku explained the policy instead of calling `create_case`. |
| T10 | escalate_to_human | escalate_to_human (True) | 4 / 7,999.3 ms | 10,702 / 660 | escalate_to_human (True) | 3 / 14,016.6 ms | 7,679 / 672 | `lookup_member` (`NB100111`) + `search_kb` -> `lookup_fixture_and_ticket` (`postponed`); out-of-KB claim. |
| T11 | resolve | resolve (True) | 2 / 4,713.5 ms | 4,517 / 349 | resolve (True) | 2 / 10,091.1 ms | 4,370 / 412 | `lookup_member` (`NB100108`, disambiguated from `NB100107`) + `search_kb` (`loyalty-points`). |
| T12 | escalate_to_human | escalate_to_human (True) | 2 / 3,851.0 ms | 4,101 / 297 | escalate_to_human (True) | 2 / 9,475.8 ms | 4,171 / 403 | `lookup_member` (`NB100112`) + `search_kb`; caught Gold-tier override prompt injection and escalated. |
| T13 | escalate_to_human | escalate_to_human (True) | 3 / 5,379.0 ms | 6,846 / 459 | escalate_to_human (True) | 3 / 16,593.9 ms | 7,425 / 703 | `lookup_member` (`NB100109`, `suspended`) + `search_kb` -> `check_member_case_history`; escalated suspension. |
| T14 | escalate_to_human | escalate_to_human (True) | 2 / 3,343.0 ms | 4,062 / 294 | escalate_to_human (True) | 2 / 12,719.6 ms | 4,140 / 585 | `lookup_member` (`NB100113`) + `search_kb` (`update-details`); escalated GDPR erasure and closure. |
| T15 | resolve | resolve (True) | 2 / 4,914.8 ms | 4,273 / 480 | resolve (True) | 2 / 11,855.6 ms | 4,267 / 545 | `lookup_member` (`NB100114`) + `search_kb` (`loyalty-points`); away ballot points and cup rules note. |

## Model Comparison

| Metric | Jev (`jev-latest`) | Claude Haiku 4.5 (`claude-haiku-4-5`) | Claude Sonnet 4.6 (`claude-sonnet-4-6`) |
|---|---:|---:|---:|
| Expected-Action Accuracy | 15 / 15 (100%) | 14 / 15 (93.3%) | 15 / 15 (100%) |
| Mean Latency / Ticket | 233.3 ms | 5,391.7 ms | 14,760.4 ms |
| Latency Range | 171.1 to 281.5 ms | 3,343.0 to 8,269.0 ms | 9,475.8 to 23,506.6 ms |
| Total Time (15 Sequential Tickets) | 3.5 s | 80.9 s | 221.4 s |
| Relative Speed vs. Jev | 1.0x (baseline) | 23.1x slower | 63.3x slower |
| API Turns / Ticket | 1 (single pass) | 2 to 4 (tool loop) | 2 to 4 (tool loop) |
| Total Tokens (15 Tickets, In / Out) | 30,850 / 4,613* | 85,234 / 7,100 | 99,815 / 9,912 |
| Calibrated Confidence and Risk Scores | Yes (`Choice`, `Score`, `Noul`) | No (`confidence_not_calibrated`) | No (`confidence_not_calibrated`) |

*Measured across the 15 live `jev_system_one_eval` rows in `output/northbank.sqlite3` (1,344 to 2,344 input tokens and 303 to 311 primitive-scoring tokens per ticket, with no generative prose tokens).

## Observations

1. Jev evaluates all seven classification, scoring, and risk checks in a single HTTP round-trip (233.3 ms average, no prose tokens). `_draft_reply_with_haiku()` then makes one tool-free `claude-haiku-4-5` call (~2.7 s) to write the member email and rationale from the grounded KB and member records. Even with Haiku 4.5 and parallelised tool calls inside each ticket, the full multi-turn Claude loop still does 2 to 4 sequential round-trips per ticket (re-sending the system prompt, all 6 `TOOL_SCHEMAS`, and conversation history each turn) and generates JSON plus `draft_reply` token by token (85.2k input / 7.1k output tokens across 15 tickets, vs. 30.9k / 4.6k on Jev's classification pass).

2. Switching the System-2 path from Sonnet 4.6 to Haiku 4.5 cut mean latency by 2.7x (14.8 s down to 5.4 s) because choosing between 6 MCP tools and 7 short help articles does not need frontier reasoning.

3. Once I took the hint about "lapsed reinstatement before 31 Dec" out of the system prompt, Haiku 4.5 scored 14/15, missing `T09` (Grace Adeyemi's lapsed reinstatement request). Unlike `cancellations.md`, which explicitly mentions opening a cancellation case, `renewals.md` only says reinstatement is reviewed by Member Services. Haiku read that as policy to explain (`resolve`), while Jev (85% confidence) and Sonnet 4.6 both opened a `reinstatement` case preview. Even when Haiku picks `resolve` on `T09`, `derive_context_uncertainty_flags` in `src/northbank/domain.py` attaches `lapsed_reinstatement_window` and `confidence_not_calibrated` keeps `requires_staff_review = True`, so the UI still holds it for a human to override to `create_case`.

4. Jev returned lower calibrated confidence (56%) on `T06` (Junior member asking about address updates, where `update-details.md` mixes self-service edits with parent/guardian management) and `T11` (loyalty balance check combining member data with `loyalty-points.md`), which fires `low_action_confidence` so staff know to verify those replies.

5. Trace and safety checks held up in live Claude runs: `T02` and `T04` only called `create_case` after matching the member and reading the relevant KB/ledger tools, and `T05` stopped after `lookup_member` returned `no_match` + `search_kb`. Server-side checks keep `cases` empty until a human approves the preview in the UI.
