# Review latency measurements

Measured on October 22, 2026 using the checkout-quote demo, the configured OpenAI
endpoint, and `gpt-6.1-sol` at low reasoning effort. Each row is one live sample,
not a latency guarantee or a controlled quality evaluation. Earlier streaming probes collected output for diagnosis. The application now uses
the staged SSE path described at the end of this report.
No persisted snippets were modified by these stateless probes.

| Request                                                       |   Total | First content | Completion tokens (including reasoning) | Result                                         |
| ------------------------------------------------------------- | ------: | ------------: | --------------------------------------: | ---------------------------------------------- |
| Full review before compact-JSON/source-location changes       | 54.25 s |  Not measured |                   2,593 (512 reasoning) | Valid, 3 findings                              |
| Full review, minified JSON only                               | 37.84 s |       13.28 s |                   1,816 (372 reasoning) | Rejected: wrong source column                  |
| Full review, minified JSON and server-resolved unique symbols | 27.64 s |  Not measured |            1,540 (0 reasoning reported) | Valid, 3 findings                              |
| Findings only: title, severity, category and affected range   |  4.74 s |        2.75 s |              112 (0 reasoning reported) | 3 findings, no detailed guides or fixes        |
| Full review with `gpt-6-luna`, reasoning `none`               | 12.68 s |        0.71 s |            1,600 (0 reasoning reported) | Rejected: missing/ambiguous source occurrences |

The initial full review spent 54.249 s in the provider request and 3.12 ms in
local validation. The final full review spent 27.631 s in the provider request
and 3.15 ms in local validation. The initial prompt had 4,191 tokens, with 4,188
reported cached; the final prompt had 4,285 tokens, with none reported cached.
These observations point to generated-output volume and provider generation time,
not local schema validation or SQLite. The probes were stateless, so they do not
measure SQLite write latency.

A separate control requested the same tiny constant response using the full
strict schema and JSON mode. Strict output took 2.68 s (22 completion tokens);
JSON mode took 3.10 s (20 completion tokens). This warm/small sample does not
establish cold-schema cost or production percentiles, but provides no evidence
that removing strict output would solve the large full-review delay.

The minified-only rejection selected the wrong character offset for
`discountCents`. The server now accepts a nullable internal start column only
when the symbol can be located exactly once on its stated line. It computes
UTF-16 columns itself and rejects missing or ambiguous occurrences. Explicit
columns are still checked against source. The public OpenAPI format is unchanged.
The Luna probe supplied a symbol on the wrong line and an ambiguous occurrence;
its shorter completion is not a usable-review speedup.

For a few-second initial response, the measured promising approach is a short
findings pass followed by detailed explanation/flow/fix generation. The short
probe found the three intended demo issues, but is not yet a production API or
frontend mode. It still needs accuracy testing on other snippets, version/hash
checks for late details, and a choice of background versus on-selection loading.
Streaming full reviews can expose progress earlier; it does not by itself remove
the time needed to finish all details. Lowering the completion limit alone risks
truncating JSON instead of producing a faster valid review.

## Findings first, then concurrent details

The opt-in `TestLiveReviewFanout` experiment compares the existing full-review
request with a short discovery pass followed by one detail request per finding.
Detail requests use the complete source/context, the same rich output schema,
the same low reasoning effort, and the same embedded review instructions. They
are constrained to elaborate their assigned finding. Concurrency is capped at
three. The experiment does not change the production endpoint or frontend.

Each detail must pass normal source, flow, edit and schema validation. Finding
metadata must still match its discovery result. Before validating the merged
review, binding identities from different requests are unified only when they
share an exact source occurrence; matching names alone do not merge bindings.
No automatic retries are used. Failed samples are recorded rather than excluded.

The comparison alternates request order between rounds to reduce a systematic
warm-cache advantage. It measures discovery time, first valid detailed guide,
all detail requests completing, final merged validity, and token usage. A failed
detail would leave a production staged review partially complete; its request
completion time is not the time to a fully usable review.

To reproduce with the demo, from the repository root (this makes billable live
requests using the provider credentials exported in your shell):

