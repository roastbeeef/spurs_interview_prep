"""Testable business logic. MCP wrappers only expose these functions."""
from __future__ import annotations

from collections import Counter
from datetime import date
import math
import re
import uuid
from typing import Any

from .domain import ALLOWED_CASE_CATEGORIES, extract_member_id, extract_ticket_id
from .store import (
    find_member,
    fixtures,
    get_kb_articles,
    load_tickets,
    member_cases,
    members,
    transactions,
)

STOPWORDS = frozenset(
    {
        "i",
        "a",
        "an",
        "the",
        "to",
        "is",
        "are",
        "my",
        "me",
        "we",
        "our",
        "and",
        "or",
        "in",
        "on",
        "for",
        "of",
        "how",
        "can",
        "do",
        "what",
        "when",
        "be",
        "with",
        "this",
        "that",
        "from",
        "have",
        "it",
    }
)


def _homonym_ids_for_member(member: dict[str, str], all_members: list[dict[str, str]]) -> list[str]:
    """Return other member IDs sharing the exact same normalised full name."""
    full_name = str(member.get("name", "")).strip().lower()
    if not full_name:
        return []
    mid = str(member.get("member_id", "")).strip().upper()
    return [
        str(m.get("member_id", "")).strip()
        for m in all_members
        if str(m.get("name", "")).strip().lower() == full_name
        and str(m.get("member_id", "")).strip().upper() != mid
    ]


def lookup_member_impl(email: str = "", member_id: str = "", name: str = "") -> dict[str, Any]:
    """Exact, unique matching only; never fuzzy-match a member."""
    email_norm = email.strip().lower()
    member_id_norm = member_id.strip().lower()
    name_norm = " ".join(name.strip().lower().split())
    if not email_norm and not member_id_norm and not name_norm:
        return {"status": "no_match", "reason": "Supply email, member ID, or exact full name", "ambiguous": False}

    all_members = members()
    matches = [
        m
        for m in all_members
        if (not email_norm or m.get("email", "").strip().lower() == email_norm)
        and (not member_id_norm or m.get("member_id", "").strip().lower() == member_id_norm)
        and (not name_norm or " ".join(m.get("name", "").strip().lower().split()) == name_norm)
    ]
    if len(matches) == 1:
        matched = matches[0]
        homonyms = _homonym_ids_for_member(matched, all_members)
        payload: dict[str, Any] = {"status": "matched", "member": matched}
        if homonyms:
            payload["homonym_member_ids"] = homonyms
        return payload

    email_matches = (
        [m for m in all_members if m.get("email", "").strip().lower() == email_norm]
        if email_norm
        else []
    )
    id_matches = (
        [m for m in all_members if m.get("member_id", "").strip().lower() == member_id_norm]
        if member_id_norm
        else []
    )
    name_matches = (
        [m for m in all_members if " ".join(m.get("name", "").strip().lower().split()) == name_norm]
        if name_norm
        else []
    )
    ambiguous = (
        len(matches) > 1
        or (bool(email_matches) and bool(id_matches))
        or (bool(name_matches) and (bool(email_matches) or bool(id_matches)))
    )
    return {
        "status": "no_match",
        "reason": "No unique exact match (or conflicting identifiers)",
        "ambiguous": ambiguous,
    }


def _tokenise_features(text: str) -> list[str]:
    features: list[str] = []
    for token in re.findall(r"[a-z0-9]+", text.lower()):
        if token in STOPWORDS:
            continue
        features.append(token)
        if len(token) > 4:
            features.append(token[:4])
    return features


def _embed_text(
    tokens: list[str],
    idf: dict[str, float],
    default_idf: float = 1.0,
) -> dict[str, float]:
    if not tokens:
        return {}
    counts = Counter(tokens)
    weighted = {term: count * idf.get(term, default_idf) for term, count in counts.items()}
    norm = math.sqrt(sum(w * w for w in weighted.values()))
    if norm <= 0.0:
        return {}
    return {term: w / norm for term, w in weighted.items()}


def _cosine_similarity(vec_a: dict[str, float], vec_b: dict[str, float]) -> float:
    if not vec_a or not vec_b:
        return 0.0
    if len(vec_a) > len(vec_b):
        vec_a, vec_b = vec_b, vec_a
    return sum(weight * vec_b.get(term, 0.0) for term, weight in vec_a.items())


def search_kb_impl(query: str, limit: int = 3, min_score: float = 0.08) -> dict[str, Any]:
    """In-memory vector-store retrieval using TF-IDF embeddings and cosine similarity."""
    articles = get_kb_articles()
    if not articles:
        return {"articles": []}

    doc_tokens = {aid: _tokenise_features(content) for aid, content in articles.items()}
    num_docs = len(doc_tokens)

    df: Counter[str] = Counter()
    for tokens in doc_tokens.values():
        df.update(set(tokens))

    idf = {term: math.log((1 + num_docs) / (1 + count)) + 1.0 for term, count in df.items()}
    default_idf = math.log(1 + num_docs) + 1.0

    query_vec = _embed_text(_tokenise_features(query), idf, default_idf=default_idf)
    if not query_vec:
        return {"articles": []}

    hits: list[dict[str, Any]] = []
    for article_id, content in articles.items():
        doc_vec = _embed_text(doc_tokens[article_id], idf, default_idf=default_idf)
        similarity = _cosine_similarity(query_vec, doc_vec)
        if similarity >= min_score:
            hits.append(
                {
                    "article_id": article_id,
                    "score": round(similarity, 4),
                    "content": content,
                }
            )

    bounded_limit = max(1, min(limit, 7))
    return {"articles": sorted(hits, key=lambda h: -h["score"])[:bounded_limit]}


