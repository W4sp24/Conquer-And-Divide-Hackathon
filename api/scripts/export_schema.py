"""Write supabase/schema.sql from the table definitions in app/schema.py.

    cd api && .venv/Scripts/python -m scripts.export_schema
"""
from pathlib import Path

from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable

from app.schema import metadata

OUT = Path(__file__).resolve().parent.parent.parent / "supabase" / "schema.sql"


def main():
    pg = postgresql.dialect()
    lines = ["-- Generated from api/app/schema.py by api/scripts/export_schema.py. Do not edit by hand.",
             "-- Run once in the Supabase SQL editor. The backend also creates missing tables on startup.",
             "-- Money is whole centavos. Timestamps are stored as UTC.", ""]
    for t in metadata.sorted_tables:
        lines.append(str(CreateTable(t).compile(dialect=pg)).strip() + ";\n")
        for ix in t.indexes:
            lines.append(str(CreateIndex(ix).compile(dialect=pg)).strip() + ";\n")
    lines.append("-- Only the backend talks to the database. RLS on with no policies blocks")
    lines.append("-- Supabase's public REST API from reading anything.")
    lines += [f"alter table {t.name} enable row level security;" for t in metadata.sorted_tables]
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(metadata.sorted_tables)} tables)")


if __name__ == "__main__":
    main()
