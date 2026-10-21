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