def create_case_impl(member_id: str, category: str, summary: str) -> dict[str, Any]:
    """Proposal only: NEVER INSERT into cases here."""
    member = find_member(member_id)
    if not member:
        return {"status": "refused", "reason": "Member ID not confidently matched"}
    cat = category.strip()
    summ = summary.strip()
    if not cat or not summ:
        return {"status": "refused", "reason": "Category and summary are required"}
    if cat not in ALLOWED_CASE_CATEGORIES:
        allowed = ", ".join(sorted(ALLOWED_CASE_CATEGORIES))
        return {"status": "refused", "reason": f"Invalid category '{cat}'. Allowed: {allowed}"}
    return {
        "status": "preview",
        "preview_id": str(uuid.uuid4()),
        "member_id": member["member_id"],
        "category": cat[:80],
        "summary": summ[:1500],
        "requires_human_approval": True,
    }


REFERENCE_DATE = date(2026, 11, 2)


def _require_matched_member(member_id: str) -> dict[str, str] | None:
    mid = str(member_id or "").strip()
    return find_member(mid) if mid else None


def _safe_int(raw: Any, default: int = 0) -> int:
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return default


def _compute_tenure_years(joined_str: str) -> float | None:
    raw = joined_str.strip()
    if not raw:
        return None
    try:
        joined_dt = date.fromisoformat(raw[:10])
    except ValueError:
        return None
    return round(max(0.0, (REFERENCE_DATE - joined_dt).days / 365.25), 1)


def _compute_away_ballot_standing(
    points: int, all_members: list[dict[str, str]]
) -> tuple[int, int, int]:
    active_points = [
        _safe_int(m.get("loyalty_points"), 0)
        for m in all_members
        if str(m.get("status", "")).strip().lower() == "active"
    ]
    total_active = len(active_points)
    if total_active == 0:
        return 1, 0, 100
    rank = 1 + sum(1 for pts in active_points if pts > points)
    percentile = max(1, min(100, round(((total_active - rank + 1) / total_active) * 100)))
    return rank, total_active, percentile


def _related_tickets_for_member(member: dict[str, str]) -> list[dict[str, str]]:
    email_norm = str(member.get("email", "")).strip().lower()
    mid_norm = str(member.get("member_id", "")).strip().upper()
    related: list[dict[str, str]] = []
    for ticket in load_tickets():
        t_email = str(ticket.get("from_email") or ticket.get("from") or "").strip().lower()
        t_text = f"{ticket.get('subject', '')} {ticket.get('body', '')}"
        t_mid = extract_member_id(t_text)
        if (email_norm and t_email == email_norm) or (mid_norm and t_mid == mid_norm):
            related.append(
                {
                    "ticket_id": extract_ticket_id(ticket),
                    "subject": str(ticket.get("subject", "")),
                    "received_at": str(ticket.get("received_at", "")),
                }
            )
    return related


def check_member_case_history_impl(member_id: str) -> dict[str, Any]:
    """Read approved SQLite case history, policy eligibility, ballot standing, and related tickets."""
    member = _require_matched_member(member_id)
    if not member:
        return {
            "status": "no_match",
            "member_id": None,
            "reason": "Member ID not uniquely matched",
            "cases": [],
            "total_cases": 0,
        }

    all_members = members()
    cases = member_cases(member["member_id"])

    account_status = str(member.get("status", "")).strip().lower()
    tier = str(member.get("tier", "")).strip()
    joined = str(member.get("joined", "")).strip()
    renewal_date = str(member.get("renewal_date", "")).strip()
    loyalty_points = _safe_int(member.get("loyalty_points"), 0)
    away_rank, away_total, away_pct = _compute_away_ballot_standing(loyalty_points, all_members)
    reinstatement_eligible = account_status == "lapsed" and renewal_date.startswith("2026-")

    return {
        "status": "matched",
        "member_id": member["member_id"],
        "cases": cases,
        "total_cases": len(cases),
        "joined": joined or None,
        "tenure_years": _compute_tenure_years(joined),
        "account_status": account_status or "unknown",
        "tier": tier,
        "loyalty_points": loyalty_points,
        "away_ballot_rank": away_rank,
        "away_ballot_active_total": away_total,
        "away_ballot_percentile": away_pct,
        "reinstatement_eligible": reinstatement_eligible,
        "reinstatement_deadline": "2026-12-31" if reinstatement_eligible else None,
        "requires_guardian_approval": tier.lower() == "junior",
        "is_suspended": account_status == "suspended",
        "points_at_risk_on_cancel": loyalty_points,
        "homonym_member_ids": _homonym_ids_for_member(member, all_members),
        "related_tickets": _related_tickets_for_member(member),
    }


