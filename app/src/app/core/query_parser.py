"""
JQL-like query parser for SceneFlow clip filtering.

Supports operators: =, !=, >, <, >=, <=, IN, NOT IN, AND, OR
Supports fields: orientation, resolution, frame_rate, is_kept, is_rejected,
                 tags, recorded_at, latitude, longitude, file_name, short_name
"""

import re
from typing import Any, ClassVar


class QueryNode:
    """Base class for query AST nodes."""


class FieldNode(QueryNode):
    """Represents a field reference."""

    def __init__(self, field: str):
        self.field = field

    def __repr__(self):
        return f"Field({self.field})"


class ValueNode(QueryNode):
    """Represents a literal value."""

    def __init__(self, value: Any):
        self.value = value

    def __repr__(self):
        return f"Value({self.value!r})"


class ComparisonNode(QueryNode):
    """Represents a comparison operation."""

    def __init__(self, field: str, operator: str, value: Any):
        self.field = field
        self.operator = operator
        self.value = value

    def __repr__(self):
        return f"Comparison({self.field} {self.operator} {self.value!r})"


class LogicalNode(QueryNode):
    """Represents a logical operation (AND/OR)."""

    def __init__(self, operator: str, left: QueryNode, right: QueryNode):
        self.operator = operator
        self.left = left
        self.right = right

    def __repr__(self):
        return f"Logical({self.left} {self.operator} {self.right})"


class InNode(QueryNode):
    """Represents an IN or NOT IN operation."""

    def __init__(self, field: str, operator: str, values: list[Any]):
        self.field = field
        self.operator = operator  # 'IN' or 'NOT IN'
        self.values = values

    def __repr__(self):
        return f"In({self.field} {self.operator} {self.values})"


