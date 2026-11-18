"""Run via: python -m northbank.mcp_server (stdio; no stdout logging)."""
from __future__ import annotations

from typing import Annotated, Any, Callable

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from .domain import CATEGORY_CRITERIA
from .store import audit
from .tools import (
    check_member_case_history_impl,
    check_recent_transactions_impl,
    create_case_impl,
    lookup_fixture_and_ticket_impl,
    lookup_member_impl,
    search_kb_impl,
)

mcp = FastMCP("northbank")


def _run_audited(event: str, inputs: dict[str, Any], fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    try:
        result = fn()
    except Exception as e:
        result = {"status": "error", "reason": str(e)}
    audit(event, inputs, result)
    return result


def _parse_int(raw: Any, default: int) -> int:
    try:
        return int(raw if raw is not None else default)
    except (TypeError, ValueError):
        return default


@mcp.tool()
def lookup_member(email: str = "", member_id: str = "", name: str = "") -> dict[str, Any]:
    """Find a member by exact email, member ID, or unique full name; no fuzzy matching. Returns a unique match or no_match."""
    inputs = {"email": email, "member_id": member_id, "name": name}
    return _run_audited(
        "lookup_member",
        inputs,
        lambda: lookup_member_impl(email=email, member_id=member_id, name=name),
    )


@mcp.tool()
def search_kb(query: str, limit: int = 3) -> dict[str, Any]:
    """Search approved local help articles. Only article content here can support member-facing facts."""
    inputs = {"query": query, "limit": limit}
    return _run_audited("search_kb", inputs, lambda: search_kb_impl(query=query, limit=limit))


@mcp.tool()
def create_case(
    member_id: str,
    category: Annotated[
        str,
        Field(description="Case category.", json_schema_extra={"enum": sorted(CATEGORY_CRITERIA.keys())}),
    ],
    summary: str,
) -> dict[str, Any]:
    """PROPOSE (never write) a Member Services case. Requires exact matching member ID. Staff approval is mandatory."""
    inputs = {"member_id": member_id, "category": category, "summary": summary}
    return _run_audited(
        "create_case",
        inputs,
        lambda: create_case_impl(member_id=member_id, category=category, summary=summary),
    )


@mcp.tool()
def check_member_case_history(member_id: str) -> dict[str, Any]:
    """Read approved case history, policy eligibility, and away ballot standing for an exact matched member ID."""
    inputs = {"member_id": member_id}
    return _run_audited("check_member_case_history", inputs, lambda: check_member_case_history_impl(member_id=member_id))


@mcp.tool()
def lookup_fixture_and_ticket(member_id: str, fixture_query: str = "") -> dict[str, Any]:
    """Look up upcoming match tickets, Ticket Exchange cutoff status, and adult upgrade differential for a matched member."""
    inputs = {"member_id": member_id, "fixture_query": fixture_query}
    return _run_audited(
        "lookup_fixture_and_ticket",
        inputs,
        lambda: lookup_fixture_and_ticket_impl(member_id=member_id, fixture_query=fixture_query),
    )


@mcp.tool()
def check_recent_transactions(member_id: str, limit: int = 5) -> dict[str, Any]:
    """Read recent billing ledger transactions and duplicate pending hold status for a matched member."""
    inputs = {"member_id": member_id, "limit": limit}
    return _run_audited(
        "check_recent_transactions",
        inputs,
        lambda: check_recent_transactions_impl(member_id=member_id, limit=limit),
    )


# Derive Anthropic API tool schemas directly from the registered FastMCP tools (single source of truth).
TOOL_SCHEMAS: list[dict[str, Any]] = [
    {"name": t.name, "description": t.description, "input_schema": t.parameters}
    for t in mcp._tool_manager.list_tools()
]

_DISPATCH: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "lookup_member": lambda i: lookup_member(
        email=str(i.get("email", "")),
        member_id=str(i.get("member_id", "")),
        name=str(i.get("name", "")),
    ),
    "search_kb": lambda i: search_kb(
        query=str(i.get("query", "")),
        limit=_parse_int(i.get("limit", 3), 3),
    ),
    "create_case": lambda i: create_case(
        member_id=str(i.get("member_id", "")),
        category=str(i.get("category", "")),
        summary=str(i.get("summary", "")),
    ),
    "check_member_case_history": lambda i: check_member_case_history(member_id=str(i.get("member_id", ""))),
    "lookup_fixture_and_ticket": lambda i: lookup_fixture_and_ticket(
        member_id=str(i.get("member_id", "")),
        fixture_query=str(i.get("fixture_query", "")),
    ),
    "check_recent_transactions": lambda i: check_recent_transactions(
        member_id=str(i.get("member_id", "")),
        limit=_parse_int(i.get("limit", 5), 5),
    ),
}


def dispatch_tool(name: str, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Canonical audited tool dispatcher for in-process tool-calling adapters."""
    handler = _DISPATCH.get(name)
    return handler(tool_input) if handler else {"status": "error", "reason": f"Unknown tool: {name}"}


if __name__ == "__main__":
    mcp.run(transport="stdio")
