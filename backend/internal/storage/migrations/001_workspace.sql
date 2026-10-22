CREATE TABLE snippets (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL CHECK (version > 0),
    document TEXT NOT NULL CHECK (json_valid(document)),
    review_run TEXT NOT NULL DEFAULT ''
);