class QueryParser:
    """Parses JQL-like query strings into an AST."""

    FIELD_TYPES: ClassVar[dict[str, type]] = {
        "orientation": str,
        "resolution": str,
        "frame_rate": float,
        "is_kept": bool,
        "is_rejected": bool,
        "tags": str,  # Special case: array of strings
        "recorded_at": str,  # ISO format datetime
        "latitude": float,
        "longitude": float,
        "file_name": str,
        "short_name": str,
    }

    # Valid operators
    OPERATORS: ClassVar[list[str]] = ["=", "!=", ">", "<", ">=", "<=", "IN", "NOT IN"]
    LOGICAL_OPERATORS: ClassVar[list[str]] = ["AND", "OR"]

    def __init__(self, query_string: str):
        self.query_string = query_string.strip()
        self.tokens = self._tokenize()
        self.pos = 0

    def _tokenize(self) -> list[str]:
        """Tokenize the query string."""
        if not self.query_string:
            return []

        # Pattern to match:
        # - Operators (=, !=, >, <, >=, <=, IN, NOT IN, AND, OR)
        # - Quoted strings ("...")
        # - Numbers (including decimals)
        # - Identifiers (field names)
        # - Parentheses
        # - Commas
        pattern = r"""
            (?P<operator>=|!=|>=|<=|>|<|IN|NOT\s+IN|AND|OR)|
            (?P<string>"[^"]*")|
            (?P<number>\d+\.?\d*)|
            (?P<boolean>true|false)|
            (?P<identifier>[a-zA-Z_][a-zA-Z0-9_]*)|
            (?P<punctuation>[(),])|
            (?P<whitespace>\s+)
        """

        tokens = []
        for match in re.finditer(pattern, self.query_string, re.VERBOSE):
            if match.group("operator"):
                tokens.append(("OPERATOR", match.group("operator").strip()))
            elif match.group("string"):
                # Remove quotes and unescape
                value = match.group("string")[1:-1]
                tokens.append(("STRING", value))
            elif match.group("number"):
                value = float(match.group("number")) if "." in match.group("number") else int(match.group("number"))
                tokens.append(("NUMBER", value))
            elif match.group("boolean"):
                tokens.append(("BOOLEAN", match.group("boolean").lower() == "true"))
            elif match.group("identifier"):
                tokens.append(("IDENTIFIER", match.group("identifier")))
            elif match.group("punctuation"):
                tokens.append(("PUNCTUATION", match.group("punctuation")))
            # Skip whitespace

        return tokens

    def _peek(self) -> tuple | None:
        """Look at the next token without consuming it."""
        if self.pos < len(self.tokens):
            return self.tokens[self.pos]
        return None

    def _consume(self, expected_type: str | None = None, expected_value: str | None = None) -> tuple:
        """Consume the next token."""
        token = self._peek()
        if token is None:
            raise ValueError("Unexpected end of query")

        if expected_type and token[0] != expected_type:
            raise ValueError(f"Expected {expected_type}, got {token[0]}")

        if expected_value and token[1] != expected_value:
            raise ValueError(f"Expected {expected_value}, got {token[1]}")

        self.pos += 1
        return token

    def parse(self) -> QueryNode:
        """Parse the query string into an AST."""
        if not self.tokens:
            raise ValueError("Empty query")

        node = self._parse_or()

        if self.pos < len(self.tokens):
            raise ValueError(f"Unexpected token at position {self.pos}")

        return node

    def _parse_or(self) -> QueryNode:
        """Parse OR expressions."""
        left = self._parse_and()

        while self._peek() and self._peek()[0] == "OPERATOR" and self._peek()[1] == "OR":
            self._consume("OPERATOR", "OR")
            right = self._parse_and()
            left = LogicalNode("OR", left, right)

        return left

    def _parse_and(self) -> QueryNode:
        """Parse AND expressions."""
        left = self._parse_comparison()

        while self._peek() and self._peek()[0] == "OPERATOR" and self._peek()[1] == "AND":
            self._consume("OPERATOR", "AND")
            right = self._parse_comparison()
            left = LogicalNode("AND", left, right)

        return left

    def _parse_comparison(self) -> QueryNode:
        """Parse comparison expressions."""
        # Check for parentheses
        if self._peek() and self._peek()[0] == "PUNCTUATION" and self._peek()[1] == "(":
            self._consume("PUNCTUATION", "(")
            node = self._parse_or()
            self._consume("PUNCTUATION", ")")
            return node

        # Parse field
        field_token = self._consume("IDENTIFIER")
        field = field_token[1]

        if field not in self.FIELD_TYPES:
            raise ValueError(f"Unknown field: {field}")

        # Parse operator
        op_token = self._consume("OPERATOR")
        operator = op_token[1]

        if operator not in self.OPERATORS:
            raise ValueError(f"Unknown operator: {operator}")

        # Parse value(s)
        if operator in ["IN", "NOT IN"]:
            # Parse list of values
            self._consume("PUNCTUATION", "(")
            values = []
            while True:
                value = self._parse_value()
                values.append(value)

                if self._peek() and self._peek()[0] == "PUNCTUATION" and self._peek()[1] == ",":
                    self._consume("PUNCTUATION", ",")
                else:
                    break

            self._consume("PUNCTUATION", ")")
            return InNode(field, operator, values)
        else:
            # Parse single value
            value = self._parse_value()
            return ComparisonNode(field, operator, value)

    def _parse_value(self) -> Any:
        """Parse a value (string, number, or boolean)."""
        token = self._consume()

        if token[0] == "STRING" or token[0] == "NUMBER" or token[0] == "BOOLEAN":
            return token[1]
        else:
            raise ValueError(f"Expected value, got {token[0]}")


def get_query_help() -> str:
    """Return help text for query syntax."""
    return """
FIELDS:
  orientation, resolution, frame_rate, is_kept, is_rejected,
  tags, recorded_at, latitude, longitude, file_name, short_name

OPERATORS:
  =, !=, >, <, >=, <=, IN, NOT IN, AND, OR

EXAMPLES:
  orientation = "portrait"
  tags IN ("Wide", "Drone") AND is_kept = true
  frame_rate >= 30 AND resolution = "1920x1080"
  recorded_at >= "2024-01-01"
"""


def parse_query(query_string: str) -> QueryNode | str:
    """
    Parse a query string.

    Returns:
        QueryNode if successful, or help text if query is "/help"

    Raises:
        ValueError: if the query is invalid
    """
    query_string = query_string.strip()

    # Check for help command
    if query_string.lower() == "/help":
        return get_query_help()

    parser = QueryParser(query_string)
    return parser.parse()