def _to_number(raw: str | None, default: float = 0.0) -> int | float:
    val = float(raw or default)
    return int(val) if val.is_integer() else round(val, 2)


def lookup_fixture_and_ticket_impl(member_id: str, fixture_query: str = "") -> dict[str, Any]:
    """Look up upcoming match tickets, Ticket Exchange cutoffs, and upgrade differentials."""
    member = _require_matched_member(member_id)
    if not member:
        return {
            "status": "no_match",
            "member_id": None,
            "reason": "Member ID not uniquely matched",
            "tickets": [],
        }

    mid_upper = member["member_id"].upper()
    member_tickets: list[dict[str, Any]] = []
    for row in fixtures():
        if str(row.get("member_id", "")).strip().upper() != mid_upper:
            continue
        hours_until = float(row.get("hours_until_kickoff") or 0.0)
        cutoff_hours = float(row.get("exchange_cutoff_hours") or 4.0)
        match_status = str(row.get("match_status", "")).strip()
        exchange_eligible = str(row.get("exchange_eligible", "")).strip().lower() in {"true", "1", "yes"}
        member_tickets.append(
            {
                "fixture_id": str(row.get("fixture_id", "")).strip(),
                "member_id": member["member_id"],
                "opponent": str(row.get("opponent", "")).strip(),
                "kickoff": str(row.get("kickoff", "")).strip(),
                "match_status": match_status,
                "hours_until_kickoff": _to_number(row.get("hours_until_kickoff"), 0.0),
                "ticket_type": str(row.get("ticket_type", "")).strip(),
                "fixture_category": str(row.get("fixture_category", "")).strip(),
                "seating_block": str(row.get("seating_block", "")).strip(),
                "exchange_eligible": exchange_eligible,
                "exchange_cutoff_hours": _to_number(row.get("exchange_cutoff_hours"), 4.0),
                "within_exchange_cutoff": (
                    hours_until <= cutoff_hours or match_status.lower() == "postponed"
                ),
                "adult_upgrade_differential_gbp": round(
                    float(row.get("adult_upgrade_differential_gbp") or 0.0), 2
                ),
            }
        )

    q = str(fixture_query or "").strip().lower()
    if q and member_tickets:
        tokens = [t for t in re.findall(r"[a-z0-9-]+", q) if len(t) >= 3 and t not in STOPWORDS]
        if tokens:
            narrowed = [
                item
                for item in member_tickets
                if any(
                    tok
                    in " ".join(
                        [
                            item["fixture_id"],
                            item["opponent"],
                            item["ticket_type"],
                            item["seating_block"],
                        ]
                    ).lower()
                    for tok in tokens
                )
            ]
            if narrowed:
                member_tickets = narrowed

    return {
        "status": "matched",
        "member_id": member["member_id"],
        "tickets": member_tickets,
    }


def check_recent_transactions_impl(member_id: str, limit: int = 5) -> dict[str, Any]:
    """Read recent billing ledger transactions and flag duplicate pending holds."""
    member = _require_matched_member(member_id)
    if not member:
        return {
            "status": "no_match",
            "member_id": None,
            "reason": "Member ID not uniquely matched",
            "transactions": [],
            "has_duplicate_pending": False,
            "pending_total_gbp": 0.0,
        }

    mid_upper = member["member_id"].upper()
    all_member_txs: list[dict[str, Any]] = []
    for row in transactions():
        if str(row.get("member_id", "")).strip().upper() != mid_upper:
            continue
        all_member_txs.append(
            {
                "transaction_id": str(row.get("transaction_id", "")).strip(),
                "member_id": member["member_id"],
                "timestamp": str(row.get("timestamp", "")).strip(),
                "amount_gbp": round(float(row.get("amount_gbp") or 0.0), 2),
                "currency": str(row.get("currency", "GBP")).strip() or "GBP",
                "description": str(row.get("description", "")).strip(),
                "status": str(row.get("status", "")).strip(),
                "payment_method": str(row.get("payment_method", "")).strip(),
            }
        )

    all_member_txs.sort(key=lambda t: t["timestamp"], reverse=True)
    bounded_limit = max(1, min(int(limit), 20))
    member_txs = all_member_txs[:bounded_limit]
    pending_rows = [t for t in all_member_txs if "pending" in t["status"].lower()]
    pending_total_gbp = round(sum(t["amount_gbp"] for t in pending_rows), 2)
    has_duplicate_pending = len(pending_rows) >= 2 or any(
        "duplicate" in t["status"].lower() for t in pending_rows
    )

    return {
        "status": "matched",
        "member_id": member["member_id"],
        "transactions": member_txs,
        "has_duplicate_pending": has_duplicate_pending,
        "pending_total_gbp": pending_total_gbp,
    }
