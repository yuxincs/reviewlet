# Optional illustrative values

The frontend currently uses prepared review data. When LLM review generation is
connected, include these instructions in the review prompt:

> In the finding description and step explanations, wrap code symbols and
> expressions in single backticks, such as `userId`, `db.query`, or `users[0]`.
> Keep symbol names consistent with the referenced code so the UI can match colors.

> For findings that benefit from a concrete example, choose one small, fictional
> input that demonstrates the issue. Track that same example through the
> explanation steps and data-flow nodes. A node may include an optional
> `sampleValue` string showing its value at that point in the step. Format strings
> with quotes and use readable literals for arrays, objects, null, and undefined.
> Keep values concise. Distinguish a variable's value from the result of an
> expression or function call. Use the existing symbol identity and code reference
> to associate each value with its variable occurrence.
>
> Keep current-code behavior and proposed-fix behavior separate. Only give values
> supported by the snippet and the stated example; omit values that require
> unknown external behavior or do not help explain the finding. Never use real
> personal data or secrets. These are illustrative values, not execution results.

Example nodes in a step's `flow.nodes`:

```json
[
  {
    "label": "users result",
    "reference": {
      "line": 6,
      "startColumn": 9,
      "endColumn": 14,
      "symbol": "users",
      "role": "transform"
    },
    "sampleValue": "[]"
  },
  {
    "label": "users[0] lookup",
    "sampleValue": "undefined"
  }
]
```

The UI renders `sampleValue` as plain text alongside the corresponding code line
for the selected step. Expression results without their own code reference appear
beside the preceding referenced variable. It never executes example input. Missing
values leave the existing review presentation intact.


## Suggested edits

A finding can optionally include an `edit` for an inline preview and application:

```json
{
  "startLine": 7,
  "endLine": 7,
  "original": "  console.log('User result:', users);",
  "replacement": ""
}
```

Line numbers are one-based and inclusive. `original` must exactly match all lines
being replaced, including indentation. An empty `replacement` deletes those lines.
Include every affected line in one edit; for example, replacing a query definition
and its use must remove the old definition as well. Omit the edit when a complete
replacement cannot be specified. The frontend verifies the source match before
previewing or applying and rejects results longer than 30,000 characters.


Applying a fix retains the review in a new revision. Findings, symbol references,
flow endpoints, and remaining edit ranges are remapped to the updated code. The
applied finding is resolved. Overlapping findings and ambiguous or missing symbol
references are marked `needs-recheck`, with their stale flows and edits disabled.
Unrelated findings remain actionable. Undo restores the preceding code and review
revision together. The local mock saves revisions only against matching source
code to reject stale updates.