```sh
node --experimental-strip-types --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
import { demoSnippet } from './frontend/src/api/demo.ts';
writeFileSync('/private/tmp/reviewlet-benchmark-input.json', JSON.stringify({
  code: demoSnippet.code,
  language: demoSnippet.language,
  context: demoSnippet.context,
}), { mode: 0o600 });
JS
cd backend
REVIEWLET_BENCHMARK_INPUT=/private/tmp/reviewlet-benchmark-input.json \
REVIEWLET_BENCHMARK_REPORT=/private/tmp/reviewlet-benchmark-report.json \
REVIEWLET_BENCHMARK_ROUNDS=3 \
go test ./internal/review -run '^TestLiveReviewFanout$' -v -count=1 -timeout=10m
```

Ordinary tests skip live requests unless `REVIEWLET_BENCHMARK_INPUT` is explicitly
set. The report contains aggregate measurements, not prompts, code, credentials,
or generated review prose. Local fake-provider tests verify that all three
requests run concurrently and shared binding identities merge without combining
distinct scopes.

### Three-round live comparison

Same demo and `gpt-6.1-sol`, low reasoning effort, October 22, 2026.

| Round | Single full request | Initial findings | First valid detail | All detail requests finished | Complete review valid (single / staged) |
| ----- | ------------------: | ---------------: | -----------------: | ---------------------------: | --------------------------------------- |
| 1     |             37.24 s |           4.93 s |            18.68 s |                      32.59 s | yes / yes                               |
| 2     |             32.48 s |           5.67 s |            20.24 s |                      29.56 s | no / no                                 |
| 3     |             32.40 s |           3.96 s |            16.25 s |                      24.37 s | yes / yes                               |

All three discovery passes found the three demo issues. Round 2 produced an
invalid full review in the single-call case and one invalid detail in the staged
case; those completion times do not represent fully usable reviews. Both other
paired rounds passed all validation, including combined-review validation.

In the two valid paired rounds, complete reviews averaged **34.82 s single-call
versus 28.48 s staged**, an **18.2% reduction**. Initial findings arrived in
3.96–5.67 s (median 4.93 s), and the first valid detailed guide in 16.25–20.24 s.
The slowest individual detail took 20.41–27.66 s; discovery plus that request
controls staged completion time. This is a much larger improvement in time to
first useful result than in time to finish everything.

Across all three rounds, staged requests used **3.41× the prompt tokens** and
**1.41× the completion tokens** of single-call requests. Cached-input proportions
vary, so these are token-volume ratios rather than a price estimate. The small
sample is insufficient to establish reliability or production percentiles.
Staging would let the frontend retain valid details and retry one failed detail
independently, but this experiment deliberately made no retries.

## Reusable references and a faster detail model

The experimental detail format defines a `nodes` table once per finding. Each
step references node indices instead of repeating source references, labels and
sample values. Finding title/severity/category/range come from discovery; source
end columns, original edit text, fallback labels and per-step source/sink roles
come from the server. The replacement is emitted once. This is a provider-only
representation; the normalizer expands it into the existing public contract.

A two-round pilot compared the current rich format and the node-table format
on Sol and Luna, both at low reasoning effort, using the same discovered demo
findings. The pilot allowed the usual variable step count. Rich Sol finished
all three guides in 21.03/23.28 s; rich Luna in 13.29/11.06 s. Node-table Sol
finished in 15.54/12.14 s (the second run was rejected); node-table Luna in
10.62/11.60 s. Table outputs often had just one step, so those apparent format
improvements cannot be attributed solely to deduplication.

A subsequent controlled trial required **exactly two steps in every guide**,
using the same initial findings and three concurrent detail requests per
variant. The initial findings pass took 4.54 s and was reused across variants.
The times below begin **after findings are available**, not at snippet submission.

| Detail model | Provider format     | All three detail requests finished | Visible completion tokens | Reasoning tokens | Valid guides after resolver correction |
| ------------ | ------------------- | ---------------------------------: | ------------------------: | ---------------: | -------------------------------------- |
| Sol, low     | Current rich format |                            20.41 s |                     2,188 |              299 | 3/3                                    |
| Sol, low     | Reusable node table |                            20.75 s |                     1,579 |              578 | 3/3                                    |
| Luna, low    | Current rich format |                            11.07 s |                     1,606 |            1,473 | 3/3                                    |
| Luna, low    | Reusable node table |                            11.86 s |                     1,663 |            1,446 | 3/3                                    |

Sol is `gpt-6.1-sol`; Luna is `gpt-6-luna`. Token figures sum all three requests;
wall time is determined by the slowest concurrent request. These are individual
trials, not production percentiles or a general model-quality evaluation.

The controlled trial exposed a bug in our nullable-column resolver: it counted
`totalCents` within `discountedSubtotalCents` as a second occurrence. This caused
false rejections in three variants. Identifier-boundary matching is now used
for automatic resolution, preserving exact UTF-16 checks and rejecting genuinely
ambiguous matches. All 12 saved guide responses were revalidated locally, along
with the merged reviews, without provider retries. The generation times above
are the original live times; the resolver correction affects local validation.
The two-round pilot's rejected outputs were not saved and remain recorded as
rejections rather than assumed to be corrected.

The node table cut Sol's visible output by **28%**, but increased its reasoning
work in this trial and did not shorten completion time. Luna was about **46%
faster** with the current format at the same effort. Deduplication remains a
possible payload improvement; this experiment does not establish it as a
latency improvement at equivalent explanation length.

Structural/source validity is not semantic correctness. Manual inspection of
one table-format Luna guide found incorrect dependency edges (for example,
`discountCents` connected into the independent `subtotalCents` input). Its
indices were in bounds, but the arrows were misleading. The extra indirection
between global table indices and step-local edge indices complicates generation.
Before adopting that format, use global edge endpoints or server-assigned source
occurrence IDs and evaluate causal-flow accuracy on representative snippets.

The measured promising next step is a separately configurable detail model:
keep strong discovery, supply the detected issue and evidence, generate details
concurrently with Luna, and retry only invalid details on Sol. Source/schema
validation and a broader semantic evaluation remain necessary; automatic
validation alone cannot detect every wrong dependency or unsafe suggested fix.
The production endpoint still uses one synchronous review call.

### Reasoning-disabled follow-up

A final rich-format Luna trial retained exactly two steps per guide and disabled
reasoning for details only. All three requests finished in 23.30 s, but **0/3
passed validation**. Errors included assigning one symbol identity to both a
variable and a different expression, and locating `quantitiesBySku` on a line
where it is absent. Its separately generated discovery took 7.71 s. This single
trial does not establish general speed at `none`, and supplies no basis to
recommend dropping low effort for these guides. Application reasoning settings
were not changed by the experiment.

To rerun the controlled matrix, prepare the demo input as above, then from
`backend/`:

```sh
REVIEWLET_BENCHMARK_INPUT=/private/tmp/reviewlet-benchmark-input.json \
REVIEWLET_BENCHMARK_REPORT=/private/tmp/reviewlet-detail-report.json \
REVIEWLET_DETAIL_ROUNDS=1 \
go test ./internal/review -run '^TestLiveDetailFormats$' -v -count=1 -timeout=10m
```

The matrix runs one discovery pass, reuses its findings across the four variants,
and caps each variant at three concurrent detail requests. Additional rounds
reverse variant order. `REVIEWLET_DETAIL_VARIANT=rich-luna-none` selects the
reasoning-disabled follow-up instead. Ordinary tests skip these live calls.
Optional `REVIEWLET_DETAIL_AUDIT` writes the generated responses to a private
local file for semantic inspection; the normal benchmark report stores metrics
only. `TestReplayDetailAudit` can locally revalidate a saved audit without any
provider calls, using `REVIEWLET_DETAIL_REPLAY` and the original benchmark input.

Official documentation supports both reducing structured-output verbosity and
using smaller models for suitable subtasks, but recommends measuring quality
alongside speed: [latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization),
[GPT-6 Luna capabilities and reasoning settings](https://developers.openai.com/api/docs/models/gpt-6-luna).


## Production staged path verification

A stateless end-to-end run on October 22, 2026 used the actual HTTP SSE handler,
`gpt-6.1-sol` discovery, and three concurrent `gpt-6-luna` rich guides, both at low
reasoning effort. It used the same checkout demo; no persisted user snippets
were changed.

| Event | Elapsed from submission | Ready guides |
| --- | ---: | ---: |
| Initial findings (all 3) | 7.21 s | 0/3 |
| First guide | 17.28 s | 1/3 |
| Second guide | 18.61 s | 2/3 |
| Complete | 21.20 s | 3/3 |

All three guides passed validation and contained data flows; two included exact
applicable edits. No fallback was needed. This is one integration sample, not a
controlled comparison or a latency guarantee. The initial detection step still
has provider variability, but the frontend can display its findings immediately
and reveal each validated guide independently. Request `Accept: text/event-stream`
on `POST /api/v1/review` to use this path; JSON callers retain the synchronous
single-pass behavior. `OPENAI_DETAIL_MODEL` overrides the faster guide model.
